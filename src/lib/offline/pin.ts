import bcrypt from 'bcryptjs';
import * as Crypto from 'expo-crypto';

import { SECURE_KEYS, secureStorage } from '@/lib/security/secure-storage';
import { openOfflineDatabase } from './database';

/**
 * Validación del PIN sin conexión (especificación §8, §9.7).
 *
 * CÓMO FUNCIONA
 * El servidor NO manda el hash del PIN. Manda dos cosas por empleado de esta
 * tienda: el `salt` de bcrypt y un `verificador` que derivó con una clave propia
 * de este dispositivo. La clave se entregó una sola vez al activar el kiosco y
 * vive en el Keychain de iOS, no en la base local.
 *
 * Para comprobar un PIN, el dispositivo:
 *   1. calcula `bcrypt(PIN_tecleado, salt)`;
 *   2. calcula `sha256(clave || ':' || ese_hash)`;
 *   3. compara el resultado con el verificador guardado.
 *
 * POR QUÉ ASÍ Y NO CON EL HASH DIRECTO
 * Antes se guardaba el hash bcrypt en el SQLite del iPad. Un archivo SQLite se
 * exfiltra mucho más fácil que el Keychain —un backup sin cifrar, un bug de
 * compartición de archivos— y con el hash en mano se prueban los 10⁶ PIN posibles
 * sin límite y sin tocar el dispositivo. Ahora el archivo por sí solo no sirve
 * para nada: falta la clave, que está protegida por hardware.
 *
 * Es también lo que pide literalmente §8: un verificador derivado y ligado al
 * dispositivo, emitido por servidor, con la clave en SecureStore.
 *
 * LO QUE SIGUE COSTANDO, DICHO SIN ADORNOS
 * Quien extraiga TAMBIÉN la clave del Keychain —lo que exige acceso físico y
 * jailbreak, no solo un backup— vuelve al escenario anterior: fuerza bruta de
 * 10⁶ PIN contra bcrypt coste 10, o sea horas por empleado. Revocar el
 * dispositivo lo corta de inmediato: un kiosco revocado deja de recibir
 * verificadores, y al salir del modo kiosco se borra la base local.
 *
 * OFFLINE NO RELAJA NADA MÁS: se aplica el mismo límite de intentos y el mismo
 * bloqueo que online, contados en el propio dispositivo. Si el bloqueo solo
 * existiera en el servidor, quedarse sin red sería la forma de saltárselo.
 */

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/** Contador de intentos en memoria: se reinicia si alguien reinicia el iPad, que
 * es aceptable porque reiniciar un iPad de pedestal es visible y lento. */
let failedAttempts = 0;
let lockedUntil: Date | null = null;

export type OfflineVerification =
  | { ok: true; employeeOpaqueId: string; pinVersion: number }
  | { ok: false; reason: 'incorrect'; remainingAttempts: number }
  | { ok: false; reason: 'locked'; lockedUntil: string }
  | { ok: false; reason: 'no_verifiers' }
  | { ok: false; reason: 'no_device_key' };

type VerifierRow = {
  employee_opaque_id: string;
  pin_salt: string;
  pin_verifier: string;
  pin_version: number;
};

/** Guarda los verificadores que envió el servidor, reemplazando los anteriores. */
export async function storeOfflineVerifiers(
  verifiers: readonly {
    employeeOpaqueId: string;
    pinSalt: string;
    pinVerifier: string;
    pinLength: number;
    pinVersion: number;
  }[],
): Promise<void> {
  const database = await openOfflineDatabase();
  const now = new Date().toISOString();

  await database.withTransactionAsync(async () => {
    // Se reemplaza el conjunto completo: un empleado que salió de la tienda debe
    // dejar de poder fichar en este iPad, y eso solo se logra borrando su fila.
    await database.runAsync('delete from cached_pin_verifiers');
    for (const verifier of verifiers) {
      await database.runAsync(
        `insert into cached_pin_verifiers
           (employee_opaque_id, pin_salt, pin_verifier, pin_length, pin_version, updated_at)
         values (?, ?, ?, ?, ?, ?)`,
        verifier.employeeOpaqueId,
        verifier.pinSalt,
        verifier.pinVerifier,
        verifier.pinLength,
        verifier.pinVersion,
        now,
      );
    }
  });
}

export async function hasOfflineVerifiers(): Promise<boolean> {
  const database = await openOfflineDatabase();
  const row = await database.getFirstAsync<{ total: number }>(
    'select count(*) as total from cached_pin_verifiers',
  );
  return (row?.total ?? 0) > 0;
}

