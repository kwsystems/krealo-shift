import { marcasFueraDelTurno } from '@/domain/fuera-del-turno';
import type { WorkSession } from '@/features/timesheets/api';
import { claveDelDia } from '@/features/timesheets/horas-extra';

import type { ShiftRow } from '../api';
import { marcasRarasDeLaSemana } from '../marcas-raras';

/**
 * El aviso de Horario de las marcas raras (Andree, 1-oct): «si marcan 1 hora antes, eso sí
 * debes avisarme, ya veo yo si cambio de horario o es hora extra». Cada prueba es una de
 * las formas en que el aviso tiene que salir o irse.
 */

const TZ = 'America/Lima';
// Martes 29-sep en Lima (UTC-5): turno de 10:00 a 19:00.
const TURNO: ShiftRow = {
  id: 't1',
  employee_id: 'e1',
  location_id: 'l1',
  job_role_id: null,
  starts_at: '2026-09-29T15:00:00.000Z',
  ends_at: '2026-09-30T00:00:00.000Z',
  timezone: TZ,
  planned_unpaid_break_minutes: 60,
  employee_note: null,
  manager_note: null,
  status: 'published',
  publication_version: 1,
  published_at: '2026-09-27T12:00:00.000Z',
  updated_at: '2026-09-27T12:00:00.000Z',
} as ShiftRow;

function jornada(extra: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 's1',
    employee_id: 'e1',
    location_id: 'l1',
    shift_id: 't1',
    starts_at: '2026-09-29T13:40:00.000Z', // 08:40: 1 h 20 min antes
    ends_at: '2026-09-30T00:00:00.000Z',
    gross_minutes: 620,
    paid_break_minutes: 0,
    unpaid_break_minutes: 60,
    net_minutes: 560,
    status: 'complete',
    flags: ['early_arrival'],
    departure_reason: null,
    departure_note: null,
    credit_reason: null,
    credit_note: null,
    auto_clock_out: false,
    source: 'kiosk',
    avisos_vistos: [],
    casos_resueltos: [],
    updated_at: '2026-09-30T00:00:00.000Z',
    ...extra,
  };
}

const raras = (sesiones: WorkSession[], conExtra: string[] = [], turnos = [TURNO]) =>
  marcasRarasDeLaSemana({
    sesiones,
    turnos,
    conExtraDecidida: new Set(conExtra),
    timezone: TZ,
  });

describe('marcas raras de la semana', () => {
  it('entrar 1 h 20 min antes sale, con cuánto y de qué día', () => {
    const [rara, ...resto] = raras([jornada()]);
    expect(resto).toEqual([]);
    expect(rara).toMatchObject({ marca: 'early_arrival', minutos: 80, dia: '2026-09-29' });
    expect(rara?.turno?.id).toBe('t1');
  });

  it('las dos marcas de una misma jornada son dos avisos', () => {
    const sesion = jornada({
      ends_at: '2026-09-30T02:30:00.000Z', // 21:30: 2 h 30 min después
      flags: ['early_arrival', 'late_departure'],
    });
    expect(raras([sesion]).map((r) => [r.marca, r.minutos])).toEqual([
      ['early_arrival', 80],
      ['late_departure', 150],
    ]);
  });

  it('«visto, está bien así» la quita, pero solo la marca vista', () => {
    const sesion = jornada({
      ends_at: '2026-09-30T02:30:00.000Z',
      flags: ['early_arrival', 'late_departure'],
      avisos_vistos: ['early_arrival'],
    });
    expect(raras([sesion]).map((r) => r.marca)).toEqual(['late_departure']);
  });

  it('aprobar las horas extra de ese día la da por decidida', () => {
    expect(raras([jornada()], [claveDelDia('e1', '2026-09-29')])).toEqual([]);
    // La de otro día, no.
    expect(raras([jornada()], [claveDelDia('e1', '2026-09-28')])).toHaveLength(1);
  });

  /*
   * DECIDIR ES EN HORAS (6-oct): Horario solo avisa y lleva allí. Con el día aún abierto no
   * hay caso en «Por resolver» todavía, así que el aviso tiene que saber si lo está.
   */
  it('dice si ese día sigue abierto: una jornada partida sin salida lo deja abierto', () => {
    expect(raras([jornada()])[0]?.diaAbierto).toBe(false);
    expect(raras([jornada({ ends_at: null, status: 'open' })])[0]?.diaAbierto).toBe(true);
    // La mañana cerrada con su marca, la tarde aún sin salida: el día sigue abierto.
    const manana = jornada({ ends_at: '2026-09-29T18:00:00.000Z' });
    const tarde = jornada({
      id: 's2',
      starts_at: '2026-09-29T19:00:00.000Z',
      ends_at: null,
      status: 'open',
      flags: [],
    });
    expect(raras([manana, tarde])[0]?.diaAbierto).toBe(true);
    // La de otra persona sin salida no abre el día de esta.
    expect(raras([manana, { ...tarde, employee_id: 'e2' }])[0]?.diaAbierto).toBe(false);
  });

  it('el resto de las marcas no son avisos de Horario', () => {
    expect(raras([jornada({ flags: ['late_arrival', 'unscheduled', 'clock_drift'] })])).toEqual([]);
  });

  it('con su turno fuera de la semana que se mira, sale igual, sin minutos', () => {
    expect(raras([jornada()], [], [])[0]).toMatchObject({ turno: null, minutos: 0 });
  });
});

describe('la regla del umbral', () => {
  it('quince minutos antes no es raro; una hora sí', () => {
    const base = { salida: null, turno: TURNO, umbralMinutos: 60 };
    expect(marcasFueraDelTurno({ ...base, entrada: '2026-09-29T14:45:00.000Z' })).toEqual([]);
    expect(marcasFueraDelTurno({ ...base, entrada: '2026-09-29T14:00:00.000Z' })).toEqual([
      'early_arrival',
    ]);
  });
});
