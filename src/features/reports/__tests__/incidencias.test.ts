import type { ShiftRow } from '@/features/schedules/api';
import type { WorkSession } from '@/features/timesheets/api';
import type { Falta } from '@/features/timesheets/faltas';
import type { HoraDebida } from '@/features/timesheets/horas-debidas';
import type { ResolucionDeFalta } from '@/features/timesheets/justificaciones';

import { incidenciasDelPeriodo, resumirIncidencias } from '../incidencias';

/**
 * El resumen de Reportes de lo que pasó en el periodo y cómo quedó (4-oct). Lo que importa:
 * que lo ARREGLADO siga contado —una falta justificada sigue siendo una falta del mes—, que
 * cada clase use la regla de la app y no una nueva, y que lo de fuera del periodo no entre.
 */

const LIMA = 'America/Lima';
const DIAS = ['2026-09-28', '2026-09-29', '2026-09-30'];

let n = 0;
function turno(employeeId: string, dia: string, extra: Partial<ShiftRow> = {}): ShiftRow {
  n += 1;
  return {
    id: `t${n}`,
    employee_id: employeeId,
    location_id: 'l1',
    job_role_id: null,
    starts_at: `${dia}T15:00:00.000Z`, // 10:00 en Lima
    ends_at: `${dia}T23:00:00.000Z`, // 18:00
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

function sesion(t: ShiftRow, extra: Partial<WorkSession> = {}): WorkSession {
  return {
    id: `s-${t.id}`,
    employee_id: t.employee_id,
    location_id: 'l1',
    shift_id: t.id,
    starts_at: t.starts_at,
    ends_at: t.ends_at,
    gross_minutes: 480,
    paid_break_minutes: 0,
    unpaid_break_minutes: 60,
    net_minutes: 420,
    status: 'complete',
    flags: [],
    departure_reason: null,
    departure_note: null,
    credit_reason: null,
    credit_note: null,
    auto_clock_out: false,
    source: null,
    avisos_vistos: [],
    casos_resueltos: [],
    updated_at: '',
    ...extra,
  };
}

function falta(t: ShiftRow, resolucion: Partial<ResolucionDeFalta> | null = null): Falta {
  return {
    id: t.id,
    turno: t,
    employeeId: t.employee_id,
    dia: t.starts_at.slice(0, 10),
    resolucion:
      resolucion === null
        ? null
        : ({
            id: t.id,
            organization_id: 'o1',
            location_id: 'l1',
            employee_id: t.employee_id,
            shift_id: t.id,
            work_date: t.starts_at.slice(0, 10),
            kind: 'justified',
            reason: 'medical',
            note: null,
            decided_at: null,
            ...resolucion,
          } as ResolucionDeFalta),
  };
}

function debida(employeeId: string, dia: string, minutes: number, status: HoraDebida['status']) {
  return {
    id: `d-${employeeId}-${dia}`,
    employee_id: employeeId,
    location_id: 'l1',
    work_session_id: null,
    work_date: dia,
    minutes,
    note: null,
    status,
    created_at: null,
  } satisfies HoraDebida;
}

const calcular = (p: {
  faltas?: Falta[];
  sesiones?: WorkSession[];
  turnos?: ShiftRow[];
  debidas?: HoraDebida[];
}) =>
  incidenciasDelPeriodo({
    faltas: p.faltas ?? [],
    sesiones: p.sesiones ?? [],
    turnos: p.turnos ?? [],
    debidas: p.debidas ?? [],
    dias: DIAS,
    timezone: LIMA,
  });

describe('incidencias del periodo', () => {
  it('una falta justificada sigue contada: deja de estar en contra, no desaparece', () => {
    const t1 = turno('a', '2026-09-28');
    const t2 = turno('a', '2026-09-29');
    const lista = calcular({ faltas: [falta(t1), falta(t2, { kind: 'justified' })] });
    const { total } = resumirIncidencias(lista);
    expect(total.faltas).toBe(2);
    expect(total.faltasJustificadas).toBe(1);
    expect(total.faltasEnContra).toBe(1);
  });

  it('una tardanza es la marca del servidor, con los minutos hasta su turno', () => {
    const t = turno('a', '2026-09-28');
    const tarde = sesion(t, {
      starts_at: '2026-09-28T15:25:00.000Z', // 10:25
      flags: ['late_arrival'],
    });
    // Llegó un minuto tarde pero dentro de la tolerancia: sin marca, no cuenta.
    const t2 = turno('a', '2026-09-29');
    const aTiempo = sesion(t2, { starts_at: '2026-09-29T15:01:00.000Z' });
    const lista = calcular({ sesiones: [tarde, aTiempo], turnos: [t, t2] });
    expect(lista).toEqual([
      expect.objectContaining({ tipo: 'tarde', minutos: 25, employeeId: 'a', dia: '2026-09-28' }),
    ]);
  });

  it('una jornada que no trae su turno lo encuentra por la hora: el de esa persona ese día', () => {
    const t = turno('a', '2026-09-28');
    const otra = turno('b', '2026-09-28', { starts_at: '2026-09-28T14:00:00.000Z' });
    const lista = calcular({
      turnos: [otra, t],
      sesiones: [
        sesion(t, {
          shift_id: null,
          starts_at: '2026-09-28T15:12:00.000Z', // 10:12
          flags: ['late_arrival'],
        }),
      ],
    });
    expect(lista[0]).toMatchObject({ tipo: 'tarde', minutos: 12 });
  });

  it('sin su turno entre los del periodo, la tardanza se cuenta igual pero sin minutos', () => {
    const t = turno('a', '2026-09-28');
    const lista = calcular({ sesiones: [sesion(t, { flags: ['late_arrival'] })], turnos: [] });
    expect(lista[0]).toMatchObject({ tipo: 'tarde', minutos: null });
    expect(resumirIncidencias(lista).total).toMatchObject({ tardanzas: 1, minutosTarde: 0 });
  });

  it('una salida antes de hora, con lo que faltó y el motivo que dio', () => {
    const t = turno('a', '2026-09-28');
    const lista = calcular({
      turnos: [t],
      sesiones: [
        sesion(t, {
          ends_at: '2026-09-28T21:30:00.000Z', // 16:30 de un turno hasta las 18:00
          flags: ['early_departure'],
          departure_reason: 'illness',
        }),
      ],
    });
    expect(lista).toEqual([
      expect.objectContaining({ tipo: 'salioAntes', minutos: 90, motivo: 'illness' }),
    ]);
  });

  it('un turno dado por cumplido se dice, y no cuenta como tardanza ni salida', () => {
    const t = turno('a', '2026-09-30');
    const lista = calcular({
      turnos: [t],
      sesiones: [
        sesion(t, {
          credit_reason: 'election_duty',
          flags: ['late_arrival'],
          net_minutes: 420,
        }),
      ],
    });
    expect(lista).toEqual([
      expect.objectContaining({ tipo: 'cumplido', motivo: 'election_duty', minutos: 420 }),
    ]);
  });

  it('las horas que debe, por estado, y solo las de los días del periodo', () => {
    const lista = calcular({
      debidas: [
        debida('a', '2026-09-28', 90, 'pending'),
        debida('a', '2026-09-29', 30, 'compensated'),
        debida('b', '2026-09-30', 60, 'forgiven'),
        debida('b', '2026-10-05', 600, 'pending'),
      ],
    });
    const { total } = resumirIncidencias(lista);
    expect(total).toMatchObject({ debePendiente: 90, debeCompensado: 30, debePerdonado: 60 });
  });

  it('lo de fuera del periodo no entra, y el día más reciente va primero', () => {
    const fuera = turno('a', '2026-10-02');
    const t1 = turno('a', '2026-09-28');
    const t2 = turno('b', '2026-09-30');
    const lista = calcular({ faltas: [falta(fuera), falta(t1), falta(t2)] });
    expect(lista.map((i) => i.dia)).toEqual(['2026-09-30', '2026-09-28']);
  });

  it('por persona, primero quien tiene más en contra', () => {
    const ta = turno('a', '2026-09-28');
    const tb1 = turno('b', '2026-09-28');
    const tb2 = turno('b', '2026-09-29');
    const lista = calcular({
      faltas: [falta(ta, { kind: 'justified' }), falta(tb1), falta(tb2)],
    });
    expect(resumirIncidencias(lista).porPersona.map((p) => p.employeeId)).toEqual(['b', 'a']);
  });
});

describe('tardanza y salida antes por turno (auditoría, 4-oct)', () => {
  it('salir a almorzar marcando en el reloj no es «llegó tarde» ni «salió antes»', () => {
    const t = turno('a', '2026-09-29');
    // 10:00–13:00 y 14:00–18:00: el servidor marca las dos mitades por separado.
    const manana = sesion(t, {
      id: 's-manana',
      ends_at: '2026-09-29T18:00:00.000Z',
      flags: ['early_departure'],
    });
    const tarde = sesion(t, {
      id: 's-tarde',
      starts_at: '2026-09-29T19:00:00.000Z',
      flags: ['late_arrival'],
    });
    const lista = calcular({ sesiones: [manana, tarde], turnos: [t] });
    expect(lista.filter((i) => i.tipo === 'tarde' || i.tipo === 'salioAntes')).toEqual([]);
  });

  it('la tardanza se mira en la primera mitad y la salida antes en la última', () => {
    const t = turno('a', '2026-09-29');
    const manana = sesion(t, {
      id: 's-manana',
      starts_at: '2026-09-29T15:20:00.000Z',
      ends_at: '2026-09-29T18:00:00.000Z',
      flags: ['late_arrival', 'early_departure'],
    });
    const tarde = sesion(t, {
      id: 's-tarde',
      starts_at: '2026-09-29T19:00:00.000Z',
      ends_at: '2026-09-29T22:30:00.000Z',
      flags: ['late_arrival', 'early_departure'],
    });
    const lista = calcular({ sesiones: [manana, tarde], turnos: [t] });
    expect(lista.map((i) => `${i.tipo}:${i.id}`).sort()).toEqual([
      'salioAntes:antes:s-tarde',
      'tarde:tarde:s-manana',
    ]);
  });
});
