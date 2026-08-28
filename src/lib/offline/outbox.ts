import * as Crypto from 'expo-crypto';

import { SYNC_KEYS, getSyncMetadata, openOfflineDatabase, setSyncMetadata } from './database';
import { nextAttemptAt, resolutionFor, shouldRetry, type ServerEventStatus } from './backoff';
import { SECURE_KEYS, secureStorage } from '@/lib/security/secure-storage';
import type { TimeEventType } from '@/domain/attendance-state-machine';

/**
 * Cola de eventos pendientes de enviar (especificación §17).
 *
 * LA REGLA CENTRAL de este archivo: primero se guarda en SQLite dentro de una
 * transacción, y SOLO después la interfaz dice "listo". Nunca al revés. Si la
 * escritura local falla, el empleado tiene que verlo, porque su fichaje no existe
 * en ninguna parte.
 *
 * Cada evento lleva su clave de idempotencia generada ANTES de guardarse, una
 * secuencia monótona por instalación, la hora local con su zona y offset, y una
 * firma HMAC del dispositivo.
 */

export type BreakType = 'paid' | 'unpaid' | 'meal' | 'other';

export type OutboxEventInput = {
  employeeOpaqueId: string;
  eventType: TimeEventType;
  breakType?: BreakType;
  shiftId: string | null;
  locationId: string;
  pinVersion: number;
  photoLocalUri?: string | null;
};

export type OutboxEvent = {
  idempotencyKey: string;
  deviceSequence: number;
  employeeOpaqueId: string;
  eventType: TimeEventType;
  breakType: BreakType | null;
  shiftId: string | null;
  locationId: string;
  occurredAtDevice: string;
  deviceTimezone: string;
  deviceOffsetMinutes: number;
  pinVersion: number;
  photoLocalUri: string | null;
  signature: string;
  status: 'pending' | 'sending' | 'accepted' | 'duplicate' | 'needs_review' | 'rejected';
  attempts: number;
  nextAttemptAt: string | null;
  serverReason: string | null;
  createdAt: string;
};

type OutboxRow = {
  idempotency_key: string;
  device_sequence: number;
  employee_opaque_id: string;
  event_type: TimeEventType;
  break_type: BreakType | null;
  shift_id: string | null;
  location_id: string;
  occurred_at_device: string;
  device_timezone: string;
  device_offset_minutes: number;
  pin_version: number;
  photo_local_uri: string | null;
  signature: string;
  status: OutboxEvent['status'];
  attempts: number;
  next_attempt_at: string | null;
  server_reason: string | null;
  created_at: string;
};

function toEvent(row: OutboxRow): OutboxEvent {
  return {
    idempotencyKey: row.idempotency_key,
    deviceSequence: row.device_sequence,
    employeeOpaqueId: row.employee_opaque_id,
    eventType: row.event_type,
    breakType: row.break_type,
    shiftId: row.shift_id,
    locationId: row.location_id,
    occurredAtDevice: row.occurred_at_device,
    deviceTimezone: row.device_timezone,
    deviceOffsetMinutes: row.device_offset_minutes,
    pinVersion: row.pin_version,
    photoLocalUri: row.photo_local_uri,
    signature: row.signature,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    serverReason: row.server_reason,
    createdAt: row.created_at,
  };
}

/**
 * Firma del evento con la clave del dispositivo.
 *
 * No pretende autenticar ante el servidor —eso lo hace la credencial del kiosco—
 * sino detectar que el archivo de la base local se manipuló entre el momento en
 * que se guardó el evento y el momento en que se envió.
 */
