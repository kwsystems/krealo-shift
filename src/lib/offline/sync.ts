import { SYNC_KEYS, setSyncMetadata } from './database';
import {
  applyServerResult,
  markAttemptFailed,
  markSending,
  needsReviewCount,
  pendingCount,
  pendingEvents,
  type OutboxEvent,
} from './outbox';
import { storeOfflineVerifiers } from './pin';
import { syncOfflineEvents, refreshKioskRoster } from '@/features/kiosk/api';
import { useNetworkStore } from '@/stores/network-store';

/**
 * Motor de sincronización (especificación §17).
 *
 * Cuándo sincroniza: al recuperar la red, al volver a foreground, por acción
 * manual y periódicamente mientras la app está activa. Todo eso lo dispara quien
 * llama; aquí vive la lógica de una pasada.
 *
 * Garantías que da:
 *   - una sola pasada a la vez, aunque cuatro disparadores coincidan;
 *   - envío en ORDEN de secuencia del dispositivo;
 *   - nada se descarta en silencio: lo que el servidor no puede aplicar se queda
 *     en la cola marcado para revisión;
 *   - la interfaz siempre refleja cuántos eventos quedan.
 */

const BATCH_SIZE = 25;

let running = false;

export type SyncOutcome = {
  attempted: number;
  accepted: number;
  needsAttention: number;
  /** `true` si no se pudo contactar al servidor. No es un fallo del dispositivo. */
  offline: boolean;
};

/** Refleja en el store lo que hay en la cola, para el indicador del kiosco. */
export async function refreshQueueIndicators(): Promise<void> {
  const [pending, attention] = await Promise.all([pendingCount(), needsReviewCount()]);
  useNetworkStore.getState().setPendingCount(pending);
  useNetworkStore.getState().setNeedsReviewCount(attention);
}

/**
 * Una pasada de sincronización.
 *
 * Es reentrante-segura: si ya hay una corriendo, devuelve sin hacer nada en lugar
 * de duplicar envíos. Cuatro disparadores a la vez es lo normal cuando vuelve la
 * red justo al abrir la app.
 */
export async function runSync(): Promise<SyncOutcome> {
  if (running) {
    return { attempted: 0, accepted: 0, needsAttention: 0, offline: false };
  }
  running = true;

  const store = useNetworkStore.getState();
  store.setSyncing(true);

  try {
    const batch = await pendingEvents(BATCH_SIZE);

    if (batch.length === 0) {
      await refreshQueueIndicators();
      store.markSynced();
      await setSyncMetadata(SYNC_KEYS.lastSyncAt, new Date().toISOString());
      return { attempted: 0, accepted: 0, needsAttention: 0, offline: false };
    }

    await markSending(batch.map((event) => event.idempotencyKey));

    const result = await syncOfflineEvents({
      events: batch.map(toWirePayload),
    });

    if (!result.ok) {
      // Sin red o servidor caído: se marca el intento y se reprograma con backoff.
      // Los eventos siguen en la cola; ninguno se pierde.
      const reason = result.error.kind === 'offline' ? 'sin_conexion' : result.error.kind;
      for (const event of batch) {
        await markAttemptFailed(event.idempotencyKey, reason);
      }
      await refreshQueueIndicators();
      store.setSyncing(false);
      return {
        attempted: batch.length,
        accepted: 0,
        needsAttention: 0,
        offline: result.error.kind === 'offline',
      };
    }

    let accepted = 0;
    let attention = 0;

    for (const item of result.data.results) {
      await applyServerResult(item.idempotencyKey, item.status, item.reason ?? null);
      if (item.status === 'accepted' || item.status === 'duplicate') accepted += 1;
      else attention += 1;
    }

    // Un evento del lote sobre el que el servidor no dijo nada NO se da por
    // enviado: se reprograma. El silencio no es una confirmación.
    const answered = new Set(result.data.results.map((item) => item.idempotencyKey));
    for (const event of batch) {
      if (!answered.has(event.idempotencyKey)) {
        await markAttemptFailed(event.idempotencyKey, 'sin_respuesta_del_servidor');
      }
    }

    await refreshQueueIndicators();
    await setSyncMetadata(SYNC_KEYS.lastSyncAt, new Date().toISOString());
    store.markSynced();

    return { attempted: batch.length, accepted, needsAttention: attention, offline: false };
  } finally {
    running = false;
    useNetworkStore.getState().setSyncing(false);
  }
}

function toWirePayload(event: OutboxEvent) {
  return {
    idempotencyKey: event.idempotencyKey,
    employeeOpaqueId: event.employeeOpaqueId,
    eventType: event.eventType,
    breakType: event.breakType ?? undefined,
    shiftId: event.shiftId,
    occurredAtDevice: event.occurredAtDevice,
    deviceSequence: event.deviceSequence,
    pinVersion: event.pinVersion,
    // Los eventos de la cola se validaron con el verificador local, no con un
    // token de acción del servidor: el token vive 90 segundos y el iPad pudo
    // pasar horas sin red. El servidor lo registra marcado como offline.
    offlineVerified: true as const,
  };
}

/**
 * Refresca el equipo, los turnos, las políticas y los verificadores de PIN.
 *
 * Se llama al activar el kiosco y periódicamente: sin esto, un empleado nuevo no
 * podría fichar sin red, y uno que salió de la tienda seguiría pudiendo.
 */
export async function refreshOfflinePackage(): Promise<{ ok: boolean }> {
  const result = await refreshKioskRoster();
  if (!result.ok) return { ok: false };

  await storeOfflineVerifiers(
    result.data.verifiers.map((verifier) => ({
      employeeOpaqueId: verifier.employeeOpaqueId,
      pinOfflineHash: verifier.pinOfflineHash,
      pinLength: verifier.pinLength,
      pinVersion: verifier.pinVersion,
    })),
  );

  await setSyncMetadata(SYNC_KEYS.lastRosterRefreshAt, new Date().toISOString());
  return { ok: true };
}
