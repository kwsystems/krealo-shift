import type { ShiftRow } from '@/features/schedules/api';
import { cubreElTurno, faltasDeLosTurnos, type JornadaParaFaltas } from '../faltas';

/**
 * La falta: un turno publicado y terminado, desde que la sede usa el reloj, sin ninguna
 * jornada de esa persona durante el turno. Cada caso es una forma de que lo sea o no.
 */

const LIMA = 'America/Lima';
const DESPUES = '2026-10-01T05:00:00.000Z';

function turno(extra: Partial<ShiftRow> = {}): ShiftRow {
  return {
    id: 't1',
    employee_id: 'ana',
    location_id: 'l1',
    job_role_id: null,
    starts_at: '2026-09-30T15:00:00.000Z', // 10:00 en Lima
    ends_at: '2026-09-30T23:00:00.000Z', // 18:00
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

function jornada(extra: Partial<JornadaParaFaltas> = {}): JornadaParaFaltas {
  return {
    employee_id: 'ana',
    shift_id: null,
    starts_at: '2026-09-30T15:05:00.000Z',
    ends_at: '2026-09-30T23:00:00.000Z',
    ...extra,
  };
}

function faltas(
  turnos: ShiftRow[],
  jornadas: JornadaParaFaltas[],
  opciones: { relojDesde?: string | null; ahora?: string } = {},
) {
  return faltasDeLosTurnos({
    turnos,
    jornadas,
    relojDesde: () => (opciones.relojDesde === undefined ? '2026-09-29' : opciones.relojDesde),
    ahoraISO: opciones.ahora ?? DESPUES,
    timezone: LIMA,
  });
}

describe('la falta', () => {
  it('un turno publicado que terminó sin ninguna marca es una falta, en su día de la sede', () => {
    const [f] = faltas([turno()], []);
    expect(f).toMatchObject({ id: 't1', employeeId: 'ana', dia: '2026-09-30' });
  });

  it('un borrador o un turno cancelado no es una falta: no se le llegó a dar', () => {
    expect(
      faltas([turno({ status: 'draft' }), turno({ id: 't2', status: 'cancelled' })], []),
    ).toEqual([]);
  });

  it('mientras el turno dura no es falta todavía: puede llegar', () => {
    expect(faltas([turno()], [], { ahora: '2026-09-30T20:00:00.000Z' })).toEqual([]);
  });

  it('antes del día en que la sede empezó a usar el reloj no hay faltas', () => {
    expect(faltas([turno()], [], { relojDesde: '2026-10-01' })).toEqual([]);
    expect(faltas([turno()], [], { relojDesde: null })).toEqual([]);
  });

  it('sin saber desde cuándo hay reloj, no se afirma ninguna falta', () => {
    const resultado = faltasDeLosTurnos({
      turnos: [turno()],
      jornadas: [],
      relojDesde: () => undefined,
      ahoraISO: DESPUES,
      timezone: LIMA,
    });
    expect(resultado).toEqual([]);
  });

  it('una jornada atada al turno lo cubre, aunque sea de otra hora', () => {
    const atada = jornada({
      shift_id: 't1',
      starts_at: '2026-09-30T12:00:00.000Z',
      ends_at: '2026-09-30T13:00:00.000Z',
    });
    expect(faltas([turno()], [atada])).toEqual([]);
  });

  it('una jornada sin turno que se cruza con su horario lo cubre: llegar tarde no es faltar', () => {
    const tarde = jornada({ starts_at: '2026-09-30T19:00:00.000Z' });
    expect(faltas([turno()], [tarde])).toEqual([]);
  });

  it('la jornada de OTRA persona no la cubre', () => {
    expect(faltas([turno()], [jornada({ employee_id: 'bea' })])).toHaveLength(1);
  });

  it('venir por la mañana no cubre el turno de la tarde', () => {
    const tardeDelTurno = turno({
      starts_at: '2026-09-30T19:00:00.000Z',
      ends_at: '2026-10-01T00:00:00.000Z',
    });
    const manana = jornada({
      starts_at: '2026-09-30T13:00:00.000Z',
      ends_at: '2026-09-30T18:30:00.000Z',
    });
    expect(faltas([tardeDelTurno], [manana], { ahora: '2026-10-01T05:00:00.000Z' })).toHaveLength(
      1,
    );
  });

  it('quien se queda las dos mitades de un turno partido con una jornada cubre las dos', () => {
    const manana = turno({ id: 'm', ends_at: '2026-09-30T18:00:00.000Z' });
    const tarde = turno({ id: 't', starts_at: '2026-09-30T20:00:00.000Z' });
    const todoElDia = jornada({ shift_id: 'm' });
    expect(faltas([manana, tarde], [todoElDia])).toEqual([]);
  });

  it('una jornada abierta cuenta hasta ahora', () => {
    const abierta = jornada({ ends_at: null });
    expect(cubreElTurno(turno(), [abierta], Date.parse('2026-09-30T16:00:00.000Z'))).toBe(true);
  });

  it('salen en orden, de la más antigua a la más reciente', () => {
    const lunes = turno({
      id: 'lun',
      starts_at: '2026-09-28T15:00:00.000Z',
      ends_at: '2026-09-28T23:00:00.000Z',
    });
    const martes = turno({
      id: 'mar',
      starts_at: '2026-09-29T15:00:00.000Z',
      ends_at: '2026-09-29T23:00:00.000Z',
    });
    expect(faltas([martes, lunes], [], { relojDesde: '2026-09-28' }).map((f) => f.id)).toEqual([
      'lun',
      'mar',
    ]);
  });
});
