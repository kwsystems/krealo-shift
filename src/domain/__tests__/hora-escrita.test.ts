import { horaEscrita } from '../hora-escrita';

/** Una hora como la escribe una persona, igual en todos los campos (8-oct). */
describe('horaEscrita', () => {
  it.each([
    ['09:30', '09:30'],
    ['9:30', '09:30'],
    ['9', '09:00'],
    ['18', '18:00'],
    ['18.30', '18:30'],
    ['18,30', '18:30'],
    ['18h30', '18:30'],
    ['930', '09:30'],
    ['1830', '18:30'],
    ['0830', '08:30'],
    ['6pm', '18:00'],
    ['6:30 pm', '18:30'],
    ['6:30 p. m.', '18:30'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
    [' 20:01 ', '20:01'],
  ])('«%s» es %s', (texto, hora) => {
    expect(horaEscrita(texto)).toBe(hora);
  });

  it.each(['', 'abc', '24:00', '18:3', '18:60', '13pm', '0pm', '12345', '-1'])(
    '«%s» no es una hora',
    (texto) => {
      expect(horaEscrita(texto)).toBeNull();
    },
  );
});
