import { minutosEscritos } from '../duracion-escrita';

/**
 * Un solo lector para el refrigerio del turno y la hora extra (8-oct): «1» es una hora en los
 * dos. Antes era un minuto en los dos, y el caso «sin refrigerio» no se iba hiciera lo que
 * hiciera quien gestiona.
 */
describe('una duración escrita', () => {
  it.each([
    ['1', 60],
    ['4', 240],
    ['5', 5],
    ['30', 30],
    ['90', 90],
    ['1 min', 1],
    ['1:00', 60],
    ['1:30', 90],
    ['1 h', 60],
    ['1h30', 90],
    ['1,5', 90],
    ['1.5 h', 90],
    ['0', 0],
  ])('«%s» son %i minutos', (texto, minutos) => {
    expect(minutosEscritos(texto)).toBe(minutos);
  });

  it.each(['', 'una hora', '1:75', '-1', 'abc'])('«%s» no se entiende', (texto) => {
    expect(minutosEscritos(texto)).toBeNull();
  });
});
