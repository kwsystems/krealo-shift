import type { ShiftRow } from '@/features/schedules/api';
import type { WorkSession } from '@/features/timesheets/api';
import { situacionDeHoy } from '../hoy';
import { diasDelVendedor } from '../resumen';

/**
 * La tarjeta «Hoy» del celular, en los tres casos en que mentía (auditoría, 4-oct): pasada
 * la medianoche, en turno partido y sin la tolerancia de la sede.
 */

const LIMA = 'America/Lima';
const TOLERANCIA = 10;

let n = 0;
/** Horas de Lima, el 7 de octubre salvo que se diga otro día. */
function turno(desde: string, hasta: string, dia = '07', diaFin = dia): ShiftRow {
  n += 1;
  return {
    id: `t${n}`,
    employee_id: 'yo',
    location_id: 'sede',
    job_role_id: null,
    starts_at: `2026-10-${dia}T${desde}:00.000-05:00`,
    ends_at: `2026-10-${diaFin}T${hasta}:00.000-05:00`,
    timezone: LIMA,
    planned_unpaid_break_minutes: 0,
    employee_note: null,
    manager_note: null,
    status: 'published',
    publication_version: 1,
    published_at: null,
    updated_at: '',
  };
}

function jornada(
  t: ShiftRow,
  ends_at: string | null = t.ends_at,
  starts_at = t.starts_at,
): WorkSession {
  return {
    id: `j-${t.id}`,
    employee_id: 'yo',
    location_id: 'sede',
    shift_id: t.id,
    starts_at,
    ends_at,
    gross_minutes: 0,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_minutes: 0,
    status: ends_at === null ? 'open' : 'complete',
    flags: [],
    departure_reason: null,
    departure_note: null,
    credit_reason: null,
    credit_note: null,
    source: null,
    avisos_vistos: [],
    casos_resueltos: [],
    updated_at: '',
  };
}

function hoy(params: {
  ahora: string;
  turnos: ShiftRow[];
  jornadas?: WorkSession[];
  dia?: string;
}) {
  const nowISO = new Date(
    `2026-10-${params.dia ?? '07'}T${params.ahora}:00.000-05:00`,
  ).toISOString();
  const jornadas = params.jornadas ?? [];
  const [dia] = diasDelVendedor({
    dias: [`2026-10-${params.dia ?? '07'}`],
    turnos: params.turnos,
    jornadas,
    timezone: LIMA,
    nowISO,
    relojDesde: () => '2026-01-01',
  });
  return situacionDeHoy({
    dia: dia!,
    abierta: jornadas.find((j) => j.ends_at === null),
    enDescanso: false,
    nowISO,
    toleranciaMin: TOLERANCIA,
  });
}

describe('situacionDeHoy', () => {
  it('a las 00:30 de un turno 18:00–01:00 está trabajando, no de día libre', () => {
    const noche = turno('18:00', '01:00', '06', '07');
    const situacion = hoy({ ahora: '00:30', turnos: [noche], jornadas: [jornada(noche, null)] });
    expect(situacion.tipo).toBe('trabajando');
  });

  it('dentro de la tolerancia todavía no es «no has marcado»', () => {
    const t = turno('10:00', '19:00');
    expect(hoy({ ahora: '10:05', turnos: [t] })).toEqual({ tipo: 'empezando', turno: t });
    expect(hoy({ ahora: '10:11', turnos: [t] })).toEqual({ tipo: 'sinLlegar', turno: t });
  });

  it('antes de empezar dice el turno que viene', () => {
    const t = turno('10:00', '19:00');
    expect(hoy({ ahora: '08:00', turnos: [t] })).toEqual({ tipo: 'porVenir', turno: t });
  });

  describe('turno partido', () => {
    const manana = turno('10:00', '14:00');
    const tarde = turno('17:00', '22:00');

    it('hecha la mañana, dice que vuelve a la tarde', () => {
      expect(hoy({ ahora: '15:00', turnos: [manana, tarde], jornadas: [jornada(manana)] })).toEqual(
        { tipo: 'siguiente', turno: tarde },
      );
    });

    it('pasada la hora de la tarde sin marcar, es «no has marcado» de la tarde', () => {
      expect(hoy({ ahora: '17:30', turnos: [manana, tarde], jornadas: [jornada(manana)] })).toEqual(
        { tipo: 'sinLlegar', turno: tarde },
      );
    });

    it('si faltó a la mañana, lo dice y apunta a la tarde', () => {
      const situacion = hoy({ ahora: '15:00', turnos: [manana, tarde] });
      expect(situacion).toEqual({
        tipo: 'falta',
        faltas: [manana],
        justificada: false,
        siguiente: tarde,
      });
    });

    it('hecha la mañana y faltada la tarde, terminado con la falta', () => {
      expect(hoy({ ahora: '23:00', turnos: [manana, tarde], jornadas: [jornada(manana)] })).toEqual(
        { tipo: 'terminado', faltas: [tarde] },
      );
    });
  });

  it('sin turno ni jornada, día libre', () => {
    expect(hoy({ ahora: '12:00', turnos: [] })).toEqual({ tipo: 'libre' });
  });
});
