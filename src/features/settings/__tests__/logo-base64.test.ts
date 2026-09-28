import { aBase64 } from '../logo';

/**
 * EL CODIFICADOR BASE64 ESCRITO A MANO, PROBADO CONTRA LA REFERENCIA.
 *
 * POR QUÉ ES PROPIO Y NO `btoa`: `btoa` no existe en React Native, y en web revienta
 * si se le pasa un array grande vía `String.fromCharCode(...bytes)` porque desborda la
 * pila de argumentos. Suponer que el entorno trae una función es exactamente la clase
 * de suposición que dejó la subida del logo rota un mes.
 *
 * Y POR QUÉ SE PRUEBA: un codificador propio que se equivoque en el relleno produce
 * una imagen corrupta que el servidor acepta sin queja. No da error: da un logo roto.
 * El relleno es justo donde se falla, así que se prueban los tres restos de longitud.
 */
const codificar = (bytes: number[]): string => aBase64(new Uint8Array(bytes).buffer);
const referencia = (bytes: number[]): string => Buffer.from(bytes).toString('base64');

describe('aBase64', () => {
  it('longitud múltiplo de 3: sin relleno', () => {
    expect(codificar([77, 97, 110])).toBe('TWFu');
    expect(codificar([77, 97, 110])).toBe(referencia([77, 97, 110]));
  });

  it('resto 2: un signo igual', () => {
    expect(codificar([77, 97])).toBe('TWE=');
    expect(codificar([77, 97])).toBe(referencia([77, 97]));
  });

  it('resto 1: dos signos igual', () => {
    expect(codificar([77])).toBe('TQ==');
    expect(codificar([77])).toBe(referencia([77]));
  });

  it('vacío', () => {
    expect(codificar([])).toBe('');
  });

  it('los 256 valores de un byte, contra la referencia', () => {
    const todos = Array.from({ length: 256 }, (_, i) => i);
    expect(codificar(todos)).toBe(referencia(todos));
  });

  it('una imagen del tamaño real (1 MB) sale igual que la referencia', () => {
    /* El caso que `btoa` no aguanta: un millón de bytes de una vez. */
    const grande = Array.from({ length: 1_000_003 }, (_, i) => (i * 31) % 256);
    expect(codificar(grande)).toBe(referencia(grande));
  });

  it('la cabecera de un PNG se codifica byte a byte igual', () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(codificar(png)).toBe(referencia(png));
  });
});
