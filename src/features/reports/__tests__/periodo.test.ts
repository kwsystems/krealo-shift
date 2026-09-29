import { periodoDe, semanasDelMes } from '../periodo';

/**
 * El periodo de Reportes. El mes es el civil —del 1 al último día— en la zona de la sede.
 */

const LIMA = 'America/Lima';
// 29-sep-2026 a las 23:30 en Lima: ya es 30 en UTC. El mes tiene que ser septiembre.
const NOCHE = '2026-09-30T04:30:00.000Z';

describe('periodo de Reportes', () => {
  it('el mes actual va del 1 al último día, en la zona de la sede', () => {
    const p = periodoDe({ tipo: 'mes', offset: 0, nowISO: NOCHE, weekStartsOn: 1, timezone: LIMA });
    expect(p.from).toBe('2026-09-01');
    expect(p.to).toBe('2026-09-30');
    expect(p.dias).toHaveLength(30);
    expect(p.fromISO).toBe('2026-09-01T05:00:00.000Z');
    expect(p.toISO).toBe('2026-10-01T05:00:00.000Z');
  });

  it('cruza de año hacia atrás y sabe cuántos días tiene febrero', () => {
    const enero = periodoDe({
      tipo: 'mes',
      offset: -8,
      nowISO: NOCHE,
      weekStartsOn: 1,
      timezone: LIMA,
    });
    expect([enero.from, enero.to]).toEqual(['2026-01-01', '2026-01-31']);
    const diciembre = periodoDe({
      tipo: 'mes',
      offset: -9,
      nowISO: NOCHE,
      weekStartsOn: 1,
      timezone: LIMA,
    });
    expect([diciembre.from, diciembre.to]).toEqual(['2025-12-01', '2025-12-31']);
    const febrero = periodoDe({
      tipo: 'mes',
      offset: -7,
      nowISO: NOCHE,
      weekStartsOn: 1,
      timezone: LIMA,
    });
    expect(febrero.to).toBe('2026-02-28');
    const bisiesto = periodoDe({
      tipo: 'mes',
      offset: 17,
      nowISO: NOCHE,
      weekStartsOn: 1,
      timezone: LIMA,
    });
    expect(bisiesto.to).toBe('2028-02-29');
  });

  it('la semana sigue siendo la de siempre', () => {
    const p = periodoDe({
      tipo: 'semana',
      offset: 0,
      nowISO: NOCHE,
      weekStartsOn: 1,
      timezone: LIMA,
    });
    expect([p.from, p.to]).toEqual(['2026-09-28', '2026-10-04']);
    expect(p.dias).toHaveLength(7);
  });

  it('las semanas del mes van recortadas al mes', () => {
    const p = periodoDe({ tipo: 'mes', offset: 0, nowISO: NOCHE, weekStartsOn: 1, timezone: LIMA });
    const semanas = semanasDelMes(p.dias, 1);
    // Septiembre de 2026 empieza en martes: la primera semana es del 1 al 6.
    expect(semanas[0]).toMatchObject({ inicio: '2026-09-01', fin: '2026-09-06' });
    expect(semanas[semanas.length - 1]).toMatchObject({ inicio: '2026-09-28', fin: '2026-09-30' });
    expect(semanas.flatMap((s) => s.dias)).toEqual(p.dias);
  });
});
