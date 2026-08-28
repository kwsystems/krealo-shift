import { SYNC_KEYS, getSyncMetadata, setSyncMetadata } from './database';
import * as FileSystem from 'expo-file-system';

import {
  applyServerResult,
  markAttemptFailed,
  markSending,
  needsReviewCount,
  pendingCount,
  pendingEvents,
  type OutboxEvent,
  markPhotoFailed,
  markPhotoUploaded,
  pendingPhotos,
} from './outbox';
import { storeOfflineVerifiers } from './pin';
import { attachPhoto, syncOfflineEvents, refreshKioskRoster } from '@/features/kiosk/api';
import { cacheRosterAndShifts } from '@/features/kiosk/offline-session';
import { useKioskStore } from '@/stores/kiosk-store';
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
  /**
   * Fallo INESPERADO del propio dispositivo: SQLite bloqueada, disco lleno, la base
   * local sin abrir. Distinto de `offline`, que es una condición normal y prevista.
   *
   * Se informa por valor y no lanzando, porque estas funciones se llaman con `void`
   * desde ocho sitios y un rechazo ahí sería una excepción sin capturar. Ver
   * `noLanzar`.
   */
  failure: string | null;
};

/** Resultado de un pase que no llegó a empezar. */
const SIN_TRABAJO: SyncOutcome = {
  attempted: 0,
  accepted: 0,
  needsAttention: 0,
  offline: false,
  failure: null,
};

/**
 * Anota un fallo inesperado y lo deja donde alguien lo pueda ver.
 *
 * NO ES TRAGARSE EL ERROR. Las tres entradas de este módulo no lanzan a propósito
 * —se llaman con `void` desde ocho sitios y un rechazo sería una excepción sin
 * capturar, una por minuto mientras el kiosco esté activo—, pero un error que no
 * deja rastro es peor que uno ruidoso: la cola dejaría de vaciarse, el indicador se
 * quedaría con el último valor bueno, y el síntoma que llegaría de la tienda sería
 * "las horas de ayer no aparecen".
 *
 * Así que queda en dos sitios: la consola, y los metadatos, que es lo que muestra el
 * diagnóstico del kiosco.
 */
async function anotarFallo(donde: string, error: unknown): Promise<string> {
  const mensaje = `${donde}: ${error instanceof Error ? error.message : String(error)}`;
  console.warn('[krealo-shift] Fallo del motor de sincronización. ' + mensaje);
  try {
    await setSyncMetadata(SYNC_KEYS.lastSyncError, `${new Date().toISOString()} ${mensaje}`);
  } catch {
    // Si ni siquiera se puede escribir en la base local, no queda nada más que
    // hacer: el aviso de consola ya salió.
  }
  return mensaje;
}

/** Último fallo inesperado, para el diagnóstico del kiosco. */
export async function lastSyncFailure(): Promise<string | null> {
  try {
    return await getSyncMetadata(SYNC_KEYS.lastSyncError);
  } catch {
    return null;
  }
}

/**
 * Refleja en el store lo que hay en la cola, para el indicador del kiosco.
 *
 * No lanza: se llama con `void` desde el layout del kiosco y desde la pantalla de
 * acciones. Si falla, los indicadores se quedan con el último valor conocido, que es
 * mejor que un rechazo sin capturar y mejor que ponerlos a cero, que diría "no hay
 * nada pendiente" cuando lo que pasa es que no se pudo contar.
 */
export async function refreshQueueIndicators(): Promise<void> {
  try {
    const [pending, attention] = await Promise.all([pendingCount(), needsReviewCount()]);
    useNetworkStore.getState().setPendingCount(pending);
    useNetworkStore.getState().setNeedsReviewCount(attention);
  } catch (error) {
    await anotarFallo('refreshQueueIndicators', error);
  }
}

/**
 * Una pasada de sincronización.
 *
 * Es reentrante-segura: si ya hay una corriendo, devuelve sin hacer nada en lugar
 * de duplicar envíos. Cuatro disparadores a la vez es lo normal cuando vuelve la
 * red justo al abrir la app.
 */
