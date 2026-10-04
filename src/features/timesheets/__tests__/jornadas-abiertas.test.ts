import type { WorkSession } from '../api';
import { conLasAbiertas } from '../jornadas-abiertas';

/**
 * Una salida olvidada el sábado sigue en «Por resolver» y en Inicio el lunes (auditoría,
 * 4-oct): las jornadas de la semana más las abiertas de antes, sin repetir ninguna.
 */

function jornada(id: string, startsAt: string, endsAt: string | null): WorkSession {
  return {
    id,
    employee_id: 'e1',
    location_id: 'l1',
    shift_id: null,
    starts_at: startsAt,
    ends_at: endsAt,
    gross_minutes: null,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_minutes: null,
    status: endsAt === null ? 'open' : 'complete',
    flags: [],
    departure_reason: null,
    departure_note: null,
    credit_reason: null,
    credit_note: null,
    source: null,
    avisos_vistos: [],
    casos_resueltos: [],
    updated_at: startsAt,
  };
}

const sabado = jornada('sab', '2026-10-03T15:00:00.000Z', null);
const lunes = jornada('lun', '2026-10-05T15:00:00.000Z', '2026-10-05T23:00:00.000Z');
const hoy = jornada('hoy', '2026-10-06T15:00:00.000Z', null);
const FIN_DE_SEMANA = '2026-10-12T05:00:00.000Z';

describe('conLasAbiertas', () => {
  it('suma la abierta de la semana anterior, en su sitio por hora de entrada', () => {
    expect(
      conLasAbiertas([lunes, hoy], [sabado, hoy], FIN_DE_SEMANA).map((sesion) => sesion.id),
    ).toEqual(['sab', 'lun', 'hoy']);
  });

  it('no repite la que ya está en la semana', () => {
    expect(conLasAbiertas([hoy], [hoy], FIN_DE_SEMANA)).toHaveLength(1);
  });

  it('no trae a una semana pasada lo que empezó después', () => {
    expect(conLasAbiertas([], [hoy], '2026-10-05T05:00:00.000Z')).toEqual([]);
  });

  it('sin la lista de abiertas todavía, deja la semana como estaba', () => {
    expect(conLasAbiertas([lunes], undefined, FIN_DE_SEMANA)).toEqual([lunes]);
  });
});
