import { createHash } from 'node:crypto';

/**
 * El verificador de PIN sin conexion que el servidor le entrega a UN dispositivo.
 *
 * VIVE APARTE PARA PODER PROBARSE. Es la unica pieza del proyecto que tiene que dar
 * el mismo resultado en dos lenguajes y dos maquinas —aqui y en `deriveVerifier` de
 * `src/lib/offline/pin.ts`, dentro del iPad—, y si las dos puntas se separan un
 * milimetro no pasa nada visible hasta el dia que se cae la red en una tienda: ese
 * dia nadie puede fichar y no hay ningun error que mirar. Metido en `kiosk-api.ts`
 * no se podia probar sin arrancar firebase-admin.
 *
 * Es un digest con clave —`sha256(clave || ':' || hash)`— y no un HMAC formal: en el
 * iPad solo hay digest sobre cadenas UTF-8, y un HMAC de verdad (con su relleno de
 * bloques sobre bytes crudos) no se puede calcular igual en los dos sitios sin meter
 * otra dependencia de criptografia en la aplicacion. La debilidad conocida de un
 * digest con clave frente a HMAC es la extension de longitud, y aqui no aplica: el
 * mensaje es un hash bcrypt de formato fijo y la comparacion es de igualdad.
 *
 * NUNCA SALE EL HASH. Sale la sal —que el aparato necesita para recalcular bcrypt con
 * el PIN tecleado— y este digest. Quien se lleve el SQLite sin la clave del Keychain
 * no puede probar PIN contra nada.
 */
export function verificadorSinConexion(offlineKey: string, pinHash: string): string {
  return createHash('sha256').update(`${offlineKey}:${pinHash}`, 'utf8').digest('hex');
}

/**
 * La sal de un hash de bcrypt: sus 29 primeros caracteres, ni uno mas.
 *
 * `$2a$` (4) + coste (2) + `$` (1) + 22 de sal = 29. El esquema del reloj exige
 * exactamente esa longitud, asi que mandar el hash entero por descuido no pasaria
 * desapercibido: lo rechaza Zod al recibir.
 */
export function salDeBcrypt(pinHash: string): string {
  return pinHash.slice(0, 29);
}
