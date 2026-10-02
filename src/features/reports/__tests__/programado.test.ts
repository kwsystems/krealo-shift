import type { ShiftRow } from '@/features/schedules/api';
import { minutosDelTurno, minutosHastaAhora, programadoDelPeriodo } from '../programado';

/**
 * Lo programado: lo que se esperaba que se trabajara, entero y hasta ahora. Cada caso es
 * una forma de que la comparación con lo trabajado diga la verdad o mienta.
 */

const LIMA = 'America/Lima';

function turno(extra: Partial<ShiftRow> = {}): ShiftRow {
  return {
    id: 't1',
    employee_id: 'ana',
    location_id: 'l1',
    job_role_id: null,
    starts_at: '2026-10-01T15:00:00.000Z', // 10:00 en Lima
    ends_at: '2026-10-01T23:00:00.000Z', // 18:00
    timezone: LIMA,
    planned_unpaid_break_minutes: 60,
    employee_note: null,
    manager_note: null,
    status: 'published',
    publication_version: 1,
    published_at: null,
    updated_at: '',
    ...extra,
  };
}

describe('lo programado', () => {
  it('un turno de 8 h con 1 h de refrigerio son 7 h esperadas', () => {
    expect(minutosDelTurno(turno())).toBe(420);
  });

  it('hasta ahora: nada antes de empezar, la mitad a medio turno, todo al terminar', () => {
    const t = turno();
    expect(minutosHastaAhora(t, Date.parse('2026-10-01T14:00:00.000Z'))).toBe(0);
    expect(minutosHastaAhora(t, Date.parse('2026-10-01T19:00:00.000Z'))).toBe(210);
    expect(minutosHastaAhora(t, Date.parse('2026-10-02T00:00:00.000Z'))).toBe(420);
  });

  it('solo cuenta lo publicado y de los días que se miran, por día y por persona', () => {
    const otroDia = turno({
      id: 't2',
      starts_at: '2026-10-02T15:00:00.000Z',
      ends_at: '2026-10-02T23:00:00.000Z',
    });
    const borrador = turno({ id: 't3', status: 'draft' });
    const deBea = turno({ id: 't4', employee_id: 'bea', planned_unpaid_break_minutes: 0 });
    const p = programadoDelPeriodo({
      turnos: [turno(), otroDia, borrador, deBea],
      dias: ['2026-10-01'],
      ahoraISO: '2026-10-01T19:00:00.000Z',
      timezone: LIMA,
    });
    expect(p.total).toBe(420 + 480);
    expect(p.hastaAhora).toBe(210 + 240);
    expect(p.porPersona.get('ana')).toEqual({ total: 420, hastaAhora: 210 });
    expect(p.porPersona.get('bea')).toEqual({ total: 480, hastaAhora: 240 });
    expect(p.porDia.get('2026-10-01')).toEqual({ total: 900, hastaAhora: 450 });
    expect(p.porDia.has('2026-10-02')).toBe(false);
  });

  it('el día es el de la sede: un turno de las 20:00 en Lima es de ese día aunque en UTC sea el siguiente', () => {
    const deNoche = turno({
      starts_at: '2026-10-02T01:00:00.000Z', // 20:00 del 1 en Lima
      ends_at: '2026-10-02T05:00:00.000Z',
      planned_unpaid_break_minutes: 0,
    });
    const p = programadoDelPeriodo({
      turnos: [deNoche],
      dias: ['2026-10-01'],
      ahoraISO: '2026-10-03T00:00:00.000Z',
      timezone: LIMA,
    });
    expect(p.total).toBe(240);
  });
});
