import { diasHastaElPago, periodoDePago } from '../periodo-de-pago';

describe('el periodo de pago: del 1 al último día, y se paga ese día', () => {
  it('octubre va del 1 al 31 y se paga el 31', () => {
    expect(periodoDePago('2026-10-13')).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-31',
      diaDePago: '2026-10-31',
    });
  });

  it('un mes de 30 días se paga el 30, y febrero su último día', () => {
    expect(periodoDePago('2026-09-05').diaDePago).toBe('2026-09-30');
    expect(periodoDePago('2027-02-10').diaDePago).toBe('2027-02-28');
    expect(periodoDePago('2028-02-10').diaDePago).toBe('2028-02-29');
  });

  it('el mes pasado, también al cambiar de año', () => {
    expect(periodoDePago('2026-10-13', 1)).toEqual({
      desde: '2026-09-01',
      hasta: '2026-09-30',
      diaDePago: '2026-09-30',
    });
    expect(periodoDePago('2027-01-02', 1).desde).toBe('2026-12-01');
  });

  it('cuántos días faltan para el pago', () => {
    expect(diasHastaElPago('2026-10-13', periodoDePago('2026-10-13'))).toBe(18);
    expect(diasHastaElPago('2026-10-31', periodoDePago('2026-10-31'))).toBe(0);
    expect(diasHastaElPago('2026-10-13', periodoDePago('2026-10-13', 1))).toBe(-13);
  });
});
