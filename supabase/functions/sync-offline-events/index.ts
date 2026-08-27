/**
 * `sync-offline-events` (especificación §16, §17).
 *
 * Recibe un lote pequeño y ORDENADO de eventos que el iPad guardó sin conexión, y
 * los procesa uno por uno por su clave de idempotencia.
 *
 * Reglas que hacen que esto sea confiable:
 *   - se procesa en orden de secuencia del dispositivo, no en el orden en que
 *     llegaron: una salida antes de su entrada produciría un estado imposible;
 *   - cada evento responde `accepted`, `duplicate`, `needs_review` o `rejected`;
 *   - NUNCA se descarta nada en silencio: lo que no se pudo aplicar vuelve al
 *     cliente con su motivo, y el iPad lo conserva hasta que un gerente lo
 *     resuelva;
 *   - un evento rechazado no aborta el lote: los demás sí se aplican.
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

const MAX_BATCH = 50;
const EVENT_TYPES = ['clock_in', 'break_start', 'break_end', 'clock_out'] as const;

type OfflineEvent = {
  idempotencyKey: string;
  actionToken: string;
  eventType: (typeof EVENT_TYPES)[number];
  breakType?: string;
  shiftId: string | null;
  occurredAtDevice: string;
  deviceSequence: number;
  photoPath?: string | null;
};

type Body = { events: OfflineEvent[] };

function validateEvent(value: unknown): OfflineEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isUuid(v.idempotencyKey)) return null;
  if (typeof v.actionToken !== 'string' || v.actionToken.length < 20) return null;
  if (typeof v.eventType !== 'string') return null;
  if (!EVENT_TYPES.includes(v.eventType as OfflineEvent['eventType'])) return null;
  if (typeof v.occurredAtDevice !== 'string' || Number.isNaN(Date.parse(v.occurredAtDevice))) {
    return null;
  }
  if (typeof v.deviceSequence !== 'number') return null;

  return {
    idempotencyKey: v.idempotencyKey,
    actionToken: v.actionToken,
    eventType: v.eventType as OfflineEvent['eventType'],
    breakType: typeof v.breakType === 'string' ? v.breakType : undefined,
    shiftId: isUuid(v.shiftId) ? v.shiftId : null,
    occurredAtDevice: v.occurredAtDevice,
    deviceSequence: v.deviceSequence,
    photoPath: typeof v.photoPath === 'string' ? v.photoPath : null,
  };
}

function validate(value: unknown): Body | null {
  if (typeof value !== 'object' || value === null) return null;
  const { events } = value as Record<string, unknown>;
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_BATCH) return null;

  const parsed: OfflineEvent[] = [];
  for (const item of events) {
    const event = validateEvent(item);
    if (event === null) return null;
    parsed.push(event);
  }
  return { events: parsed };
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
  if (kiosk === null) {
    // Un kiosco revocado no sincroniza. El iPad debe mostrar la pantalla de
    // revocado y conservar sus eventos, no borrarlos (§32.4).
    return errorResponse('revoked', 'Este reloj fue desactivado.', 401);
  }

  const body = await readJson(request, validate);
  if (!body.ok) return body.response;

  // Orden por secuencia del dispositivo: es la única fuente de orden fiable
  // cuando los eventos se generaron sin conexión.
  const ordered = [...body.data.events].sort((a, b) => a.deviceSequence - b.deviceSequence);

  const results: Array<{
    idempotencyKey: string;
    status: 'accepted' | 'duplicate' | 'needs_review' | 'rejected';
    reason?: string;
    attendanceState?: string;
  }> = [];

  for (const event of ordered) {
    const claim = await verifyActionToken(event.actionToken, kiosk);
    if (claim === null) {
      // El token caducó mientras el iPad estaba sin red. El evento NO se
      // descarta: se devuelve para que un gerente lo revise, porque el fichaje
      // sí ocurrió aunque su autorización ya no sea verificable.
      results.push({
        idempotencyKey: event.idempotencyKey,
        status: 'needs_review',
        reason: 'action_token_expired',
      });
      continue;
    }

    const { data, error } = await supabase.rpc('submit_time_event', {
      p_device_id: kiosk.deviceId,
      p_employee_id: claim.employeeId,
      p_event_type: event.eventType,
      p_idempotency_key: event.idempotencyKey,
      p_shift_id: event.shiftId,
      p_break_type: event.breakType ?? null,
      p_occurred_at_device: event.occurredAtDevice,
      p_device_sequence: event.deviceSequence,
      p_is_offline: true,
      p_photo_path: event.photoPath,
      p_source: 'kiosk',
    });

    if (error) {
      // Un error permanente (transición imposible, tienda equivocada) se marca
      // como rechazado con motivo. No se reintenta indefinidamente (§17).
      results.push({
        idempotencyKey: event.idempotencyKey,
        status: 'rejected',
        reason: error.code === '23514' ? 'invalid_transition' : (error.code ?? 'unknown'),
      });
      continue;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const flags: string[] = row?.flags ?? [];

    results.push({
      idempotencyKey: event.idempotencyKey,
      status: flags.includes('clock_drift') ? 'needs_review' : (row?.status ?? 'accepted'),
      attendanceState: row?.attendance_state,
      reason: flags.includes('clock_drift') ? 'clock_drift' : undefined,
    });
  }

  await supabase
    .from('kiosk_devices')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('id', kiosk.deviceId);

  const accepted = results.filter((r) => r.status === 'accepted').length;
  const pending = results.filter(
    (r) => r.status === 'needs_review' || r.status === 'rejected',
  ).length;

  return jsonResponse({ results, accepted, pending });
});
