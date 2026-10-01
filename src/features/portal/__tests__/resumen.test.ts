import type { ShiftRow } from '@/features/schedules/api';
import type { WorkSession } from '@/features/timesheets/api';
import { diasDelVendedor, resumenDelMes } from '../resumen';

/**
 * Lo que ve el vendedor de cada día. Cada caso es una pregunta que se hace mirando su
 * celular: ¿llegué tarde?, ¿llegué antes?, ¿estoy dentro?, ¿por qué dice «sin marca»?
 */

const LIMA = 'America/Lima';
const AHORA = '2026-10-07T20:00:00.000Z'; // miércoles 7, 15:00 en Lima

let n = 0;
function turno(dia: string, desde = '15:00', hasta = '23:00'): ShiftRow {
  n += 1;
  return {
    id: `t${n}`,
    employee_id: 'yo',
    location_id: 'sede',
    job_role_id: null,
    starts_at: `2026-10-${dia}T${desde}:00.000Z`,
    ends_at: `2026-10-${dia}T${hasta}:00.000Z`,
    timezone: LIMA,
    planned_unpaid_break_minutes: 60,
    employee_note: null,
    manager_note: null,
    status: 'published',
    publication_version: 1,
    published_at: null,
    updated_at: '',
  };
}

function jornada(t: ShiftRow, extra: Partial<WorkSession> = {}): WorkSession {
  return {
    id: `j-${t.id}`,
    employee_id: 'yo',
    location_id: 'sede',
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
    source: null,
    avisos_vistos: [],
    updated_at: '',
    ...extra,
  };
}

const dias = (turnos: ShiftRow[], jornadas: WorkSession[], lista: string[]) =>
  diasDelVendedor({
    dias: lista.map((d) => `2026-10-${d}`),
    turnos,
    jornadas,
    timezone: LIMA,
    nowISO: AHORA,
  });

describe('los días del vendedor', () => {
  it('a tiempo, y cuántos minutos antes llegó', () => {
    const t = turno('05');
    const [d] = dias([t], [jornada(t, { starts_at: '2026-10-05T14:52:00.000Z' })], ['05']);
    expect(d).toMatchObject({ estado: 'aTiempo', minutosAntes: 8, minutosNetos: 420 });
  });

  it('tarde es la marca del servidor, no una cuenta propia', () => {
    const t = turno('05');
    const [d] = dias([t], [jornada(t, { flags: ['late_arrival'] })], ['05']);
    expect(d?.estado).toBe('tarde');
    expect(d?.minutosAntes).toBeNull();
  });

  it('dentro ahora: en curso, con lo que lleva hasta ahora', () => {
    const t = turno('07');
    // Entró a las 10:00 en Lima; son las 15:00: 5 h brutas, sin descanso descontado todavía.
    const abierta = jornada(t, { ends_at: null, unpaid_break_minutes: 0, net_minutes: 0 });
    const [d] = dias([t], [abierta], ['07']);
    expect(d).toMatchObject({ estado: 'enCurso', minutosNetos: 300 });
  });

  it('un turno que ya terminó sin ninguna marca dice «sin marca», no «faltó»', () => {
    const [d] = dias([turno('05')], [], ['05']);
    expect(d?.estado).toBe('sinMarca');
  });

  it('el turno de hoy que aún no empieza es «hoy»; uno de otro día, «por venir»', () => {
    const [hoy, manana] = dias([turno('07', '22:00', '23:30'), turno('08')], [], ['07', '08']);
    expect(hoy?.estado).toBe('hoy');
    expect(manana?.estado).toBe('porVenir');
  });

  it('sin turno ni marca es libre; con marca sin turno, cuenta lo trabajado', () => {
    const suelta = jornada(turno('06'), { shift_id: null });
    const [libre, conMarca] = dias([], [suelta], ['04', '06']);
    expect(libre?.estado).toBe('libre');
    expect(conMarca).toMatchObject({ estado: 'aTiempo', minutosNetos: 420 });
  });

  it('los turnos en borrador no salen: no existen para quien ficha', () => {
    const borrador = { ...turno('09'), status: 'draft' as const };
    const [d] = dias([borrador], [], ['09']);
    expect(d?.estado).toBe('libre');
  });
});

describe('el resumen del mes', () => {
  it('suma horas y cuenta días, a tiempo, antes de hora, tarde y sin marca', () => {
    const a = turno('01');
    const b = turno('02');
    const c = turno('03');
    const d = turno('05');
    const lista = dias(
      [a, b, c, d],
      [
        jornada(a, { starts_at: '2026-10-01T14:50:00.000Z' }),
        jornada(b),
        jornada(c, { flags: ['late_arrival'] }),
      ],
      ['01', '02', '03', '04', '05'],
    );
    expect(resumenDelMes(lista)).toEqual({
      minutosNetos: 1260,
      diasTrabajados: 3,
      aTiempo: 2,
      antesDeHora: 1,
      tarde: 1,
      sinMarca: 1,
    });
  });
});
