import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import {
  ADMIN_LIST_STALE_MS,
  requireClient,
  selectRows,
  toAdminError,
} from '@/hooks/use-admin-query';
import { refrescarVistasDeHoras } from '@/hooks/refrescar-vistas';
import { RPC, TABLES } from '@/lib/firebase/tables';

import { addManualTimeEvent, adjustWorkSession } from './api';

/**
 * LAS HORAS QUE ALGUIEN DEBE, y lo que las resuelve (Andree, 1-oct).
 *
 * «Lo que debería salir acá es que yo vea que ella me debe horas… y a ella debería
 * aparecerle en su apartado.» Las registra quien gestiona desde «Por resolver» en Horas,
 * una por jornada; se ven en la ficha de Equipo —donde se dan por compensadas o
 * perdonadas— y en el celular de la persona. Solo las escribe el servidor
 * (`functions/src/casos.ts`): son horas que se cobran.
 *
 * LAS CLAVES CUELGAN DE `timesheet`, así que `refrescarVistasDeHoras` las refresca con todo
 * lo demás: resolver un caso en Horas cambia la ficha y la vista de la persona a la vez.
 */

export const horaDebidaSchema = z.object({
  id: z.string(),
  employee_id: z.string(),
  location_id: z.string(),
  work_session_id: z.string().nullable().default(null),
  work_date: z.string(),
  minutes: z.number().int(),
  note: z.string().nullable().default(null),
  status: z.enum(['pending', 'compensated', 'forgiven']).catch('pending'),
  created_at: z.string().nullable().default(null),
});
export type HoraDebida = z.infer<typeof horaDebidaSchema>;

const ordenar = (filas: HoraDebida[]) =>
  [...filas].sort((a, b) => b.work_date.localeCompare(a.work_date));

/** Las de una persona en una sede: lo que ve quien gestiona. */
export async function fetchHorasDebidas(params: {
  organizationId: string;
  locationId: string;
  employeeId: string;
}): Promise<HoraDebida[]> {
  // La sede va en la consulta: la regla mira la sede, y una consulta que no la acota se
  // deniega entera (ver `schedules/api.ts`).
  const filas = await selectRows(z.array(horaDebidaSchema), (db) =>
    db
      .from(TABLES.owedHours)
      .select('*')
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .eq('employee_id', params.employeeId),
  );
  return ordenar(filas);
}

/** Las suyas, en su celular. */
export async function fetchMisHorasDebidas(params: {
  organizationId: string;
  employeeId: string;
}): Promise<HoraDebida[]> {
  const filas = await selectRows(z.array(horaDebidaSchema), (db) =>
    db
      .from(TABLES.owedHours)
      .select('*')
      .eq('organization_id', params.organizationId)
      .eq('employee_id', params.employeeId),
  );
  return ordenar(filas);
}

export const pendientes = (filas: readonly HoraDebida[]) =>
  filas.filter((fila) => fila.status === 'pending');
export const minutosPendientes = (filas: readonly HoraDebida[]) =>
  pendientes(filas).reduce((suma, fila) => suma + fila.minutes, 0);

export function useHorasDebidas(params: {
  organizationId: string | null;
  locationId: string | null;
  employeeId: string | null;
}) {
  return useQuery({
    queryKey: [
      'timesheet',
      'horas-debidas',
      params.locationId ?? 'none',
      params.employeeId ?? 'none',
    ],
    queryFn: () =>
      fetchHorasDebidas({
        organizationId: params.organizationId ?? '',
        locationId: params.locationId ?? '',
        employeeId: params.employeeId ?? '',
      }),
    enabled:
      params.organizationId !== null && params.locationId !== null && params.employeeId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

/**
 * El servidor dijo que no, y por qué —`AJUSTADA`, `YA_TIENE_PAUSA`…—. Se conserva el
 * motivo para poder decir qué hacer; `toAdminError` lo perdería.
 */
export class CasoRechazado extends Error {
  constructor(
    readonly motivo: string,
    message: string,
  ) {
    super(message);
    this.name = 'CasoRechazado';
  }
}

async function llamar(nombre: string, argumentos: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await requireClient().rpc(nombre, argumentos);
    if (error !== null) {
      const detalles = ((error as { details?: unknown }).details ?? {}) as Record<string, unknown>;
      if (typeof detalles.motivo === 'string')
        throw new CasoRechazado(detalles.motivo, error.message);
      throw toAdminError(error);
    }
    return data;
  } catch (error) {
    if (error instanceof CasoRechazado) throw error;
    throw toAdminError(error);
  }
}

/** Lo que se puede hacer con un caso de «Por resolver». */
export type ArregloDeCaso =
  | { tipo: 'debe'; sessionId: string; minutos: number; nota: string | null }
  | { tipo: 'justificado'; sessionId: string; nota: string | null }
  | { tipo: 'sin_refrigerio_ok'; sessionId: string }
  | { tipo: 'descontar_refrigerio'; sessionId: string }
  | {
      tipo: 'marcar_salida';
      employeeId: string;
      locationId: string;
      instante: string;
      motivo: string;
    }
  | {
      /** Una salida que quedó mal —el día equivocado—: se corrige en su jornada. */
      tipo: 'corregir_salida';
      sessionId: string;
      expectedUpdatedAt: string;
      instante: string;
      motivo: string;
    };

export async function arreglarCaso(arreglo: ArregloDeCaso): Promise<void> {
  switch (arreglo.tipo) {
    case 'debe':
      await llamar(RPC.resolveSessionCase, {
        p_work_session_id: arreglo.sessionId,
        p_case: 'faltan_horas',
        p_decision: 'owes',
        p_minutes: arreglo.minutos,
        p_note: arreglo.nota,
      });
      return;
    case 'justificado':
      await llamar(RPC.resolveSessionCase, {
        p_work_session_id: arreglo.sessionId,
        p_case: 'faltan_horas',
        p_decision: 'justified',
        p_note: arreglo.nota,
      });
      return;
    case 'sin_refrigerio_ok':
      await llamar(RPC.resolveSessionCase, {
        p_work_session_id: arreglo.sessionId,
        p_case: 'sin_refrigerio',
        p_decision: 'worked_through',
      });
      return;
    case 'descontar_refrigerio':
      await llamar(RPC.applyPlannedBreak, { p_work_session_id: arreglo.sessionId });
      return;
    case 'marcar_salida':
      // Es un fichaje que faltaba: el mismo camino que «Agregar fichaje manual».
      await addManualTimeEvent({
        employeeId: arreglo.employeeId,
        locationId: arreglo.locationId,
        eventType: 'clock_out',
        occurredAt: arreglo.instante,
        reason: arreglo.motivo,
      });
      return;
    case 'corregir_salida':
      // El servidor mueve la salida si la puso quien gestiona, o corrige la jornada si la
      // marcó la persona: ver `functions/src/shared/salida-a-mano.ts`.
      await adjustWorkSession({
        workSessionId: arreglo.sessionId,
        expectedUpdatedAt: arreglo.expectedUpdatedAt,
        newStartsAt: null,
        newEndsAt: arreglo.instante,
        reason: arreglo.motivo,
      });
      return;
  }
}

export function useArreglarCaso() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: arreglarCaso,
    onSuccess: () => refrescarVistasDeHoras(queryClient),
  });
}

export function useSaldarHorasDebidas() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; estado: 'pending' | 'compensated' | 'forgiven' }) =>
      llamar(RPC.settleOwedHours, { p_owed_id: params.id, p_status: params.estado }),
    onSuccess: () => refrescarVistasDeHoras(queryClient),
  });
}
