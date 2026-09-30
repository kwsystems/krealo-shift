import { z } from 'zod';

import { docId } from '@/lib/firebase/ids';

import type { TimeEventType } from '@/domain/attendance-state-machine';
import { dateKeyOf } from '@/features/schedules/week';
import { AdminError, requireClient, selectRows, toAdminError } from '@/hooks/use-admin-query';
import { RPC, TABLES } from '@/lib/firebase/tables';
import { formatClockTime } from '@/utils/time';

/**
 * Bandeja de solicitudes (§11.5).
 *
 * Resolver una solicitud pasa siempre por el servidor (`review_time_edit_request`).
 * Aprobar un «olvidé marcar» registra fichajes nuevos; aprobar una corrección sobre una
 * sesión aplica un ajuste auditable, que conserva valor anterior, valor nuevo, autor y
 * motivo. Ninguna de las dos edita un evento. Rechazar tampoco borra nada: deja la
 * decisión y el comentario.
 */

export const requestKindValues = [
  'forgot_clock_in',
  'forgot_break',
  'forgot_clock_out',
  'correction',
  'unscheduled_shift',
] as const;
export type RequestKind = (typeof requestKindValues)[number];

export const requestStatusValues = ['pending', 'approved', 'rejected'] as const;
export type RequestStatus = (typeof requestStatusValues)[number];

const proposedValueSchema = z
  .object({
    startsAt: z.string().nullable().optional(),
    endsAt: z.string().nullable().optional(),
    proposedAt: z.string().nullable().optional(),
    channel: z.string().optional(),
  })
  .catch({});

/**
 * Se exporta para poder COMPROBAR que una solicitud recién creada se puede volver a leer.
 * Es el mismo caso que los turnos: el shim escribía `created_at` como `serverTimestamp()`,
 * volvía como objeto, y `z.string()` lo rechazaba. La bandeja entera fallaba.
 */
export const requestSchema = z.object({
  id: docId(),
  employee_id: docId(),
  location_id: docId(),
  work_session_id: docId().nullable(),
  target_date: z.string().nullable(),
  kind: z.enum(requestKindValues),
  proposed_value: proposedValueSchema,
  reason: z.string(),
  status: z.enum(requestStatusValues),
  reviewer_comment: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
});

export type TimeEditRequest = z.infer<typeof requestSchema>;

/** Las tres pestañas de la bandeja (§11.5). */
export type RequestTab = 'corrections' | 'forgot' | 'unscheduled';

export function tabForKind(kind: RequestKind): RequestTab {
  if (kind === 'correction') return 'corrections';
  if (kind === 'unscheduled_shift') return 'unscheduled';
  return 'forgot';
}

export async function fetchRequests(params: {
  organizationId: string;
  locationId: string;
}): Promise<TimeEditRequest[]> {
  return selectRows(z.array(requestSchema), (db) =>
    db
      .from(TABLES.timeEditRequests)
      .select(
        'id, employee_id, location_id, work_session_id, target_date, kind, proposed_value, reason, status, reviewer_comment, reviewed_at, created_at',
      )
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .order('created_at', { ascending: false })
      .limit(200),
  );
}

export async function countPendingRequests(params: {
  organizationId: string;
  locationId: string;
}): Promise<number> {
  const rows = await selectRows(z.array(z.object({ id: docId() })), (db) =>
    db
      .from(TABLES.timeEditRequests)
      .select('id')
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .eq('status', 'pending'),
  );
  return rows.length;
}

/**
 * LO QUE DICE EL SERVIDOR CUANDO NO PUEDE APROBAR, con su motivo. La pantalla lo traduce a
 * una frase que dice qué corregir: «a esa hora ya estaba dentro», «falta la salida»…
 * Tirar el motivo y enseñar «algo salió mal» es lo que dejaba a quien aprobaba sin saber
 * qué tocar.
 */
export class RechazoDeLaSolicitud extends AdminError {
  constructor(
    readonly motivo: string,
    readonly tipo: string | null,
    readonly estado: string | null,
    message: string,
  ) {
    super('invalid', message, motivo);
  }
}

const resultadoSchema = z.object({
  status: z.string(),
  applied: z.boolean(),
  eventIds: z.array(z.string()).default([]),
  workSessionId: z.string().nullable().optional(),
});

export type ResultadoDeLaRevision = z.infer<typeof resultadoSchema>;