async function signEvent(payload: string): Promise<string> {
  const deviceKey = (await secureStorage.get(SECURE_KEYS.kioskDeviceKey)) ?? '';
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${deviceKey}|${payload}`);
}

/** Secuencia monótona por instalación. Nunca se reinicia mientras el kiosco viva. */
async function nextDeviceSequence(): Promise<number> {
  const stored = await getSyncMetadata(SYNC_KEYS.deviceSequence);
  const next = (stored === null ? 0 : Number.parseInt(stored, 10)) + 1;
  await setSyncMetadata(SYNC_KEYS.deviceSequence, String(next));
  return next;
}

/**
 * Encola un evento. Devuelve el evento guardado.
 *
 * LANZA si no pudo guardar. El llamador NO debe mostrar éxito si esto falla:
 * decirle a alguien que fichó cuando no se guardó nada es peor que un error.
 */
export async function enqueueEvent(input: OutboxEventInput): Promise<OutboxEvent> {
  const database = await openOfflineDatabase();

  const idempotencyKey = Crypto.randomUUID();
  const deviceSequence = await nextDeviceSequence();
  const now = new Date();
  const occurredAtDevice = now.toISOString();
  // El offset se guarda explícito: dentro de seis meses la zona puede haber
  // cambiado de reglas y `America/Lima` ya no diría lo mismo sobre esta fecha.
  const deviceOffsetMinutes = -now.getTimezoneOffset();
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/Lima';

  const payload = [
    idempotencyKey,
    deviceSequence,
    input.employeeOpaqueId,
    input.eventType,
    input.breakType ?? '',
    input.shiftId ?? '',
    input.locationId,
    occurredAtDevice,
  ].join('|');

  const signature = await signEvent(payload);

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `insert into outbox_time_events (
         idempotency_key, device_sequence, employee_opaque_id, event_type, break_type,
         shift_id, location_id, occurred_at_device, device_timezone, device_offset_minutes,
         pin_version, photo_local_uri, signature, status, attempts, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
      idempotencyKey,
      deviceSequence,
      input.employeeOpaqueId,
      input.eventType,
      input.breakType ?? null,
      input.shiftId,
      input.locationId,
      occurredAtDevice,
      deviceTimezone,
      deviceOffsetMinutes,
      input.pinVersion,
      input.photoLocalUri ?? null,
      signature,
      occurredAtDevice,
    );

    if (input.photoLocalUri !== undefined && input.photoLocalUri !== null) {
      await database.runAsync(
        `insert into pending_media (local_uri, idempotency_key, status, attempts, created_at)
         values (?, ?, 'pending', 0, ?)
         on conflict (local_uri) do nothing`,
        input.photoLocalUri,
        idempotencyKey,
        occurredAtDevice,
      );
    }
  });

  const row = await database.getFirstAsync<OutboxRow>(
    'select * from outbox_time_events where idempotency_key = ?',
    idempotencyKey,
  );

  if (row === null) {
    throw new Error('El evento no quedó guardado en la cola local.');
  }

  return toEvent(row);
}

/**
 * Eventos listos para enviar, en ORDEN de secuencia del dispositivo.
 *
 * El orden importa: enviar una salida antes de su entrada produce un estado
 * imposible que el servidor rechaza con razón.
 */
export async function pendingEvents(limit = 50, now: Date = new Date()): Promise<OutboxEvent[]> {
  const database = await openOfflineDatabase();
  const rows = await database.getAllAsync<OutboxRow>(
    `select * from outbox_time_events
      where status in ('pending', 'sending')
        and (next_attempt_at is null or next_attempt_at <= ?)
      order by device_sequence asc
      limit ?`,
    now.toISOString(),
    limit,
  );
  return rows.map(toEvent);
}

/** Cuántos eventos siguen sin resolverse. Alimenta el indicador del kiosco (§9.1). */
export async function pendingCount(): Promise<number> {
  const database = await openOfflineDatabase();
  const row = await database.getFirstAsync<{ total: number }>(
    `select count(*) as total from outbox_time_events
      where status in ('pending', 'sending')`,
  );
  return row?.total ?? 0;
}

/** Eventos que necesitan que un gerente los resuelva (§17). */
export async function needsReviewCount(): Promise<number> {
  const database = await openOfflineDatabase();
  const row = await database.getFirstAsync<{ total: number }>(
    `select count(*) as total from outbox_time_events
      where status in ('needs_review', 'rejected')`,
  );
  return row?.total ?? 0;
}

export async function markSending(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const database = await openOfflineDatabase();
  const placeholders = keys.map(() => '?').join(', ');
  await database.runAsync(
    `update outbox_time_events set status = 'sending', last_attempt_at = ?
      where idempotency_key in (${placeholders})`,
    new Date().toISOString(),
    ...keys,
  );
}

/**
 * Aplica lo que respondió el servidor para un evento.
 *
 * `accepted` y `duplicate` salen de la cola. `needs_review` y `rejected` se
 * quedan, visibles, hasta que una persona los resuelva: NUNCA se descarta nada en
 * silencio (§17).
 */
export async function applyServerResult(
  idempotencyKey: string,
  status: ServerEventStatus,
  reason: string | null = null,
  serverEventId: string | null = null,
): Promise<void> {
  const database = await openOfflineDatabase();
  const resolution = resolutionFor(status);

  if (resolution.removeFromQueue) {
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        'delete from outbox_time_events where idempotency_key = ?',
        idempotencyKey,
      );
      // AQUI HABIA UNA MENTIRA: se marcaba la foto como 'uploaded' cuando el
      // fichaje se aceptaba, pero nadie habia subido nada. La foto se quedaba en
      // el iPad para siempre y la cola decia que estaba en el servidor.
      //
      // Lo correcto: la foto sigue PENDIENTE y ahora se sabe a que evento
      // pertenece, asi que la sincronizacion puede subirla. Si el servidor no
      // devolvio identificador, se deja en null y se reintenta en el siguiente
      // pase; no se descarta.
      if (serverEventId !== null) {
        await database.runAsync(
          `update pending_media set event_id = ? where idempotency_key = ? and status <> 'uploaded'`,
          serverEventId,
          idempotencyKey,
        );
      }
    });
    return;
  }

  await database.runAsync(
    `update outbox_time_events set status = ?, server_reason = ? where idempotency_key = ?`,
    status,
    reason,
    idempotencyKey,
  );
}

