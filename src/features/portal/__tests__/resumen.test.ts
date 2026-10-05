import type { ShiftRow } from '@/features/schedules/api';
import type { WorkSession } from '@/features/timesheets/api';
import { diasDelVendedor, minutosDeLaJornada, resumenDelMes } from '../resumen';

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

const dias = (
  turnos: ShiftRow[],
  jornadas: WorkSession[],
  lista: string[],
  relojDesde?: string | null,
) =>
  diasDelVendedor({
    dias: lista.map((d) => `2026-10-${d}`),
    turnos,
    jornadas,
    timezone: LIMA,
    nowISO: AHORA,
    relojDesde: relojDesde === undefined ? undefined : () => relojDesde,
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

  it('sin saber desde cuándo hay reloj, un turno terminado sin marca dice «sin marca»', () => {
    const [d] = dias([turno('05')], [], ['05']);
    expect(d?.estado).toBe('sinMarca');
  });

  it('desde que su tienda usa el reloj, ese turno es una FALTA (1-oct)', () => {
    const t = turno('05');
    const [d] = dias([t], [], ['05'], '2026-10-01');
    expect(d?.estado).toBe('falta');
    expect(d?.faltas.map((f) => f.id)).toEqual([t.id]);
  });

  it('de antes del reloj sigue siendo «sin marca»: no se pudo marcar', () => {
    const [d] = dias([turno('05')], [], ['05'], '2026-10-06');
    expect(d?.estado).toBe('sinMarca');
    expect(d?.faltas).toEqual([]);
  });

  it('vino a un turno y no al otro del mismo día: dice cómo llegó, y la falta aparte', () => {
    const manana = turno('05', '13:00', '17:00');
    const tarde = turno('05', '19:00', '23:00');
    const [d] = dias([manana, tarde], [jornada(manana)], ['05'], '2026-10-01');
    expect(d?.estado).toBe('aTiempo');
    expect(d?.faltas.map((f) => f.id)).toEqual([tarde.id]);
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
    // NUNCA publicado (versión 0). Uno ya publicado y en cambio sale «por confirmar»: ver abajo.
    const borrador = { ...turno('09'), status: 'draft' as const, publication_version: 0 };
    const [d] = dias([borrador], [], ['09']);
    expect(d?.estado).toBe('libre');
  });
});

/*
 * UN TURNO QUE QUIEN GESTIONA ESTÁ CAMBIANDO (4-oct). Ya se le publicó y se editó sin volver
 * a publicar: el «Cambiado» de Horario. Antes desaparecía de su celular y el día decía
 * «Libre». Ahora sale «por confirmar», y no cuenta como falta ni como turno, igual que en
 * Horario e Inicio.
 */
describe('el turno que se está cambiando', () => {
  const cambiando = (dia: string, desde?: string, hasta?: string): ShiftRow => ({
    ...turno(dia, desde, hasta),
    status: 'draft',
    publication_version: 1,
  });

  it('sale «por confirmar», no «libre»', () => {
    const [d] = dias([cambiando('09')], [], ['09']);
    expect(d?.estado).toBe('porConfirmar');
    expect(d?.turnos).toEqual([]);
    expect(d?.porConfirmar).toHaveLength(1);
  });

  it('pasado y sin marca NO es falta: todavía no es un turno publicado', () => {
    const [d] = dias([cambiando('05')], [], ['05'], '2026-10-01');
    expect(d?.estado).toBe('porConfirmar');
    expect(d?.faltas).toEqual([]);
  });

  it('un borrador que nunca se publicó no sale: esa semana no existe para ella', () => {
    const nunca = { ...turno('09'), status: 'draft' as const, publication_version: 0 };
    const [d] = dias([nunca], [], ['09']);
    expect(d?.estado).toBe('libre');
    expect(d?.porConfirmar).toEqual([]);
  });

  it('con otro turno publicado el mismo día, manda el publicado y el otro se dice aparte', () => {
    const [d] = dias(
      [turno('09', '13:00', '17:00'), cambiando('09', '20:00', '23:00')],
      [],
      ['09'],
    );
    expect(d?.estado).toBe('porVenir');
    expect(d?.turnos).toHaveLength(1);
    expect(d?.porConfirmar).toHaveLength(1);
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
      faltas: 0,
      faltasJustificadas: 0,
      sinMarca: 1,
    });
  });

  it('las faltas se cuentan por turno, como las cuenta quien administra', () => {
    const lista = dias([turno('05'), turno('06')], [], ['05', '06'], '2026-10-01');
    expect(resumenDelMes(lista)).toMatchObject({ faltas: 2, sinMarca: 0 });
  });

  it('ve su falta justificada, con el motivo, y cuántas lo están (2-oct)', () => {
    const [a, b] = [turno('05'), turno('06')];
    const justificada = {
      id: a.id,
      organization_id: 'o',
      location_id: 'sede',
      employee_id: 'yo',
      shift_id: a.id,
      work_date: '2026-10-05',
      kind: 'justified' as const,
      reason: 'medical' as const,
      note: 'Trajo certificado',
      decided_at: null,
    };
    const lista = diasDelVendedor({
      dias: ['2026-10-05', '2026-10-06'],
      turnos: [a, b],
      jornadas: [],
      timezone: LIMA,
      nowISO: AHORA,
      relojDesde: () => '2026-10-01',
      resoluciones: [justificada],
    });
    expect(lista.map((d) => d.estado)).toEqual(['faltaJustificada', 'falta']);
    expect(lista[0]?.justificaciones).toEqual([justificada]);
    expect(lista[1]?.justificaciones).toEqual([]);
    expect(resumenDelMes(lista)).toMatchObject({ faltas: 2, faltasJustificadas: 1 });
  });
});

describe('lo que lleva hoy, con la cuenta de Horas (2-oct)', () => {
  const t = turno('07', '14:00', '23:00');
  const abierta = jornada(t, {
    starts_at: '2026-10-07T14:00:00.000Z',
    ends_at: null,
    net_minutes: null,
    unpaid_break_minutes: 30,
    status: 'open',
  });

  it('descuenta los descansos tomados y trunca como Horas', () => {
    // 14:00 → 20:00:59 son 360 min; menos 30 de descanso.
    expect(minutosDeLaJornada(abierta, '2026-10-07T20:00:59.000Z')).toBe(330);
  });

  it('se para mientras está en su pausa', () => {
    expect(
      minutosDeLaJornada(abierta, '2026-10-07T20:00:00.000Z', '2026-10-07T19:00:00.000Z'),
    ).toBe(270);
  });

  it('una salida olvidada no suma horas ni sale como «trabajando»', () => {
    const ayer = jornada(turno('06'), {
      starts_at: '2026-10-06T14:00:00.000Z',
      ends_at: null,
      net_minutes: null,
      status: 'open',
    });
    expect(minutosDeLaJornada(ayer, AHORA)).toBe(0);
    const [d] = dias([turno('06')], [ayer], ['06'], '2026-10-01');
    expect(d).toMatchObject({ estado: 'sinSalida', minutosNetos: 0 });
  });
});