/**
 * TODO PASA POR `reviewTimeEditRequest`, y antes no pasaba nada: el panel escribía la
 * solicitud directamente, las reglas lo prohíben —cambia horas pagadas, así que se
 * resuelve en el servidor y queda auditado— y la pantalla no enseñaba el rechazo. Aprobar
 * parecía no hacer nada y la solicitud seguía pendiente. Ver `functions/src/solicitudes.ts`.
 */
async function resolver(args: Record<string, unknown>): Promise<ResultadoDeLaRevision> {
  const db = requireClient();
  try {
    const { data, error } = await db.rpc(RPC.reviewTimeEditRequest, args);
    if (error !== null) {
      const detalles = ((error as { details?: unknown }).details ?? {}) as Record<string, unknown>;
      if (typeof detalles.motivo === 'string') {
        throw new RechazoDeLaSolicitud(
          detalles.motivo,
          typeof detalles.tipo === 'string' ? detalles.tipo : null,
          typeof detalles.estado === 'string' ? detalles.estado : null,
          error.message,
        );
      }
      throw toAdminError(error);
    }
    const leido = resultadoSchema.safeParse(data);
    // El servidor respondió con otra forma: no se inventa un resultado (§20).
    if (!leido.success) throw toAdminError({ code: 'shape', message: 'UNEXPECTED_SHAPE' });
    return leido.data;
  } catch (error) {
    if (error instanceof RechazoDeLaSolicitud) throw error;
    throw toAdminError(error);
  }
}

/** Solo comenta: no decide. Sirve para pedir contexto antes de resolver. */
export async function commentRequest(params: {
  requestId: string;
  comment: string;
}): Promise<void> {
  await resolver({
    p_request_id: params.requestId,
    p_decision: 'comment',
    p_comment: params.comment.trim(),
  });
}

export type ReviewDecision = 'approved' | 'rejected';

/** Un fichaje que se registra al aprobar un «olvidé marcar». */
export type FichajeDeLaAprobacion = { type: TimeEventType; occurred_at: string };

/**
 * Aprueba o rechaza. Aprobar un «olvidé marcar» REGISTRA los fichajes que faltaban —los
 * que confirma quien aprueba, con fecha y hora— en la misma operación que marca la
 * solicitud: si no caben, no se aprueba nada y el servidor dice por qué.
 */
export async function reviewRequest(params: {
  request: TimeEditRequest;
  decision: ReviewDecision;
  comment: string | null;
  fichajes?: FichajeDeLaAprobacion[];
}): Promise<{ applied: boolean }> {
  const resultado = await resolver({
    p_request_id: params.request.id,
    p_decision: params.decision,
    p_comment: params.comment?.trim() ?? null,
    p_events: params.fichajes ?? null,
  });
  return { applied: resultado.applied };
}

/** Las solicitudes que al aprobarse registran fichajes: las de «olvidé marcar». */
export function registraFichajes(kind: RequestKind): boolean {
  return kind === 'forgot_clock_in' || kind === 'forgot_clock_out' || kind === 'forgot_break';
}

const HORA_TECLEADA = /^(\d{1,2})[:.h]?(\d{2})$/;

/**
 * La fecha y la hora que propone la solicitud, en la zona de la sede.
 *
 * DOS FORMAS, porque las dos existen en la base: un instante completo —lo que guarda el
 * servidor desde el 30-sep, y lo que siempre guardó el panel— y la hora tal como se tecleó
 * en el reloj, «14:30», sin fecha. Las segundas enseñaban «--:--» y ninguna fecha; ahora se
 * lee la hora tal cual y la fecha es el día en que se pidió.
 */
export function propuestaDe(
  request: Pick<TimeEditRequest, 'proposed_value' | 'target_date' | 'created_at'>,
  timezone: string,
): { fecha: string | null; hora: string | null } {
  const crudo =
    request.proposed_value.startsAt ??
    request.proposed_value.proposedAt ??
    request.proposed_value.endsAt ??
    null;
  const diaDePedido = dateKeyOf(request.created_at, timezone) || null;

  if (crudo === null) return { fecha: request.target_date ?? diaDePedido, hora: null };

  const tecleada = HORA_TECLEADA.exec(crudo.trim());
  if (tecleada !== null) {
    const horas = Number(tecleada[1]);
    const minutos = Number(tecleada[2]);
    const valida = horas <= 23 && minutos <= 59;
    return {
      fecha: request.target_date ?? diaDePedido,
      hora: valida ? `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}` : null,
    };
  }

  const fecha = dateKeyOf(crudo, timezone);
  if (fecha === '') return { fecha: request.target_date ?? diaDePedido, hora: null };
  return { fecha: request.target_date ?? fecha, hora: formatClockTime(crudo, timezone, '24h') };
}
