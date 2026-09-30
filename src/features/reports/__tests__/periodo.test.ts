import type { TFunction } from 'i18next';

import { etiquetaDeDias } from '../etiqueta-del-periodo';
import {
  DIAS_MAXIMOS,
  diasDeDistancia,
  diasEntre,
  periodoDe,
  periodoDeDias,
  semanasDelMes,
  soloLosDias,
} from '../periodo';

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

/*
 * «Por día o varios días o ciertos días en específico» (Andree, 30-sep).
 */
describe('periodo de un día y de días elegidos', () => {
  it('el día es el de la sede, y se mueve de uno en uno', () => {
    // A las 23:30 del 29 en Lima ya es 30 en UTC: el día es el 29.
    const hoy = periodoDe({
      tipo: 'dia',
      offset: 0,
      nowISO: NOCHE,
      weekStartsOn: 1,
      timezone: LIMA,
    });
    expect([hoy.from, hoy.to, hoy.dias]).toEqual(['2026-09-29', '2026-09-29', ['2026-09-29']]);
    expect(hoy.fromISO).toBe('2026-09-29T05:00:00.000Z');
    expect(hoy.toISO).toBe('2026-09-30T05:00:00.000Z');
    const ayer = periodoDe({
      tipo: 'dia',
      offset: -1,
      nowISO: NOCHE,
      weekStartsOn: 1,
      timezone: LIMA,
    });
    expect(ayer.from).toBe('2026-09-28');
  });

  it('días seguidos: del primero al último, sin huecos', () => {
    const p = periodoDeDias(['2026-09-09', '2026-09-07', '2026-09-08'], LIMA);
    expect(p).toMatchObject({ from: '2026-09-07', to: '2026-09-09', seguidos: true });
    expect(p?.dias).toEqual(['2026-09-07', '2026-09-08', '2026-09-09']);
  });

  it('días sueltos: las consultas piden del primero al último, pero cuentan solo los elegidos', () => {
    const p = periodoDeDias(['2026-09-26', '2026-09-05', '2026-09-12', '2026-09-12'], LIMA)!;
    expect(p).toMatchObject({ from: '2026-09-05', to: '2026-09-26', seguidos: false });
    expect(p.dias).toEqual(['2026-09-05', '2026-09-12', '2026-09-26']);

    const filas = ['2026-09-05', '2026-09-06', '2026-09-12', '2026-09-20', '2026-09-26'].map(
      (work_date) => ({ work_date }),
    );
    const clave = p.seguidos ? null : p.dias.join(',');
    expect(soloLosDias(filas, clave, (f) => f.work_date).map((f) => f.work_date)).toEqual([
      '2026-09-05',
      '2026-09-12',
      '2026-09-26',
    ]);
    // Seguidos no quita nada.
    expect(soloLosDias(filas, null, (f) => f.work_date)).toHaveLength(5);
  });

  it('nada elegido no es un periodo', () => {
    expect(periodoDeDias([], LIMA)).toBeNull();
    expect(periodoDeDias(['basura'], LIMA)).toBeNull();
  });

  it('un tramo va en cualquier orden y cruza de mes', () => {
    expect(diasEntre('2026-10-02', '2026-09-29')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    expect(diasDeDistancia('2026-07-01', '2026-09-30')).toBe(92);
    expect(diasDeDistancia('2026-07-01', '2026-09-30')).toBeLessThanOrEqual(DIAS_MAXIMOS);
  });

  it('lo elegido se dice con palabras, igual en el botón, la hoja y lo compartido', () => {
    const t = ((clave: string, v: Record<string, unknown>) =>
      `${clave}|${JSON.stringify(v)}`) as unknown as TFunction;
    const uno = periodoDeDias(['2026-09-29'], LIMA)!;
    expect(etiquetaDeDias(uno, 'es-PE', t)).toBe('Martes 29 de septiembre');
    const seguidos = periodoDeDias(diasEntre('2026-09-07', '2026-09-12'), LIMA)!;
    expect(etiquetaDeDias(seguidos, 'es-PE', t)).toBe(
      'reports.daysRange|{"from":"7 sep","to":"12 sep","total":6}',
    );
    const sueltos = periodoDeDias(['2026-09-05', '2026-09-12'], LIMA)!;
    expect(etiquetaDeDias(sueltos, 'es-PE', t)).toBe(
      'reports.daysLoose|{"count":2,"list":"5 sep, 12 sep"}',
    );
  });
});
