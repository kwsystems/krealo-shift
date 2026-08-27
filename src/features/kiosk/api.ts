import { z } from 'zod';

import { getSupabase } from '@/lib/supabase/client';
import { SECURE_KEYS, secureStorage } from '@/lib/security/secure-storage';
import type { KioskBinding } from '@/stores/kiosk-store';

/**
 * Contrato tipado con las Edge Functions del kiosco (especificación §16).
 *
 * Todas las respuestas se validan con Zod al recibir, no solo al enviar (§22): un
 * backend que cambia de forma silenciosa no debe romper la app con un error
 * ilegible en medio de un fichaje.
 *
 * Ninguna de estas funciones inserta directamente en `time_events`: eso lo hace
 * el servidor tras validar credencial, PIN, estado, tienda e idempotencia (§14).
 */

export type KioskApiError =
  | { kind: 'not_configured' }
  | { kind: 'offline' }
  | { kind: 'revoked' }
  | { kind: 'invalid_pin'; remainingAttempts: number | null }
  | { kind: 'locked'; lockedUntil: string }
  | { kind: 'wrong_location' }
  | { kind: 'invalid_transition' }
  | { kind: 'server'; message: string };

export type KioskApiResult<T> = { ok: true; data: T } | { ok: false; error: KioskApiError };

const policiesSchema = z.object({
  pinLength: z.number().int().min(4).max(6),
  photoEnabled: z.boolean(),
  earlyClockInMinutes: z.number().int().min(0),
  lateGraceMinutes: z.number().int().min(0),
  allowUnscheduledShifts: z.boolean(),
  timeFormat: z.enum(['12h', '24h']),
  requiredBreakMinutes: z.number().int().min(0),
});

const activateResponseSchema = z.object({
  credential: z.string().min(20),
  deviceKey: z.string().min(20),
  device: z.object({
    id: z.string().uuid(),
    publicId: z.string().min(1),
    displayName: z.string().min(1),
  }),
  organization: z.object({ id: z.string().uuid(), name: z.string().min(1) }),
  location: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    timezone: z.string().min(1),
  }),
  policies: policiesSchema,
});

const verifyPinResponseSchema = z.object({
  actionToken: z.string().min(20),
  expiresAt: z.string(),
  employee: z.object({
    opaqueId: z.string().min(1),
    displayName: z.string().min(1),
    initials: z.string().min(1),
    jobRoleName: z.string().nullable(),
    // Lo decide el servidor: el kiosco no puede deducir quien es gerente.
    canManageLocation: z.boolean().default(false),
  }),
  attendanceState: z.enum(['OFF_SHIFT', 'WORKING', 'ON_BREAK']),
  allowedActions: z.array(z.enum(['clock_in', 'break_start', 'break_end', 'clock_out'])),
  eligibleShifts: z.array(
    z.object({
      id: z.string().uuid(),
      startsAt: z.string(),
      endsAt: z.string(),
      jobRoleName: z.string().nullable(),
      employeeNote: z.string().nullable(),
      plannedUnpaidBreakMinutes: z.number().int().min(0),
      changedSinceLastPublication: z.boolean(),
    }),
  ),
  openSession: z
    .object({
      startedAt: z.string(),
      shiftEndsAt: z.string().nullable(),
      // Minutos de descanso ya tomados y minutos obligatorios de la ubicacion:
      // con estos dos el kiosco sabe si al salir falta el descanso, sin tener
      // que replicar la regla de la base.
      takenBreakMinutes: z.number().int().min(0).default(0),
      requiredBreakMinutes: z.number().int().min(0).default(0),
      openBreak: z.object({ startedAt: z.string(), breakType: z.string() }).nullable(),
    })
    .nullable(),
  earliestClockInAt: z.string().nullable(),
});

export type VerifyPinResponse = z.infer<typeof verifyPinResponseSchema>;
export type EligibleShift = VerifyPinResponse['eligibleShifts'][number];
export type AttendanceState = VerifyPinResponse['attendanceState'];
export type TimeEventType = VerifyPinResponse['allowedActions'][number];

const submitEventResponseSchema = z.object({
  status: z.enum(['accepted', 'duplicate', 'needs_review', 'rejected']),
  // Identificador del evento en el servidor: hace falta para adjuntarle la foto
  // despues. Opcional porque un `duplicate` puede volver sin el.
  eventId: z.string().uuid().nullable().optional(),
  attendanceState: z.enum(['OFF_SHIFT', 'WORKING', 'ON_BREAK']),
  occurredAt: z.string(),
  serverReceivedAt: z.string(),
  flags: z.array(z.string()),
  summary: z.object({
    shiftEndsAt: z.string().nullable(),
    netMinutesToday: z.number().int().min(0),
  }),
});

export type SubmitEventResponse = z.infer<typeof submitEventResponseSchema>;