/**
 * Deriva el verificador tal como lo hace el servidor.
 *
 * Es un digest con clave —`sha256(clave || ':' || hash)`— y no un HMAC formal.
 * El motivo es concreto: `expo-crypto` solo expone digest sobre cadenas UTF-8,
 * así que un HMAC real (con su relleno de bloques sobre bytes crudos) no se puede
 * calcular igual en Postgres y en Hermes sin agregar otra dependencia de
 * criptografía a la app. La debilidad conocida de un digest con clave frente a
 * HMAC es la extensión de longitud, y aquí no aplica: el mensaje es un hash
 * bcrypt de formato fijo y la comparación es de igualdad, no hay ningún escenario
 * en que un atacante gane algo extendiendo el mensaje.
 *
 * La cadena tiene que coincidir byte a byte con la de la migración
 * 20260827000700_offline_verifier_device_key.sql. Hay una prueba de SQL que fija
 * esa construcción justamente para que un cambio en un lado rompa el otro de
 * forma visible.
 */
async function deriveVerifier(deviceKey: string, bcryptHash: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${deviceKey}:${bcryptHash}`,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
}

/**
 * Comparación en tiempo constante sobre dos cadenas hexadecimales.
 *
 * Con `===` el motor corta en el primer carácter distinto, y ese tiempo distinto
 * es información. Aquí el atacante ya tendría el archivo local, así que el
 * beneficio es modesto, pero cuesta cuatro líneas y quita una clase entera de
 * ataque de la mesa.
 */
function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verifica un PIN contra los verificadores locales.
 *
 * Recorre todos los empleados de la tienda porque el PIN identifica y autentica a
 * la vez: no se sabe de quién es hasta que uno coincide. Es lo mismo que hace la
 * función del servidor.
 */
export async function verifyPinOffline(pin: string): Promise<OfflineVerification> {
  if (lockedUntil !== null && lockedUntil > new Date()) {
    return { ok: false, reason: 'locked', lockedUntil: lockedUntil.toISOString() };
  }

  const deviceKey = await secureStorage.get(SECURE_KEYS.kioskDeviceKey);
  if (deviceKey === null || deviceKey.length === 0) {
    // Sin la clave no se puede comprobar nada, y adivinar no es una opción. El
    // dispositivo tiene que validar contra el servidor; la pantalla lo dice y
    // ofrece reactivar el kiosco.
    return { ok: false, reason: 'no_device_key' };
  }

  const database = await openOfflineDatabase();
  const rows = await database.getAllAsync<VerifierRow>(
    'select employee_opaque_id, pin_salt, pin_verifier, pin_version from cached_pin_verifiers',
  );

  if (rows.length === 0) {
    return { ok: false, reason: 'no_verifiers' };
  }

  let match: VerifierRow | null = null;

  for (const row of rows) {
    // `hashSync` en lugar de la versión con callback: bcryptjs resuelve el
    // callback en un `setImmediate` que en Hermes no siempre está disponible, y
    // aquí ya estamos en una función async.
    //
    // Este es el paso caro a propósito —bcrypt coste 10— y es lo que hace que
    // probar 10⁶ PIN cueste horas y no segundos.
    const candidate = bcrypt.hashSync(pin, row.pin_salt);
    const verifier = await deriveVerifier(deviceKey, candidate);

    if (equalsConstantTime(verifier, row.pin_verifier) && match === null) {
      // Se guarda la PRIMERA coincidencia y NO se corta el bucle: si se cortara,
      // el tiempo de respuesta delataría en qué posición de la lista está el
      // empleado que acertó. Con una tienda de decenas de personas el costo de
      // seguir es de milisegundos por fila.
      //
      // El `match === null` no es decorativo: sin él la última coincidencia
      // sobrescribiría a la primera, y con dos PIN iguales en la misma tienda se
      // ficharía a la persona equivocada.
      match = row;
    }
  }

  if (match !== null) {
    failedAttempts = 0;
    lockedUntil = null;
    return {
      ok: true,
      employeeOpaqueId: match.employee_opaque_id,
      pinVersion: match.pin_version,
    };
  }

  failedAttempts += 1;

  if (failedAttempts >= MAX_ATTEMPTS) {
    lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
    failedAttempts = 0;
    return { ok: false, reason: 'locked', lockedUntil: lockedUntil.toISOString() };
  }

  return { ok: false, reason: 'incorrect', remainingAttempts: MAX_ATTEMPTS - failedAttempts };
}

/** Datos mínimos del empleado para pintar la pantalla sin red. */
export async function cachedEmployee(employeeOpaqueId: string): Promise<{
  displayName: string;
  jobRoleName: string | null;
} | null> {
  const database = await openOfflineDatabase();
  const row = await database.getFirstAsync<{
    display_name: string;
    job_role_name: string | null;
  }>(
    'select display_name, job_role_name from cached_roster where employee_opaque_id = ?',
    employeeOpaqueId,
  );
  if (row === null) return null;
  return { displayName: row.display_name, jobRoleName: row.job_role_name };
}

/** Solo para pruebas: reinicia el estado de intentos entre casos. */
export function resetOfflineAttemptState(): void {
  failedAttempts = 0;
  lockedUntil = null;
}
