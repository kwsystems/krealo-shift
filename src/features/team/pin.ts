/**
 * Generación del PIN temporal del empleado (§11.2, §8).
 *
 * Reglas:
 *   - se genera con aleatoriedad criptográfica, no con `Math.random`;
 *   - se descartan los PIN triviales (todos iguales, secuencias ascendentes o
 *     descendentes) porque son los primeros que probaría cualquiera;
 *   - el gerente lo ve UNA sola vez: esta función devuelve el PIN en claro para
 *     mostrarlo, y en la base solo queda su hash (lo hace `set_employee_pin`).
 */

export type RandomBytes = (length: number) => Uint8Array;

export function isTrivialPin(pin: string): boolean {
  if (pin.length < 2) return true;

  const digits = [...pin].map(Number);
  const first = digits[0];
  if (first === undefined) return true;

  const allEqual = digits.every((digit) => digit === first);
  if (allEqual) return true;

  const ascending = digits.every((digit, index) => index === 0 || digit === digits[index - 1]! + 1);
  const descending = digits.every(
    (digit, index) => index === 0 || digit === digits[index - 1]! - 1,
  );
  return ascending || descending;
}

/**
 * El byte más alto que se puede usar sin sesgo: 249.
 *
 * 256 no es múltiplo de 10, así que `byte % 10` NO reparte parejo: los dígitos 0 a 5
 * salen 26 veces de 256 y los dígitos 6 a 9 salen 25. Son 10,16% contra 9,77%.
 *
 * La magnitud real es poca —con bcrypt coste 12 y bloqueo a los cinco intentos, ese
 * sesgo no hace explotable un PIN de seis dígitos— pero se descartan los bytes de 250
 * a 255 porque cuesta tres líneas y porque un generador de credenciales con sesgo es
 * lo primero que marca cualquier revisión.
 */
const MAX_BYTE_SIN_SESGO = 249;

/**
 * Convierte bytes aleatorios en dígitos, descartando los que producirían sesgo.
 *
 * LANZA si no hay suficientes bytes utilizables, y eso es deliberado. Antes hacía
 * `bytes[index] ?? 0`: si la fuente de azar devolvía menos bytes de los pedidos, los
 * dígitos que faltaban se rellenaban con CEROS, en silencio. Un PIN "480000" pasa el
 * filtro de PIN triviales sin problema.
 *
 * No hay hoy un caso donde `Crypto.getRandomBytes` devuelva menos, pero un respaldo
 * silencioso en un generador de credenciales es exactamente lo que convierte un fallo
 * ruidoso en una credencial mala.
 */
export function pinFromBytes(bytes: Uint8Array, length: number): string {
  let pin = '';

  for (const byte of bytes) {
    if (pin.length === length) break;
    if (byte > MAX_BYTE_SIN_SESGO) continue;
    pin += String(byte % 10);
  }

  if (pin.length < length) {
    throw new Error(
      `No hay suficiente azar para un PIN de ${length} dígitos: ` +
        `llegaron ${bytes.length} bytes y ${bytes.length - pin.length} se descartaron.`,
    );
  }

  return pin;
}

/**
 * Devuelve un PIN de `length` dígitos. Reintenta un número acotado de veces si
 * sale trivial; si el azar insiste, altera el último dígito en lugar de girar
 * para siempre.
 */
export function generatePin(length: number, randomBytes: RandomBytes): string {
  const safeLength = Math.min(6, Math.max(4, Math.trunc(length)));

  // SE PIDEN MÁS BYTES DE LOS NECESARIOS porque `pinFromBytes` descarta los que
  // producirían sesgo. La probabilidad de que 6 de 6 bytes caigan en el 2,3% que se
  // descarta es despreciable; pidiendo el doble, es inexistente. Y si aun así no
  // alcanzaran, `pinFromBytes` lanza en vez de inventar dígitos.
  const bytesPedidos = safeLength * 2;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pin = pinFromBytes(randomBytes(bytesPedidos), safeLength);
    if (!isTrivialPin(pin)) return pin;
  }

  const fallback = pinFromBytes(randomBytes(bytesPedidos), safeLength);
  const lastDigit = Number(fallback.slice(-1));
  return `${fallback.slice(0, -1)}${(lastDigit + 3) % 10}`;
}
