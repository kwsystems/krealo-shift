/**
 * `submit-time-event` (especificación §16).
 *
 * Crea un evento de tiempo. Toda la validación de reglas vive en la función SQL
 * `submit_time_event`: credencial del dispositivo, idempotencia, transición de
 * estado, turno elegible, entrada temprana y tienda vinculada.
 *
 * Esta capa solo hace tres cosas: autenticar el kiosco, consumir el token de
 * acción y traducir el resultado. La respuesta a un reintento es equivalente a la
 * original, porque la idempotencia se resuelve en la base.
 */

import {
  errorResponse,
  isUuid,
  jsonResponse,
  mapPostgresError,
  preflight,
  readJson,
} from '../_shared/http.ts';
import { authenticateKiosk, serviceClient, verifyActionToken } from '../_shared/kiosk-auth.ts';

const EVENT_TYPES = ['clock_in', 'break_start', 'break_end', 'clock_out'] as const;
const BREAK_TYPES = ['paid', 'unpaid', 'meal', 'other'] as const;

type Body = {
  actionToken: string;
  eventType: (typeof EVENT_TYPES)[number];
  breakType?: (typeof BREAK_TYPES)[number];
  shiftId: string | null;
  idempotencyKey: string;
  occurredAtDevice?: string;
  deviceSequence?: number;
  isOffline: boolean;
};

function validate(value: unknown): Body | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  if (typeof v.actionToken !== 'string' || v.actionToken.length < 20) return null;
  if (typeof v.eventType !== 'string') return null;
  if (!EVENT_TYPES.includes(v.eventType as Body['eventType'])) return null;
  if (!isUuid(v.idempotencyKey)) return null;
  if (v.shiftId !== null && v.shiftId !== undefined && !isUuid(v.shiftId)) return null;
  if (v.breakType !== undefined && !BREAK_TYPES.includes(v.breakType as Body['breakType'])) {
    return null;
  }

  return {
    actionToken: v.actionToken,
    eventType: v.eventType as Body['eventType'],
    breakType: v.breakType as Body['breakType'] | undefined,
    shiftId: isUuid(v.shiftId) ? v.shiftId : null,
    idempotencyKey: v.idempotencyKey,
    occurredAtDevice: typeof v.occurredAtDevice === 'string' ? v.occurredAtDevice : undefined,
    deviceSequence: typeof v.deviceSequence === 'number' ? v.deviceSequence : undefined,
    isOffline: v.isOffline === true,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return errorResponse('bad_request', 'Solo POST.', 405);

  const supabase = serviceClient();

  let kiosk;
  try {
    kiosk = await authenticateKiosk(request, supabase);
  } catch (error) {
    return mapPostgresError(error as { code?: string; message?: string });
  }
  if (kiosk === null) return errorResponse('revoked', 'Este reloj no está activo.', 401);

  const body = await readJson(request, validate);
  if (!body.ok) return body.response;

  // El token de acción liga el fichaje a la persona que puso su PIN hace menos de
  // 90 segundos. Sin esto, conocer la credencial del iPad permitiría fichar por
  // cualquiera.
  const claim = await verifyActionToken(body.data.actionToken, kiosk);
  if (claim === null) {
    return errorResponse('not_authorized', 'Vuelve a ingresar tu PIN.', 401);
  }

  const { data, error } = await supabase.rpc('submit_time_event', {
    p_device_id: kiosk.deviceId,
    p_employee_id: claim.employeeId,
    p_event_type: body.data.eventType,
    p_idempotency_key: body.data.idempotencyKey,
    p_shift_id: body.data.shiftId,
    p_break_type: body.data.breakType ?? null,
    p_occurred_at_device: body.data.occurredAtDevice ?? null,
    p_device_sequence: body.data.deviceSequence ?? null,
    p_is_offline: body.data.isOffline,
    // La ruta de la foto NO la propone el cliente. Antes llegaba aqui el URI
    // local del archivo en el iPad, que en la base no significa nada. La foto se
    // adjunta despues con `attach-photo`, que deriva la ruta en el servidor.
    p_photo_path: null,
    p_source: 'kiosk',
  });

  if (error) return mapPostgresError(error);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return errorResponse('server_error', 'La base no devolvió resultado.', 500);

  // Resumen para la pantalla de resultado: a qué hora termina el turno y cuánto
  // lleva trabajado hoy (§9.5).
  const summary = await supabase
    .from('work_sessions')
    .select('net_minutes, shift_id, shifts:shift_id (ends_at)')
    .eq('employee_id', claim.employeeId)
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const shiftEndsAt =
    summary.data && typeof summary.data === 'object' && 'shifts' in summary.data
      ? ((summary.data.shifts as { ends_at?: string } | null)?.ends_at ?? null)
      : null;

  return jsonResponse({
    status: row.status,
    // Necesario para adjuntar la foto despues: `attach-photo` solo escribe sobre
    // un evento que ya existe, para que `photo_path` nunca apunte a un objeto
    // inexistente.
    eventId: row.event_id,
    attendanceState: row.attendance_state,
    occurredAt: row.occurred_at,
    serverReceivedAt: new Date().toISOString(),
    flags: row.flags ?? [],
    summary: {
      shiftEndsAt,
      netMinutesToday: summary.data?.net_minutes ?? 0,
    },
  });
});
