import { computeDuration } from '@/utils/time';

/**
 * El mismo par de instantes que fija la prueba SQL de `20_functions.sql`.
 *
 * Las dos mitades del par tienen que dar el MISMO numero: SQL redondeaba y esto
 * trunca, y para el mismo fichaje el kiosco decia 480 y la hoja de tiempo 481.
 */
describe('duracion: los segundos sueltos se truncan', () => {
  const entrada = '2026-08-20T14:00:00.000Z';

  it('ocho horas y 40 segundos son 480 minutos, no 481', () => {
    expect(
      computeDuration({ startsAt: entrada, endsAt: '2026-08-20T22:00:40.000Z' }).grossMinutes,
    ).toBe(480);
  });

  it('ocho horas y 59 segundos siguen siendo 480: no se regala un minuto', () => {
    expect(
      computeDuration({ startsAt: entrada, endsAt: '2026-08-20T22:00:59.000Z' }).grossMinutes,
    ).toBe(480);
  });

  it('ocho horas y un minuto SI son 481', () => {
    expect(
      computeDuration({ startsAt: entrada, endsAt: '2026-08-20T22:01:00.000Z' }).grossMinutes,
    ).toBe(481);
  });

  it('los descansos no pagados se restan del neto, y el bruto no cambia', () => {
    const d = computeDuration({
      startsAt: entrada,
      endsAt: '2026-08-20T22:00:40.000Z',
      unpaidBreakMinutes: 30,
    });
    expect(d.grossMinutes).toBe(480);
    expect(d.netMinutes).toBe(450);
  });
});
