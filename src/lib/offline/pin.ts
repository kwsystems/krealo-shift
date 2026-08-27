import bcrypt from 'bcryptjs';

import { openOfflineDatabase } from './database';

/**
 * Validación del PIN sin conexión (especificación §8, §9.7).
 *
 * El dispositivo guarda, por empleado de SU tienda, un hash bcrypt con su salt, y
 * compara localmente el PIN que la persona teclea. No descifra nada: no hay PIN
 * recuperable en el dispositivo.
 *
 * La decisión de seguridad y su costo están explicados en
 * `supabase/migrations/20260827000600_offline_pin.sql`. Resumen: quien extraiga el
 * blob de SecureStore, lo que exige acceso físico y jailbreak, puede probar sin
 * límite los 10⁶ PIN posibles contra ese hash. Con bcrypt coste 10 son horas por
 * empleado, no minutos, y revocar el dispositivo lo corta de inmediato.
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
  | { ok: false; reason: 'no_verifiers' };

type VerifierRow = {
  employee_opaque_id: string;
  pin_offline_hash: string;
  pin_version: number;
};

/** Guarda los verificadores que envió el servidor, reemplazando los anteriores. */
export async function storeOfflineVerifiers(
  verifiers: readonly {
    employeeOpaqueId: string;
    pinOfflineHash: string;
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
           (employee_opaque_id, pin_offline_hash, pin_length, pin_version, updated_at)
         values (?, ?, ?, ?, ?)`,
        verifier.employeeOpaqueId,
        verifier.pinOfflineHash,
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

  const database = await openOfflineDatabase();
  const rows = await database.getAllAsync<VerifierRow>(
    'select employee_opaque_id, pin_offline_hash, pin_version from cached_pin_verifiers',
  );

  if (rows.length === 0) {
    return { ok: false, reason: 'no_verifiers' };
  }

  for (const row of rows) {
    // `compareSync` en lugar de la versión con callback: bcryptjs resuelve el
    // callback en un `setImmediate` que en Hermes no siempre está disponible, y
    // aquí ya estamos en una función async.
    if (bcrypt.compareSync(pin, row.pin_offline_hash)) {
      failedAttempts = 0;
      lockedUntil = null;
      return {
        ok: true,
        employeeOpaqueId: row.employee_opaque_id,
        pinVersion: row.pin_version,
      };
    }
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
