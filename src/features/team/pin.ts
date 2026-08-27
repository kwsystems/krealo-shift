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
  const descending = digits.every((digit, index) => index === 0 || digit === digits[index - 1]! - 1);
  return ascending || descending;
}

/** Convierte bytes aleatorios en dígitos. Un byte por dígito. */
export function pinFromBytes(bytes: Uint8Array, length: number): string {
  let pin = '';
  for (let index = 0; index < length; index += 1) {
    pin += String((bytes[index] ?? 0) % 10);
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

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pin = pinFromBytes(randomBytes(safeLength), safeLength);
    if (!isTrivialPin(pin)) return pin;
  }

  const fallback = pinFromBytes(randomBytes(safeLength), safeLength);
  const lastDigit = Number(fallback.slice(-1));
  return `${fallback.slice(0, -1)}${(lastDigit + 3) % 10}`;
}
