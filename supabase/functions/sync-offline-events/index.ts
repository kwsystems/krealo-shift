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
 *
 * SOBRE LA AUTORIZACIÓN DE ESTOS EVENTOS
 * Un evento offline NO trae token de acción: el token vive 90 segundos y el iPad
 * pudo pasar horas sin red. Lo que trae es el identificador opaco del empleado y
 * la versión del PIN con la que el propio dispositivo lo validó, usando el
 * verificador que el servidor le entregó al activarse. El servidor lo registra
 * marcado como offline, para que el gerente sepa que la autorización la hizo el
 * dispositivo y no el servidor. Descartarlos sería perder jornadas reales.
 */

import {
  errorResponse,
  isUuid,
  jsonResponse,
  mapPostgresError,
  preflight,
  readJson,
} from '../_shared/http.ts';
import { authenticateKiosk, serviceClient } from '../_shared/kiosk-auth.ts';

const MAX_BATCH = 50;
const EVENT_TYPES = ['clock_in', 'break_start', 'break_end', 'clock_out'] as const;
const BREAK_TYPES = ['paid', 'unpaid', 'meal', 'other'] as const;

type OfflineEvent = {
  idempotencyKey: string;
  employeeOpaqueId: string;
  eventType: (typeof EVENT_TYPES)[number];
  breakType?: (typeof BREAK_TYPES)[number];
  shiftId: string | null;
  occurredAtDevice: string;
  deviceSequence: number;
  pinVersion: number;
  photoPath?: string | null;
};

type Body = { events: OfflineEvent[] };

function validateEvent(value: unknown): OfflineEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  if (!isUuid(v.idempotencyKey)) return null;
  // El identificador opaco es un sha256 en hexadecimal: 64 caracteres.
  if (typeof v.employeeOpaqueId !== 'string' || !/^[0-9a-f]{64}$/.test(v.employeeOpaqueId)) {
    return null;
  }
  if (typeof v.eventType !== 'string') return null;
  if (!EVENT_TYPES.includes(v.eventType as OfflineEvent['eventType'])) return null;
  if (v.breakType !== undefined && !BREAK_TYPES.includes(v.breakType as OfflineEvent['breakType'])) {
    return null;
  }
  if (typeof v.occurredAtDevice !== 'string' || Number.isNaN(Date.parse(v.occurredAtDevice))) {
    return null;
  }
  if (typeof v.deviceSequence !== 'number' || !Number.isFinite(v.deviceSequence)) return null;
  if (typeof v.pinVersion !== 'number' || !Number.isInteger(v.pinVersion)) return null;

  return {
    idempotencyKey: v.idempotencyKey,
    employeeOpaqueId: v.employeeOpaqueId,
    eventType: v.eventType as OfflineEvent['eventType'],
    breakType: v.breakType as OfflineEvent['breakType'] | undefined,
    shiftId: isUuid(v.shiftId) ? v.shiftId : null,
    occurredAtDevice: v.occurredAtDevice,
    deviceSequence: v.deviceSequence,
    pinVersion: v.pinVersion,
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
    // Un solo evento mal formado invalida el lote entero: aceptar la mitad y
    // callar la otra mitad es justo lo que la especificación prohíbe.
    if (event === null) return null;
    parsed.push(event);
  }
  return { events: parsed };
}

