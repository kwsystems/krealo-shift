import { minutosDeRefrigerio } from '../refrigerio';

describe('los minutos de refrigerio, como se escriben', () => {
  it.each([
    ['60', 60],
    ['0', 0],
    ['45 min', 45],
    ['1:00', 60],
    ['0:30', 30],
    ['1h', 60],
    ['1 h', 60],
    ['1h30', 90],
    ['1,5 h', 90],
    ['1.5h', 90],
    // 8-oct: un número suelto del 1 al 4 son horas; nadie apunta un refrigerio de 1 minuto.
    ['1', 60],
    ['1,5', 90],
    ['1.5', 90],
    ['30', 30],
    ['5', 5],
  ])('«%s» son %i minutos', (texto, esperado) => {
    expect(minutosDeRefrigerio(texto)).toBe(esperado);
  });

  it.each(['', '  ', 'una hora', '1:75', 'abc', '-30'])('«%s» no se entiende', (texto) => {
    expect(minutosDeRefrigerio(texto)).toBeNull();
  });
});
