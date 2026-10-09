import { alertsForSession } from '../alerts';
import { punctuality } from '@/features/reports/aggregate';

import type { WorkSession } from '../api';
import { puntualidadDe, puntualidadPorJornada } from '../puntualidad';

/**
 * Tardanza y salida antes POR TURNO (auditoría, 4-oct). Un turno de 10:00 a 19:00 con la
 * salida a almorzar marcada en el reloj son dos jornadas: el servidor marca la de la mañana
 * «salió antes» y la de la tarde «llegó tarde». Ninguna de las dos cosas pasó.
 */

function jornada(extra: Partial<WorkSession>): WorkSession {
  return {
    id: 'j',
    employee_id: 'e1',
    location_id: 'l1',
    shift_id: 't1',
    starts_at: '2026-10-03T15:00:00.000Z',
    ends_at: '2026-10-03T19:00:00.000Z',
    gross_minutes: 240,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_minutes: 240,
    status: 'complete',
    flags: [],
    departure_reason: null,
    departure_note: null,
    credit_reason: null,
    credit_note: null,
    auto_clock_out: false,
    source: 'kiosk',
    avisos_vistos: [],
    casos_resueltos: [],
    updated_at: '2026-10-03T19:00:00.000Z',
    ...extra,
  };
}

// 10:00–14:00 y 15:00–19:00 en Lima, del turno 10:00–19:00.
const manana = jornada({ id: 'manana', flags: ['early_departure'] });
const tarde = jornada({
  id: 'tarde',
  starts_at: '2026-10-03T20:00:00.000Z',
  ends_at: '2026-10-04T00:00:00.000Z',
  flags: ['late_arrival'],
});

describe('puntualidad por turno', () => {
  it('almorzar marcando en el reloj no es ni tardanza ni salida antes', () => {
    const marcas = puntualidadPorJornada([tarde, manana]);
    expect(puntualidadDe(marcas, manana)).toEqual({
      decidida: false,
      tarde: false,
      salioAntes: false,
      primera: true,
    });
    expect(puntualidadDe(marcas, tarde)).toEqual({
      decidida: false,
      tarde: false,
      salioAntes: false,
      primera: false,
    });
  });

  it('la tardanza es la de la primera jornada y la salida antes la de la última', () => {
    const llegoTarde = { ...manana, flags: ['late_arrival', 'early_departure'] };
    const seFueAntes = { ...tarde, flags: ['late_arrival', 'early_departure'] };
    const marcas = puntualidadPorJornada([llegoTarde, seFueAntes]);
    expect(puntualidadDe(marcas, llegoTarde)).toMatchObject({ tarde: true, salioAntes: false });
    expect(puntualidadDe(marcas, seFueAntes)).toMatchObject({ tarde: false, salioAntes: true });
  });

  it('una jornada sola se queda con sus marcas', () => {
    const sola = jornada({ id: 'sola', flags: ['late_arrival', 'early_departure'] });
    expect(puntualidadDe(puntualidadPorJornada([sola]), sola)).toEqual({
      decidida: false,
      tarde: true,
      salioAntes: true,
      primera: true,
    });
  });

  it('Reportes mide el turno una vez: 100 % a tiempo, no 50 %', () => {
    expect(punctuality([manana, tarde])).toMatchObject({
      measured: 1,
      late: 0,
      onTimePercent: 100,
    });
  });

  // 8-oct: decidida en Por resolver («le debe» / «está justificado»), ya no está por revisar.
  it('una tardanza decidida en Por resolver ya no es un aviso que revisar', () => {
    const decidida = { ...manana, flags: ['late_arrival'], casos_resueltos: ['faltan_horas'] };
    const marcas = puntualidadPorJornada([decidida]);
    expect(puntualidadDe(marcas, decidida)).toMatchObject({ tarde: true, decidida: true });
    expect(
      alertsForSession(decidida, decidida.starts_at, puntualidadDe(marcas, decidida)),
    ).not.toContain('lateArrival');
  });
});