async function invoke<T>(
  functionName: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<KioskApiResult<T>> {
  const supabase = getSupabase();
  if (supabase === null) return { ok: false, error: { kind: 'not_configured' } };

  // Las Edge Functions exigen DOS cabeceras: el secreto y el identificador
  // publico del dispositivo. Con una sola, `authenticate_kiosk` no puede saber
  // contra que hash comparar y rechaza la llamada.
  const credential = await secureStorage.get(`${SECURE_KEYS.kioskCredential}.secret`);
  const binding = await secureStorage.getJson<{ devicePublicId?: string }>(
    SECURE_KEYS.kioskCredential,
  );
  const publicId = binding?.devicePublicId ?? null;

  const kioskHeaders =
    credential !== null && publicId !== null
      ? { 'x-kiosk-credential': credential, 'x-kiosk-device': publicId }
      : undefined;

  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body,
      headers: kioskHeaders,
    });

    if (error !== null) {
      return { ok: false, error: mapInvokeError(error, data) };
    }

    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      return {
        ok: false,
        error: { kind: 'server', message: `Respuesta inesperada de ${functionName}` },
      };
    }
    return { ok: true, data: parsed.data };
  } catch {
    // Un fallo de red no es un error de la app: el llamador decide si encola el
    // evento en la outbox (§17).
    return { ok: false, error: { kind: 'offline' } };
  }
}

/** Traduce el error del backend a un caso que la interfaz sabe explicar (§20). */
function mapInvokeError(error: unknown, payload: unknown): KioskApiError {
  const shape = z
    .object({
      code: z
        .enum(['revoked', 'invalid_pin', 'locked', 'wrong_location', 'invalid_transition'])
        .optional(),
      remainingAttempts: z.number().int().nullable().optional(),
      lockedUntil: z.string().optional(),
    })
    .safeParse(payload);

  if (shape.success && shape.data.code !== undefined) {
    switch (shape.data.code) {
      case 'revoked':
        return { kind: 'revoked' };
      case 'invalid_pin':
        return { kind: 'invalid_pin', remainingAttempts: shape.data.remainingAttempts ?? null };
      case 'locked':
        return { kind: 'locked', lockedUntil: shape.data.lockedUntil ?? '' };
      case 'wrong_location':
        return { kind: 'wrong_location' };
      case 'invalid_transition':
        return { kind: 'invalid_transition' };
    }
  }

  const message = error instanceof Error ? error.message : 'unknown';
  return { kind: 'server', message };
}

/** §16 `activate-kiosk`: vincula este dispositivo a UNA ubicación. */
export async function activateKiosk(params: {
  activationCode: string;
  installationId: string;
  displayName: string;
  appVersion: string;
}): Promise<KioskApiResult<KioskBinding & { credential: string; deviceKey: string }>> {
  const result = await invoke('activate-kiosk', params, activateResponseSchema);
  if (!result.ok) return result;

  const d = result.data;
  return {
    ok: true,
    data: {
      credential: d.credential,
      deviceKey: d.deviceKey,
      deviceId: d.device.id,
      devicePublicId: d.device.publicId,
      displayName: d.device.displayName,
      organizationId: d.organization.id,
      organizationName: d.organization.name,
      locationId: d.location.id,
      locationName: d.location.name,
      timezone: d.location.timezone,
      policies: d.policies,
      activatedAt: new Date().toISOString(),
    },
  };
}

/**
 * §16 `verify-pin`: valida el PIN online, limita intentos y devuelve un token de
 * acción de corta duración ligado a empleado, kiosco y ubicación.
 *
 * El PIN se envía y se olvida: no se guarda en ningún store ni log (§22).
 */
export async function verifyPin(params: {
  pin: string;
  locationId: string;
}): Promise<KioskApiResult<VerifyPinResponse>> {
  return invoke('verify-pin', params, verifyPinResponseSchema);
}

const timeEditRequestResponseSchema = z.object({
  requestId: z.string().uuid(),
  status: z.literal('pending'),
});

/**
 * Solicitud "Olvidé marcar" enviada desde el kiosco (§10.3).
 *
 * Crea una solicitud pendiente y NUNCA modifica la hoja de tiempo: un gerente
 * debe aprobarla o rechazarla, y la decisión queda auditada.
 */
export async function submitTimeEditRequest(params: {
  actionToken: string;
  kind: 'forgot_clock_in' | 'forgot_break' | 'forgot_clock_out';
  proposedAt: string;
  reason: string;
}): Promise<KioskApiResult<z.infer<typeof timeEditRequestResponseSchema>>> {
  return invoke('submit-time-edit-request', params, timeEditRequestResponseSchema);
}