type Resolution = {
  idempotencyKey: string;
  status: 'accepted' | 'duplicate' | 'needs_review' | 'rejected';
  reason?: string;
  attendanceState?: string;
  // El identificador del evento en el servidor. El iPad lo necesita para adjuntar
  // despues la foto: sin el, una foto capturada sin red no tiene a que engancharse.
  eventId?: string;
};

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
    // revocado y CONSERVAR sus eventos, no borrarlos (§32.4).
    return errorResponse('revoked', 'Este reloj fue desactivado.', 401);
  }

  const body = await readJson(request, validate);
  if (!body.ok) return body.response;

  // Orden por secuencia del dispositivo: la única fuente de orden fiable cuando
  // los eventos se generaron sin conexión.
  const ordered = [...body.data.events].sort((a, b) => a.deviceSequence - b.deviceSequence);

  const results: Resolution[] = [];

  for (const event of ordered) {
    const { data, error } = await supabase.rpc('submit_offline_time_event', {
      p_device_id: kiosk.deviceId,
      p_employee_opaque_id: event.employeeOpaqueId,
      p_event_type: event.eventType,
      p_idempotency_key: event.idempotencyKey,
      p_occurred_at_device: event.occurredAtDevice,
      p_device_sequence: event.deviceSequence,
      p_pin_version: event.pinVersion,
      p_shift_id: event.shiftId,
      p_break_type: event.breakType ?? null,
      p_photo_path: event.photoPath,
    });

    if (error) {
      results.push({
        idempotencyKey: event.idempotencyKey,
        status: classifyError(error.code),
        reason: reasonFor(error.code),
      });
      continue;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const flags: string[] = row?.flags ?? [];

    // Un desvío de reloj grande no invalida el fichaje, pero el gerente tiene que
    // verlo: la hora oficial de ese evento es la de un dispositivo desajustado.
    const needsReview = flags.includes('clock_drift');

    results.push({
      idempotencyKey: event.idempotencyKey,
      status: needsReview ? 'needs_review' : (row?.status ?? 'accepted'),
      reason: needsReview ? 'clock_drift' : undefined,
      attendanceState: row?.attendance_state,
      eventId: row?.event_id ?? undefined,
    });
  }

  // `last_sync_at` = ultima vez que ESTE dispositivo vacio su cola. Es lo unico que
  // lo escribe, y por eso queda null en un iPad que nunca se queda sin red: eso es
  // correcto y significa "nunca tuvo nada que sincronizar".
  //
  // El aviso de "reloj sin sincronizar" de §19 NO mide esto: mide `last_seen_at`,
  // que `authenticate_kiosk` actualiza en cada peticion. Medirlo aqui era un fallo
  // que hacia disparar la alerta todos los dias en kioscos sanos. Ver
  // 20260827002000_aviso_ultimo_contacto.sql.
  //
  // Se comprueba el error: era una de las dos unicas escrituras del proyecto que no
  // lo hacia. No se falla la peticion por esto —los fichajes ya se registraron— pero
  // un fallo silencioso aqui haria que el panel mostrara una cola que no se vacia.
  const marca = await supabase
    .from('kiosk_devices')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('id', kiosk.deviceId);

  if (marca.error) {
    console.warn(
      '[krealo-shift] No se pudo marcar last_sync_at del dispositivo ' +
        kiosk.deviceId +
        ': ' +
        marca.error.message,
    );
  }

  const accepted = results.filter(
    (r) => r.status === 'accepted' || r.status === 'duplicate',
  ).length;
  const pending = results.length - accepted;

  return jsonResponse({ results, accepted, pending });
});

/**
 * Un error permanente se marca `rejected` y deja de reintentarse. Uno que puede
 * resolverse con intervención humana queda `needs_review`, en la cola y visible.
 */
function classifyError(code: string | undefined): Resolution['status'] {
  switch (code) {
    // Transición imposible: el estado del servidor no coincide con lo que el iPad
    // creía. Necesita a una persona, no otro reintento.
    case '23514':
      return 'needs_review';
    // Empleado que ya no está en esta tienda, o identificador desconocido.
    case '42501':
      return 'rejected';
    case '28000':
      return 'rejected';
    default:
      return 'needs_review';
  }
}

function reasonFor(code: string | undefined): string {
  switch (code) {
    case '23514':
      return 'transicion_invalida';
    case '42501':
      return 'empleado_no_asignado_a_esta_tienda';
    case '28000':
      return 'dispositivo_revocado';
    default:
      return code ?? 'desconocido';
  }
}