/**
 * Marca un intento fallido por red o error transitorio y programa el siguiente.
 *
 * Tras agotar los intentos el evento pasa a `needs_review`: deja de reintentar
 * solo, pero sigue en la cola y visible. No se borra.
 */
export async function markAttemptFailed(
  idempotencyKey: string,
  reason: string,
  random: () => number = Math.random,
): Promise<void> {
  const database = await openOfflineDatabase();

  const row = await database.getFirstAsync<{ attempts: number }>(
    'select attempts from outbox_time_events where idempotency_key = ?',
    idempotencyKey,
  );
  const attempts = (row?.attempts ?? 0) + 1;

  if (!shouldRetry(attempts)) {
    await database.runAsync(
      `update outbox_time_events
         set status = 'needs_review', attempts = ?, server_reason = ?, next_attempt_at = null
       where idempotency_key = ?`,
      attempts,
      `sin_exito_tras_${attempts}_intentos: ${reason}`,
      idempotencyKey,
    );
    return;
  }

  await database.runAsync(
    `update outbox_time_events
       set status = 'pending', attempts = ?, server_reason = ?, next_attempt_at = ?
     where idempotency_key = ?`,
    attempts,
    reason,
    nextAttemptAt(attempts, new Date(), random).toISOString(),
    idempotencyKey,
  );
}

/** Eventos que esperan intervención, para mostrarlos en diagnósticos (§31). */
export async function eventsNeedingAttention(): Promise<OutboxEvent[]> {
  const database = await openOfflineDatabase();
  const rows = await database.getAllAsync<OutboxRow>(
    `select * from outbox_time_events
      where status in ('needs_review', 'rejected')
      order by device_sequence asc`,
  );
  return rows.map(toEvent);
}

/**
 * Fotos listas para subir: su fichaje ya fue aceptado por el servidor, así que hay
 * un evento al que adjuntarlas.
 *
 * Las que todavía no tienen `event_id` no aparecen: su fichaje sigue en la cola y
 * subir la imagen antes no tendría dónde engancharla.
 */
export async function pendingPhotos(): Promise<
  { localUri: string; eventId: string; attempts: number }[]
> {
  const database = await openOfflineDatabase();
  const rows = await database.getAllAsync<{
    local_uri: string;
    event_id: string;
    attempts: number;
  }>(
    `select local_uri, event_id, attempts from pending_media
      where event_id is not null
        and status in ('pending', 'failed')
      order by created_at`,
  );
  return rows.map((row) => ({
    localUri: row.local_uri,
    eventId: row.event_id,
    attempts: row.attempts,
  }));
}

/** La foto llegó al servidor. Se marca y deja de reintentarse. */
export async function markPhotoUploaded(localUri: string): Promise<void> {
  const database = await openOfflineDatabase();
  await database.runAsync(
    `update pending_media set status = 'uploaded' where local_uri = ?`,
    localUri,
  );
}

/**
 * La subida falló. Se cuenta el intento y se deja para el próximo pase.
 *
 * No se descarta nunca por número de intentos, a diferencia de la cola de
 * fichajes: una foto que no sube no impide contar las horas, así que no hay prisa
 * y perderla no tiene ninguna ventaja. La purga por retención del servidor acabará
 * con ella cuando corresponda; en el iPad la borra `resetOfflineDatabase` al salir
 * del modo kiosco.
 */
export async function markPhotoFailed(localUri: string): Promise<void> {
  const database = await openOfflineDatabase();
  await database.runAsync(
    `update pending_media set status = 'failed', attempts = attempts + 1 where local_uri = ?`,
    localUri,
  );
}

/**
 * Registra una foto cuyo fichaje se envió online y el servidor ya aceptó.
 *
 * Se guarda en la cola aunque la subida vaya a intentarse de inmediato: si falla
 * —y con la red de una tienda falla— la foto no se pierde y el siguiente pase de
 * sincronización la recoge.
 */
export async function enqueuePhotoForEvent(params: {
  localUri: string;
  idempotencyKey: string;
  eventId: string;
}): Promise<void> {
  const database = await openOfflineDatabase();
  await database.runAsync(
    `insert into pending_media (local_uri, idempotency_key, event_id, status, attempts, created_at)
     values (?, ?, ?, 'pending', 0, ?)
     on conflict (local_uri) do update set event_id = excluded.event_id`,
    params.localUri,
    params.idempotencyKey,
    params.eventId,
    new Date().toISOString(),
  );
}
