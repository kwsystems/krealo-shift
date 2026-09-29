import type { ShiftRow } from '../api';
import { estadoDelTurnoAhora, type DentroAhora } from '../en-turno';

/**
 * Qué tarjeta del Horario se pinta de verde. La regla es «ha fichado en este turno», no
 * «le toca a esta hora»: verde de alguien que no ha llegado sería mentir.
 */

function turno(overrides: Partial<ShiftRow> = {}): ShiftRow {
  return {
    id: 'manana',
    employee_id: 'e1',
    location_id: 'l1',
    job_role_id: null,
    starts_at: '2026-09-29T15:00:00.000Z', // 10:00 en Lima
    ends_at: '2026-09-30T00:00:00.000Z', // 19:00 en Lima
    timezone: 'America/Lima',
    planned_unpaid_break_minutes: 60,
    employee_note: null,
    manager_note: null,
    status: 'published',
    publication_version: 1,
    published_at: '2026-09-27T12:00:00.000Z',
    updated_at: '2026-09-27T12:00:00.000Z',
    ...overrides,
  };
}

const AHORA = '2026-09-29T17:00:00.000Z'; // 12:00 en Lima

function dentro(overrides: Partial<DentroAhora> = {}): DentroAhora {
  return {
    estado: 'trabajando',
    shiftId: 'manana',
    desde: '2026-09-29T14:55:00.000Z',
    ...overrides,
  };
}

describe('estado de un turno del Horario ahora mismo', () => {
  it('quien fichó en este turno sale trabajando', () => {
    expect(estadoDelTurnoAhora(turno(), dentro(), AHORA)).toBe('trabajando');
  });

  it('en su refrigerio sale en descanso', () => {
    expect(estadoDelTurnoAhora(turno(), dentro({ estado: 'descanso' }), AHORA)).toBe('descanso');
  });

  it('en su almuerzo sale «almorzando»; en otra pausa, en descanso', () => {
    expect(
      estadoDelTurnoAhora(turno(), dentro({ estado: 'descanso', motivo: 'meal' }), AHORA),
    ).toBe('almorzando');
    expect(
      estadoDelTurnoAhora(turno(), dentro({ estado: 'descanso', motivo: 'errand' }), AHORA),
    ).toBe('descanso');
  });

  it('un turno en su horario SIN fichaje no se pinta', () => {
    expect(estadoDelTurnoAhora(turno(), undefined, AHORA)).toBeNull();
  });

  it('con dos turnos el mismo día, solo el de la entrada', () => {
    const tarde = turno({
      id: 'tarde',
      starts_at: '2026-09-29T20:00:00.000Z',
      ends_at: '2026-09-30T01:00:00.000Z',
    });
    expect(estadoDelTurnoAhora(turno(), dentro(), AHORA)).toBe('trabajando');
    expect(estadoDelTurnoAhora(tarde, dentro(), AHORA)).toBeNull();
  });

  it('quien entró unos minutos antes de su hora ya sale trabajando', () => {
    expect(estadoDelTurnoAhora(turno(), dentro(), '2026-09-29T14:56:00.000Z')).toBe('trabajando');
  });

  it('si fichó sin turno, se pinta el suyo que esté en curso y ningún otro', () => {
    const sinTurno = dentro({ shiftId: null });
    expect(estadoDelTurnoAhora(turno(), sinTurno, AHORA)).toBe('trabajando');
    const manana = turno({
      id: 'otro-dia',
      starts_at: '2026-09-30T15:00:00.000Z',
      ends_at: '2026-10-01T00:00:00.000Z',
    });
    expect(estadoDelTurnoAhora(manana, sinTurno, AHORA)).toBeNull();
  });

  it('una salida olvidada de ayer no pinta de verde el turno de ayer', () => {
    const ayer = turno({
      id: 'ayer',
      starts_at: '2026-09-28T15:00:00.000Z',
      ends_at: '2026-09-29T00:00:00.000Z',
    });
    const olvidada = dentro({ shiftId: 'ayer', desde: '2026-09-28T14:55:00.000Z' });
    expect(estadoDelTurnoAhora(ayer, olvidada, AHORA)).toBeNull();
  });

  it('un turno cancelado no se pinta aunque haya fichado en él', () => {
    expect(estadoDelTurnoAhora(turno({ status: 'cancelled' }), dentro(), AHORA)).toBeNull();
  });
});
