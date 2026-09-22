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

/**
 * Muestreo por rechazo y ausencia de respaldos silenciosos.
 *
 * Dos detalles del generador, ninguno grave y los dos baratos:
 *
 *   - `byte % 10` sobre 0..255 NO reparte parejo: 256 no es múltiplo de 10, así que
 *     los dígitos 0 a 5 salían 26 veces de 256 y los 6 a 9 salían 25 (10,16% contra
 *     9,77%). Con bcrypt coste 12 y bloqueo a los cinco intentos eso no hace
 *     explotable un PIN de seis dígitos, pero es lo primero que marca una revisión.
 *
 *   - `bytes[index] ?? 0` rellenaba con CEROS los dígitos que faltaban si la fuente
 *     de azar devolvía menos bytes de los pedidos. En silencio. "480000" pasa el
 *     filtro de PIN triviales sin problema, y un respaldo silencioso en un generador
 *     de credenciales es lo que convierte un fallo ruidoso en una credencial mala.
 */
describe('azar del PIN', () => {
  it('descarta los bytes que producirían sesgo, en vez de usarlos', () => {
    // 250..255 se descartan; 7 y 12 se usan.
    expect(pinFromBytes(new Uint8Array([250, 7, 255, 12, 251, 3, 254, 9]), 4)).toBe('7239');
  });

  it('LANZA si no hay suficiente azar, en vez de rellenar con ceros', () => {
    expect(() => pinFromBytes(new Uint8Array([4, 8]), 4)).toThrow(/azar/i);
  });

  it('lanza también si todos los bytes se descartan', () => {
    expect(() => pinFromBytes(new Uint8Array([250, 251, 252, 253]), 4)).toThrow(/azar/i);
  });

  it('el mensaje del error dice cuántos bytes llegaron y cuántos se descartaron', () => {
    // Sin eso, "no hay suficiente azar" no le dice a nadie qué mirar.
    expect(() => pinFromBytes(new Uint8Array([250, 251]), 4)).toThrow(/llegaron 2 bytes/);
  });

  it('reparte los diez dígitos de forma plana sobre muchas muestras', () => {
    // La prueba real del sesgo: se recorren TODOS los bytes posibles y se cuenta cada
    // dígito. Con el sesgo, 0..5 salían 26 veces y 6..9 salían 25. Sin él, diez.
    const todos = new Uint8Array(256).map((_, index) => index);
    const cuenta = new Map<string, number>();
    for (const byte of todos) {
      if (byte > 249) continue;
      const digito = String(byte % 10);
      cuenta.set(digito, (cuenta.get(digito) ?? 0) + 1);
    }

    expect([...cuenta.keys()].sort()).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect([...new Set(cuenta.values())]).toEqual([25]);
  });

  it('generatePin pide más bytes de los que necesita', () => {
    // Porque `pinFromBytes` descarta: pedir exactamente 6 haría que un byte
    // descartado dejara el PIN corto y lanzara sin motivo.
    const pedidos: number[] = [];
    const random = (length: number) => {
      pedidos.push(length);
      return new Uint8Array(length).map((_, index) => (index * 7 + 3) % 250);
    };

    generatePin(6, random);
    expect(pedidos[0]).toBeGreaterThan(6);
  });
});