/** §16 `submit-time-event`: crea el evento validando estado, turno e idempotencia. */
export async function submitTimeEvent(params: {
  actionToken: string;
  eventType: TimeEventType;
  breakType?: 'paid' | 'unpaid' | 'meal' | 'other';
  shiftId: string | null;
  idempotencyKey: string;
  occurredAtDevice: string;
  deviceSequence: number;
  isOffline: boolean;
}): Promise<KioskApiResult<SubmitEventResponse>> {
  // Sin `photoPath`: la ruta la deriva el servidor y la foto se adjunta despues
  // con `attachPhoto`, cuando el archivo ya esta arriba. Antes se enviaba aqui el
  // URI local del archivo en el iPad, que en la base de datos no significa nada.
  return invoke('submit-time-event', params, submitEventResponseSchema);
}

const attachPhotoResponseSchema = z.object({
  ok: z.literal(true),
  photoPath: z.string().min(1),
});

/**
 * §16 `attach-photo`: sube la foto de un fichaje que el servidor ya acepto.
 *
 * La imagen viaja en base64 dentro del cuerpo. Es deliberado: el bucket limita a
 * 2 MB y a cambio de ese ancho de banda, `photo_path` se escribe DESPUES de que el
 * archivo este arriba, y el iPad nunca recibe permiso de escritura sobre Storage.
 * Ver supabase/functions/attach-photo/index.ts.
 */
export async function attachPhoto(params: {
  eventId: string;
  imageBase64: string;
  contentType?: 'image/jpeg' | 'image/webp';
}): Promise<KioskApiResult<z.infer<typeof attachPhotoResponseSchema>>> {
  return invoke('attach-photo', params, attachPhotoResponseSchema);
}

// ---------------------------------------------------------------------------
// Sincronizacion offline y paquete del kiosco
// ---------------------------------------------------------------------------

const syncResultSchema = z.object({
  results: z.array(
    z.object({
      idempotencyKey: z.string().uuid(),
      status: z.enum(['accepted', 'duplicate', 'needs_review', 'rejected']),
      reason: z.string().optional(),
      attendanceState: z.enum(['OFF_SHIFT', 'WORKING', 'ON_BREAK']).optional(),
      eventId: z.string().uuid().optional(),
    }),
  ),
  accepted: z.number().int().min(0),
  pending: z.number().int().min(0),
});

export type SyncOfflineResult = z.infer<typeof syncResultSchema>;

/**
 * §16 `sync-offline-events`: envia un lote pequeno y ordenado de eventos que el
 * iPad guardo sin conexion. El servidor responde por evento y nunca descarta nada
 * en silencio (§17).
 */
export async function syncOfflineEvents(params: {
  events: readonly {
    idempotencyKey: string;
    employeeOpaqueId: string;
    eventType: TimeEventType;
    breakType?: 'paid' | 'unpaid' | 'meal' | 'other';
    shiftId: string | null;
    occurredAtDevice: string;
    deviceSequence: number;
    pinVersion: number;
    offlineVerified: true;
  }[];
}): Promise<KioskApiResult<SyncOfflineResult>> {
  return invoke('sync-offline-events', { events: params.events }, syncResultSchema);
}

const rosterSchema = z.object({
  location: z.object({
    id: z.string().uuid(),
    name: z.string(),
    timezone: z.string(),
  }),
  policies: policiesSchema,
  roster: z.array(
    z.object({
      opaqueId: z.string().min(1),
      displayName: z.string().min(1),
      jobRoleName: z.string().nullable().default(null),
    }),
  ),
  shifts: z.array(
    z.object({
      id: z.string().uuid(),
      employeeOpaqueId: z.string().min(1),
      startsAt: z.string(),
      endsAt: z.string(),
      jobRoleName: z.string().nullable(),
      employeeNote: z.string().nullable(),
      plannedUnpaidBreakMinutes: z.number().int().min(0),
      changedSinceLastPublication: z.boolean(),
    }),
  ),
  // Verificadores para validar el PIN sin conexion. El servidor manda el salt de
  // bcrypt y un verificador derivado con la clave de ESTE dispositivo, nunca el
  // hash: ver 20260827000700_offline_verifier_device_key.sql.
  //
  // Los minimos de longitud no son decorativos. Un salt de bcrypt son exactamente
  // 29 caracteres y un sha256 en hexadecimal exactamente 64; si el servidor
  // mandara otra cosa —el hash completo, por ejemplo— la validacion falla aqui en
  // vez de guardarse en el iPad.
  verifiers: z.array(
    z.object({
      employeeOpaqueId: z.string().min(1),
      pinSalt: z.string().length(29),
      pinVerifier: z.string().length(64),
      pinLength: z.number().int().min(4).max(6),
      pinVersion: z.number().int().min(1),
    }),
  ),
  refreshedAt: z.string(),
});

export type KioskRoster = z.infer<typeof rosterSchema>;

/** §16 `refresh-kiosk-roster`: el paquete minimo para operar, incluido offline. */
export async function refreshKioskRoster(): Promise<KioskApiResult<KioskRoster>> {
  return invoke('refresh-kiosk-roster', {}, rosterSchema);
}
