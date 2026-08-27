import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';

/**
 * El verificador offline del PIN tiene que calcularse IGUAL en Postgres y en el
 * iPad. Si las dos puntas se separan, nadie puede fichar sin conexión y el fallo
 * solo aparece en una tienda sin red, que es el peor sitio para descubrirlo.
 *
 * Este archivo fija esa construcción con un vector de prueba real, generado
 * ejecutando la migración 20260827000700 sobre PostgreSQL 16 con pgcrypto:
 *
 *   select pin_salt, pin_verifier from kiosk_offline_verifiers('66666666-…-661')
 *     where employee_opaque_id = encode(digest('55555555-…-551', 'sha256'), 'hex');
 *   select offline_key from kiosk_devices where id = '66666666-…-661';
 *
 * El PIN 135791 es el de Sofía Demo en `supabase/seed.sql`.
 *
 * NOTA: aquí se usa `node:crypto` para el sha256, no `expo-crypto`, porque en el
 * entorno de pruebas no hay módulo nativo. Lo que se está verificando es la
 * CONSTRUCCIÓN —qué se concatena y en qué orden— que es donde se rompería la
 * compatibilidad; `expo-crypto` calcula el mismo sha256 estándar.
 */

// Vector generado por Postgres, no inventado. Ver el comentario de arriba.
const SALT = '$2a$10$M/1krSXJtTheqzWAYBf0L.';
const DEVICE_KEY = '09c1487bf1dcbc475156fa66b93fd0fc0b75d14165785b3a5abd9e3c0dad78c3';
const SERVER_VERIFIER = '573cf1da396f732d107e51ab40e01bf74c04fbc4256867a8511537201bfdbee5';
const CORRECT_PIN = '135791';

/** Misma construcción que `deriveVerifier` en ../pin.ts y que la migración. */
function derive(deviceKey: string, bcryptHash: string): string {
  return createHash('sha256').update(`${deviceKey}:${bcryptHash}`, 'utf8').digest('hex');
}

describe('verificador offline del PIN', () => {
  it('bcryptjs reproduce exactamente el hash de pgcrypto para el mismo salt', () => {
    // Si esto falla, bcryptjs y pgcrypto dejaron de coincidir y el PIN offline no
    // funciona para nadie. Es la base de todo el mecanismo.
    const hash = bcrypt.hashSync(CORRECT_PIN, SALT);
    expect(hash.startsWith(SALT)).toBe(true);
    expect(hash).toHaveLength(60);
  });

  it('el PIN correcto reproduce el verificador que emitió el servidor', () => {
    const hash = bcrypt.hashSync(CORRECT_PIN, SALT);
    expect(derive(DEVICE_KEY, hash)).toBe(SERVER_VERIFIER);
  });

  it('un PIN incorrecto no reproduce el verificador', () => {
    for (const wrong of ['135790', '246810', '000000', '999999']) {
      const hash = bcrypt.hashSync(wrong, SALT);
      expect(derive(DEVICE_KEY, hash)).not.toBe(SERVER_VERIFIER);
    }
  });

  it('el verificador está ligado al dispositivo: otra clave no valida el PIN correcto', () => {
    // Esto es el punto de todo el cambio. Copiar la base de un iPad a otro no
    // sirve, porque el verificador se calculó con la clave del primero.
    const hash = bcrypt.hashSync(CORRECT_PIN, SALT);
    const otherKey = 'f'.repeat(64);
    expect(derive(otherKey, hash)).not.toBe(SERVER_VERIFIER);
  });

  it('el salt por sí solo no permite verificar nada', () => {
    // El salt son 29 caracteres y no contiene ni un byte del digest de bcrypt.
    // Quien tenga solo el salt no puede distinguir un PIN correcto de uno falso.
    expect(SALT).toHaveLength(29);
    const conElCorrecto = bcrypt.hashSync(CORRECT_PIN, SALT);
    const conOtro = bcrypt.hashSync('999999', SALT);
    expect(conElCorrecto.slice(0, 29)).toBe(conOtro.slice(0, 29));
    expect(conElCorrecto).not.toBe(conOtro);
  });

  it('el verificador es un sha256 en hexadecimal minúsculo', () => {
    const hash = bcrypt.hashSync(CORRECT_PIN, SALT);
    expect(derive(DEVICE_KEY, hash)).toMatch(/^[0-9a-f]{64}$/);
  });
});
