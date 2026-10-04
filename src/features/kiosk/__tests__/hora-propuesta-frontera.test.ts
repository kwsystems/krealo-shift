import { deLaJornada } from '../../../../functions/src/shared/hora-de-la-jornada';
import { horaPropuestaComoInstante } from '../hora-propuesta';

/**
 * «OLVIDÉ MARCAR» CON LA JORNADA ABIERTA DE OTRO DÍA (auditoría, 4-oct): el reloj y el
 * servidor leen la hora con la misma regla —la primera vez que es esa hora después de la
 * entrada—, y aquí se comprueba que dan lo mismo. Con dos reglas, el reloj enseñaría una
 * fecha y la Bandeja recibiría otra.
 */

const LIMA = 'America/Lima';
// Entró el sábado 3-oct a las 10:00 de Lima y no marcó la salida.
const ENTRADA = '2026-10-03T15:00:00.000Z';
// Se acuerda el lunes 5-oct a las 09:00 de Lima.
const LUNES = new Date('2026-10-05T14:00:00.000Z');

describe('la hora de «Olvidé marcar» es de la jornada abierta', () => {
  it.each([
    ['19:00', '2026-10-04T00:00:00.000Z'], // sábado 19:00, no domingo
    ['22:30', '2026-10-04T03:30:00.000Z'], // sábado 22:30
    ['09:00', '2026-10-04T14:00:00.000Z'], // antes de la entrada: el domingo 09:00
  ])('«%s» es %s, en el reloj y en el servidor', (hora, esperado) => {
    expect(horaPropuestaComoInstante(hora, LIMA, LUNES, ENTRADA)).toBe(esperado);
    expect(deLaJornada(hora, ENTRADA, LIMA)).toBe(esperado);
  });

  it('una hora que todavía no llegó no se propone', () => {
    // Entró hoy a las 08:00 y son las 09:00: «19:00» es esta noche.
    const hoy = '2026-10-05T13:00:00.000Z';
    expect(horaPropuestaComoInstante('19:00', LIMA, LUNES, hoy)).toBeNull();
  });

  it('sin jornada abierta, lo de siempre: hoy o ayer', () => {
    expect(horaPropuestaComoInstante('19:00', LIMA, LUNES)).toBe('2026-10-05T00:00:00.000Z');
  });
});
