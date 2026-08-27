import { analyzeWeek, toScheduledShifts } from '../hooks';
import type { ShiftRow } from '../api';

/**
 * `analyzeWeek` alimenta tres cosas de la pantalla a la vez: las advertencias, el
 * total por empleado y qué está pendiente de publicar. Lo pendiente es
 * exactamente lo que está en borrador: si esta cuenta falla, el gerente publica
 * de menos o de más.
 */

function row(overrides: Partial<ShiftRow> & { id: string }): ShiftRow {
  return {
    employee_id: 'e1',
    location_id: 'l1',
    job_role_id: null,
    starts_at: '2026-08-24T14:00:00.000Z',
    ends_at: '2026-08-24T22:00:00.000Z',
    timezone: 'America/Lima',
    planned_unpaid_break_minutes: 0,
    employee_note: null,
    manager_note: null,
    status: 'draft',
    publication_version: 0,
    published_at: null,
    updated_at: '2026-08-23T10:00:00.000Z',
    ...overrides,
  };
}

const names = new Map([
  ['e1', 'Ana'],
  ['e2', 'Luis'],
]);

describe('conversión de filas a turnos de cálculo', () => {
  it('resuelve el nombre del empleado y conserva el estado', () => {
    const shifts = toScheduledShifts([row({ id: 'a' })], names);

    expect(shifts[0]?.employeeName).toBe('Ana');
    expect(shifts[0]?.status).toBe('draft');
  });

  it('deja el nombre vacío si el empleado no está en el mapa, sin romperse', () => {
    const shifts = toScheduledShifts([row({ id: 'a', employee_id: 'desconocido' })], names);
    expect(shifts[0]?.employeeName).toBe('');
  });
});

describe('análisis de la semana', () => {
  it('cuenta como pendiente de publicar solo lo que está en borrador', () => {
    const shifts = toScheduledShifts(
      [
        row({ id: 'a' }),
        row({
          id: 'b',
          status: 'published',
          publication_version: 1,
          published_at: '2026-08-20T10:00:00.000Z',
          starts_at: '2026-08-25T14:00:00.000Z',
          ends_at: '2026-08-25T22:00:00.000Z',
        }),
        row({
          id: 'c',
          status: 'cancelled',
          starts_at: '2026-08-26T14:00:00.000Z',
          ends_at: '2026-08-26T22:00:00.000Z',
        }),
      ],
      names,
    );

    const analysis = analyzeWeek({
      shifts,
      minimumRestMinutes: 660,
      weeklyLimitMinutes: 2400,
    });

    expect(analysis.pendingShiftIds).toEqual(['a']);
  });

  it('suma el total de la semana sin los turnos cancelados', () => {
    const shifts = toScheduledShifts(
      [
        row({ id: 'a' }),
        row({
          id: 'b',
          employee_id: 'e2',
          starts_at: '2026-08-25T14:00:00.000Z',
          ends_at: '2026-08-25T20:00:00.000Z',
        }),
        row({
          id: 'c',
          status: 'cancelled',
          starts_at: '2026-08-26T14:00:00.000Z',
          ends_at: '2026-08-26T22:00:00.000Z',
        }),
      ],
      names,
    );

    const analysis = analyzeWeek({
      shifts,
      minimumRestMinutes: 0,
      weeklyLimitMinutes: 0,
    });

    expect(analysis.minutesByEmployee.get('e1')).toBe(480);
    expect(analysis.minutesByEmployee.get('e2')).toBe(360);
    expect(analysis.totalMinutes).toBe(840);
  });

  it('devuelve las advertencias de la semana con el nombre de la persona', () => {
    const shifts = toScheduledShifts(
      [
        row({ id: 'a' }),
        row({
          id: 'b',
          starts_at: '2026-08-24T20:00:00.000Z',
          ends_at: '2026-08-25T02:00:00.000Z',
        }),
      ],
      names,
    );

    const analysis = analyzeWeek({
      shifts,
      minimumRestMinutes: 660,
      weeklyLimitMinutes: 2400,
    });

    expect(analysis.warnings).toHaveLength(1);
    expect(analysis.warnings[0]).toMatchObject({ kind: 'overlap', employeeName: 'Ana' });
  });
});
