import { montoEscrito } from '../monto-escrito';

describe('el sueldo como se escribe', () => {
  it('lee los montos como se escriben en Perú', () => {
    expect(montoEscrito('1500')).toBe(1500);
    expect(montoEscrito('1,500')).toBe(1500);
    expect(montoEscrito('1 500.50')).toBe(1500.5);
    expect(montoEscrito('S/ 1500')).toBe(1500);
    expect(montoEscrito('s/1,800.00')).toBe(1800);
    expect(montoEscrito('1500,50')).toBe(1500.5);
    expect(montoEscrito('12,345,678')).toBe(12345678);
  });

  it('lo que no es un monto en soles no se lee', () => {
    for (const texto of ['', 'mil', '0', '-1500', '1500.555', '1.500.00', '15OO']) {
      expect(montoEscrito(texto)).toBeNull();
    }
  });
});
