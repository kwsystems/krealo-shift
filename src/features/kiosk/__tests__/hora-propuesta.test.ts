import { horaPropuestaComoInstante } from '../hora-propuesta';

/**
 * La hora que se teclea en «Olvidé marcar», como instante de la tienda. Antes se mandaba
 * «14:30» tal cual y la Bandeja no podía leerlo.
 */

const LIMA = 'America/Lima';
// Martes 22-sep a las 09:00 de Lima.
const ahora = new Date('2026-09-22T14:00:00.000Z');

describe('hora propuesta en el reloj', () => {
  it('lo que ya pasó hoy es de hoy', () => {
    expect(horaPropuestaComoInstante('08:30', LIMA, ahora)).toBe('2026-09-22T13:30:00.000Z');
  });

  it('lo que hoy todavía no llegó es de ayer: la salida olvidada de anoche', () => {
    expect(horaPropuestaComoInstante('19:00', LIMA, ahora)).toBe('2026-09-22T00:00:00.000Z');
  });

  it('entiende «8.30» y «0830», y dice que no a lo que no es hora', () => {
    expect(horaPropuestaComoInstante('8.30', LIMA, ahora)).toBe('2026-09-22T13:30:00.000Z');
    expect(horaPropuestaComoInstante('0830', LIMA, ahora)).toBe('2026-09-22T13:30:00.000Z');
    expect(horaPropuestaComoInstante('25:00', LIMA, ahora)).toBeNull();
    expect(horaPropuestaComoInstante('tarde', LIMA, ahora)).toBeNull();
  });
});