export async function runSync(): Promise<SyncOutcome> {
  if (running) return SIN_TRABAJO;
  running = true;

  const store = useNetworkStore.getState();
  store.setSyncing(true);

  try {
    const batch = await pendingEvents(BATCH_SIZE);

    if (batch.length === 0) {
      // Cola de fichajes vacia no significa nada pendiente: puede haber fotos de
      // eventos ya aceptados que todavia no subieron.
      await uploadPendingPhotos();
      await refreshQueueIndicators();
      store.markSynced();
      await setSyncMetadata(SYNC_KEYS.lastSyncAt, new Date().toISOString());
      return SIN_TRABAJO;
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
        failure: null,
      };
    }

    let accepted = 0;
    let attention = 0;

    for (const item of result.data.results) {
      await applyServerResult(
        item.idempotencyKey,
        item.status,
        item.reason ?? null,
        item.eventId ?? null,
      );
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

    // Las fotos se suben DESPUES de aplicar los resultados: hasta ahora no se
    // sabia a que evento del servidor pertenecen.
    await uploadPendingPhotos();

    await refreshQueueIndicators();
    await setSyncMetadata(SYNC_KEYS.lastSyncAt, new Date().toISOString());
    store.markSynced();

    return {
      attempted: batch.length,
      accepted,
      needsAttention: attention,
      offline: false,
      failure: null,
    };
  } catch (error) {
    // NO SE PROPAGA. Ver `anotarFallo`. Los eventos siguen en SQLite: lo que falló
    // fue el pase, no la cola, y el siguiente disparador lo vuelve a intentar.
    return { ...SIN_TRABAJO, failure: await anotarFallo('runSync', error) };
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
 *
 * ESO ES LO QUE DECÍA ESTE COMENTARIO Y NO ES LO QUE HACÍA. De las cuatro cosas
 * solo guardaba los verificadores de PIN: `cacheRosterAndShifts` se llamaba
 * únicamente desde `app/kiosk/setup.tsx`, o sea solo al activar el dispositivo. Las
 * consecuencias eran todas silenciosas:
 *
 *   * un empleado contratado después de instalar el iPad no aparecía en el equipo
 *     offline —sí podía fichar CON red, así que el fallo solo se veía el día que se
 *     caía la red, que es justamente el día que importa—;
 *   * uno que salió de la tienda seguía en el equipo offline indefinidamente;
 *   * los turnos sin conexión se quedaban congelados en la semana de la activación;
 *   * cambiar una política —activar la foto, la longitud del PIN, la tolerancia de
 *     entrada temprana— no llegaba nunca a un iPad ya instalado.
 *
 * Y no se veía porque los verificadores SÍ se actualizaban: un PIN nuevo o rotado
 * funcionaba sin red, lo que hace que el mecanismo parezca vivo.
 */
export async function refreshOfflinePackage(): Promise<{ ok: boolean }> {
  try {
    return await refreshOfflinePackageUnsafe();
  } catch (error) {
    // Tampoco lanza: se llama con `void` desde el menú del kiosco. Ver `anotarFallo`.
    await anotarFallo('refreshOfflinePackage', error);
    return { ok: false };
  }
}

async function refreshOfflinePackageUnsafe(): Promise<{ ok: boolean }> {
  const result = await refreshKioskRoster();
  if (!result.ok) return { ok: false };

  // Equipo, turnos y políticas a SQLite. Reemplaza el conjunto entero, que es lo que
  // hace que quien salió de la tienda desaparezca del iPad.
  await cacheRosterAndShifts({
    roster: result.data.roster,
    shifts: result.data.shifts,
    policies: result.data.policies,
  });

  await storeOfflineVerifiers(
    result.data.verifiers.map((verifier) => ({
      employeeOpaqueId: verifier.employeeOpaqueId,
      pinSalt: verifier.pinSalt,
      pinVerifier: verifier.pinVerifier,
      pinLength: verifier.pinLength,
      pinVersion: verifier.pinVersion,
    })),
  );

  // Las políticas van TAMBIÉN al store del kiosco y no solo a SQLite: son las que
  // deciden si la pantalla pide foto y cuántos dígitos tiene el teclado del PIN, y
  // eso lo lee la interfaz del binding, no de la base local.
  const kiosk = useKioskStore.getState();
  await kiosk.updatePolicies(result.data.policies);
  await kiosk.updateOrganization({
    name: result.data.organization.name,
    logoPath: result.data.organization.logoPath,
  });

  await setSyncMetadata(SYNC_KEYS.lastRosterRefreshAt, new Date().toISOString());
  return { ok: true };
}

/**
 * Sube las fotos cuyo fichaje ya está en el servidor.
 *
 * POR QUÉ ES UN PASO APARTE Y POSTERIOR
 * La foto se adjunta a un evento que ya existe, así que no se puede subir hasta
 * que su fichaje haya sido aceptado. Mientras eso no ocurre, la imagen espera en
 * el iPad con `event_id` en null.
 *
 * UNA POR PASE, LAS DEMÁS ESPERAN. Son hasta 2 MB cada una y la red de una tienda
 * es lo que es: subir cinco a la vez alarga el pase de sincronización y compite
 * con los fichajes, que es lo que de verdad importa. Se avanza de a una y el
 * siguiente pase sigue.
 *
 * UN FALLO AQUÍ NO ES UN FALLO DE LA SINCRONIZACIÓN. Las horas trabajadas ya están
 * registradas; la foto es un complemento. Por eso esta función no lanza nunca y no
 * cambia el resultado del pase.
 */
const PHOTOS_PER_PASS = 1;

async function uploadPendingPhotos(): Promise<void> {
  let photos: Awaited<ReturnType<typeof pendingPhotos>>;
  try {
    photos = await pendingPhotos();
  } catch {
    return;
  }

  for (const photo of photos.slice(0, PHOTOS_PER_PASS)) {
    try {
      const info = await FileSystem.getInfoAsync(photo.localUri);
      if (!info.exists) {
        // El archivo ya no está: iOS limpia el directorio de caché cuando le hace
        // falta espacio. Reintentar para siempre algo que no existe no lleva a
        // ninguna parte, así que se cierra.
        await markPhotoUploaded(photo.localUri);
        continue;
      }

      const imageBase64 = await FileSystem.readAsStringAsync(photo.localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const result = await attachPhoto({ eventId: photo.eventId, imageBase64 });

      if (result.ok) {
        await markPhotoUploaded(photo.localUri);
        // Se borra la copia local: ya está en el servidor y es la cara de una
        // persona. Dejarla en el iPad sería guardarla dos veces sin motivo (§22).
        await FileSystem.deleteAsync(photo.localUri, { idempotent: true });
      } else {
        await marcarFalloDeFoto(photo.localUri);
      }
    } catch {
      await marcarFalloDeFoto(photo.localUri);
    }
  }
}

/**
 * `markPhotoFailed` sin propagar.
 *
 * Esta función documenta que "no lanza nunca", y no era cierto: el
 * `markPhotoFailed` de recuperación está DENTRO del catch, así que si él también
 * fallaba —la base local es justo lo que puede estar mal— la excepción salía de
 * `uploadPendingPhotos`, de `runSync`, y acababa en un rechazo sin capturar.
 */
async function marcarFalloDeFoto(localUri: string): Promise<void> {
  try {
    await markPhotoFailed(localUri);
  } catch (error) {
    await anotarFallo('markPhotoFailed', error);
  }
}
