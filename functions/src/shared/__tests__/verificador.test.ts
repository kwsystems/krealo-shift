import bcrypt from 'bcryptjs';

import { salDeBcrypt, verificadorSinConexion } from '../verificador';

/**
 * EL SERVIDOR Y EL IPAD TIENEN QUE CALCULAR LO MISMO, y nadie los obliga.
 *
 * `src/lib/offline/__tests__/pin-derivation.test.ts` ya fija esta construccion, pero
 * lo hace con una copia de la formula escrita dentro de la propia prueba: comprueba
 * que el VECTOR es correcto, no que el codigo que corre en produccion lo reproduzca.
 * Esta prueba cierra ese hueco por el lado del servidor, contra el MISMO vector.
 *
 * El vector no esta inventado: se genero ejecutando la migracion 20260827000700 sobre
 * PostgreSQL 16 con pgcrypto, y el PIN 135791 es el de Sofia Demo en `seed.sql`. O sea
 * que lo que se fija es lo que de verdad se emitio alguna vez, no lo que este codigo
 * produce hoy —si fuera esto ultimo, la prueba aprobaria cualquier cambio—.
 */
const SALT = '$2a$10$M/1krSXJtTheqzWAYBf0L.';
const DEVICE_KEY = '09c1487bf1dcbc475156fa66b93fd0fc0b75d14165785b3a5abd9e3c0dad78c3';
const SERVER_VERIFIER = '573cf1da396f732d107e51ab40e01bf74c04fbc4256867a8511537201bfdbee5';
const CORRECT_PIN = '135791';

describe('verificador de PIN sin conexion (lado servidor)', () => {
  it('reproduce el verificador que emitio Postgres para el mismo PIN y la misma clave', () => {
    const hash = bcrypt.hashSync(CORRECT_PIN, SALT);
    expect(verificadorSinConexion(DEVICE_KEY, hash)).toBe(SERVER_VERIFIER);
  });

  it('esta atado al dispositivo: con otra clave el mismo PIN no vale', () => {
    // Es el punto entero del mecanismo: copiar el SQLite de un iPad a otro no sirve.
    const hash = bcrypt.hashSync(CORRECT_PIN, SALT);
    expect(verificadorSinConexion('f'.repeat(64), hash)).not.toBe(SERVER_VERIFIER);
  });

  it('la sal son 29 caracteres y es la del hash', () => {
    // Si esto crece, el reloj rechaza el paquete entero: su esquema exige `.length(29)`,
    // y un roster rechazado deja al aparato sin poder fichar sin conexion.
    const hash = bcrypt.hashSync(CORRECT_PIN, SALT);
    expect(salDeBcrypt(hash)).toHaveLength(29);
    expect(salDeBcrypt(hash)).toBe(SALT);
  });

  it('el verificador es un sha256 en hexadecimal minusculo', () => {
    // La otra longitud que exige el esquema del reloj: `.length(64)`.
    expect(verificadorSinConexion(DEVICE_KEY, bcrypt.hashSync(CORRECT_PIN, SALT))).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
