import { generatePin, isTrivialPin, pinFromBytes } from '../pin';

/**
 * El PIN es la única credencial del empleado en el iPad: si sale trivial, se
 * adivina en tres intentos; si sale de un `Math.random`, se puede predecir.
 */

describe('detección de PIN trivial', () => {
  it('rechaza dígitos repetidos y secuencias', () => {
    expect(isTrivialPin('0000')).toBe(true);
    expect(isTrivialPin('1111')).toBe(true);
    expect(isTrivialPin('123456')).toBe(true);
    expect(isTrivialPin('654321')).toBe(true);
  });

  it('acepta un PIN sin patrón', () => {
    expect(isTrivialPin('195374')).toBe(false);
    expect(isTrivialPin('4062')).toBe(false);
  });
});

describe('generación de PIN', () => {
  it('convierte bytes en dígitos, uno por byte', () => {
    expect(pinFromBytes(new Uint8Array([10, 21, 32, 43]), 4)).toBe('0123');
  });

  it('respeta la longitud configurada y la acota entre 4 y 6', () => {
    const random = (length: number) => new Uint8Array(length).map((_, index) => index * 7 + 3);
    expect(generatePin(4, random)).toHaveLength(4);
    expect(generatePin(6, random)).toHaveLength(6);
    expect(generatePin(9, random)).toHaveLength(6);
    expect(generatePin(1, random)).toHaveLength(4);
  });

  it('reintenta cuando el azar entrega un PIN trivial', () => {
    let call = 0;
    const random = (length: number) => {
      call += 1;
      // Primera vez: 1111 (trivial). Segunda: 4062.
      const digits = call === 1 ? [1, 1, 1, 1] : [4, 0, 6, 2];
      return new Uint8Array(digits.slice(0, length));
    };

    expect(generatePin(4, random)).toBe('4062');
    expect(call).toBe(2);
  });

  it('devuelve algo no trivial incluso si el azar insiste', () => {
    const random = (length: number) => new Uint8Array(length).fill(7);
    const pin = generatePin(4, random);

    expect(pin).toHaveLength(4);
    expect(isTrivialPin(pin)).toBe(false);
  });

  it('solo produce dígitos', () => {
    const random = (length: number) =>
      new Uint8Array(length).map((_, index) => (index * 37 + 11) % 256);
    expect(generatePin(6, random)).toMatch(/^[0-9]{6}$/);
  });
});
