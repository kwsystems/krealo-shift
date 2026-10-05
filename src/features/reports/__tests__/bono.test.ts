import type { ShiftRow } from '@/features/schedules/api';
import type { WorkSession } from '@/features/timesheets/api';
import type { ResolucionDeFalta } from '@/features/timesheets/justificaciones';
import { bonoDeAsistencia, type EmpleadoDelBono } from '../bono';

/**
 * El bono de asistencia: sin faltas y a tiempo en todos los turnos del mes, con el mes
 * completo. Cada caso es una forma de ganarlo o de perderlo.
 */

const LIMA = 'America/Lima';
const DESDE = '2026-09-01';
const FIN = '2026-10-01T05:00:00.000Z';
const TRAS_EL_MES = '2026-10-02T15:00:00.000Z';
const A_MITAD = '2026-09-15T15:00:00.000Z';

let n = 0;
function turno(employeeId: string, dia: string, extra: Partial<ShiftRow> = {}): ShiftRow {
  n += 1;
  return {
    id: `t${n}`,
    employee_id: employeeId,
    location_id: 'l1',
    job_role_id: null,
    starts_at: `2026-09-${dia}T15:00:00.000Z`, // 10:00 en Lima
    ends_at: `2026-09-${dia}T23:00:00.000Z`,
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

const activo = (id: string, hire_date: string | null = null): EmpleadoDelBono => ({
  id,
  status: 'active',
  hire_date,
});

function calcular(
  turnos: ShiftRow[],
  sesiones: WorkSession[],
  empleados: EmpleadoDelBono[],
  nowISO = TRAS_EL_MES,
  resoluciones: ResolucionDeFalta[] = [],
) {
  return bonoDeAsistencia({
    turnos,
    sesiones,
    empleados,
    desde: DESDE,
    finISO: FIN,
    nowISO,
    relojDesde: DESDE,
    timezone: LIMA,
    resoluciones,
  }).resultados;
}

function resolucion(t: ShiftRow, kind: ResolucionDeFalta['kind']): ResolucionDeFalta {
  return {
    id: t.id,
    organization_id: 'o1',
    location_id: t.location_id,
    employee_id: t.employee_id,
    shift_id: t.id,
    work_date: t.starts_at.slice(0, 10),
    kind,
    reason: kind === 'justified' ? 'medical' : 'no_notice',
    note: null,
    decided_at: null,
  };
}

describe('bono de asistencia', () => {
  it('lo gana quien fichó a tiempo todos sus turnos del mes', () => {
    const turnos = [turno('a', '02'), turno('a', '03'), turno('a', '04')];
    const [r] = calcular(
      turnos,
      turnos.map((t) => sesion(t)),
      [activo('a')],
    );
    expect(r).toMatchObject({ estado: 'gana', turnosContados: 3, cumplidos: 3 });
  });

  it('una falta lo pierde, y dice qué día', () => {
    // Bea sí fichó el 3: la tienda estaba abierta y el reloj en uso. Ana no vino.
    const turnos = [turno('a', '02'), turno('a', '03'), turno('b', '03')];
    const r = calcular(
      turnos,
      [sesion(turnos[0]!), sesion(turnos[2]!)],
      [activo('a'), activo('b')],
    );
    expect(r.find((x) => x.employeeId === 'a')).toMatchObject({
      estado: 'pierde',
      faltas: ['2026-09-03'],
    });
  });

  it('una falta JUSTIFICADA no lo quita: no cuenta ni a favor ni en contra (2-oct)', () => {
    const turnos = [turno('a', '02'), turno('a', '03'), turno('b', '03')];
    const r = calcular(
      turnos,
      [sesion(turnos[0]!), sesion(turnos[2]!)],
      [activo('a'), activo('b')],
      TRAS_EL_MES,
      [resolucion(turnos[1]!, 'justified')],
    );
    expect(r.find((x) => x.employeeId === 'a')).toMatchObject({
      estado: 'gana',
      faltas: [],
      justificadas: ['2026-09-03'],
      turnosContados: 1,
      cumplidos: 1,
    });
  });

  it('una falta SIN JUSTIFICAR lo pierde igual que una sin revisar', () => {
    const turnos = [turno('a', '02'), turno('a', '03'), turno('b', '03')];
    const r = calcular(
      turnos,
      [sesion(turnos[0]!), sesion(turnos[2]!)],
      [activo('a'), activo('b')],
      TRAS_EL_MES,
      [resolucion(turnos[1]!, 'unjustified')],
    );
    expect(r.find((x) => x.employeeId === 'a')).toMatchObject({
      estado: 'pierde',
      faltas: ['2026-09-03'],
      justificadas: [],
    });
  });

  it('una entrada tardía lo pierde, con la misma marca que el resto de la app', () => {
    const turnos = [turno('a', '02'), turno('a', '03')];
    const sesiones = [sesion(turnos[0]!), sesion(turnos[1]!, { flags: ['late_arrival'] })];
    const [r] = calcular(turnos, sesiones, [activo('a')]);
    expect(r).toMatchObject({ estado: 'pierde', tardanzas: ['2026-09-03'], faltas: [] });
  });

  it('con el mes en curso nadie lo ha ganado todavía: va por el bono', () => {
    const turnos = [turno('a', '02'), turno('a', '20')];
    const [r] = calcular(turnos, [sesion(turnos[0]!)], [activo('a')], A_MITAD);
    // El turno del 20 aún no llegó: no cuenta en contra.
    expect(r).toMatchObject({ estado: 'enCamino', turnosContados: 1 });
  });

  it('quien entró después del día 1 no aplica ese mes', () => {
    const turnos = [turno('a', '12')];
    const [r] = calcular(
      turnos,
      turnos.map((t) => sesion(t)),
      [activo('a', '2026-09-10')],
    );
    expect(r).toMatchObject({ estado: 'noAplica', ingreso: '2026-09-10' });
  });

  it('una jornada sin turno asociado cuenta si empieza dentro del turno', () => {
    const t = turno('a', '02');
    const suelta = sesion(t, { shift_id: null, starts_at: '2026-09-02T14:40:00.000Z' });
    const [r] = calcular([t], [suelta], [activo('a')]);
    expect(r?.estado).toBe('gana');
  });

  it('los turnos cancelados o en borrador no cuentan, ni los descansos', () => {
    const turnos = [
      turno('a', '02'),
      turno('a', '03', { status: 'cancelled' }),
      turno('a', '04', { status: 'draft' }),
    ];
    const [r] = calcular(turnos, [sesion(turnos[0]!)], [activo('a')]);
    expect(r).toMatchObject({ estado: 'gana', turnosContados: 1 });
  });

  it('sin turnos en el mes no sale', () => {
    const t = turno('b', '02');
    expect(calcular([t], [sesion(t)], [activo('a')])).toEqual([]);
  });

  /*
   * DADA DE BAJA, PERO TRABAJÓ ESE MES (4-oct): sale en el bono de ese mes. Antes no salía, y
   * dar de baja a alguien el 4-oct la borraba del bono de septiembre.
   */
  it('dada de baja hoy, sale en el mes que trabajó', () => {
    const t = turno('b', '02');
    const [r] = calcular([t], [sesion(t)], [{ id: 'b', status: 'inactive', hire_date: null }]);
    expect(r).toMatchObject({ employeeId: 'b', estado: 'gana', turnosContados: 1 });
  });

  it('un día de ANTES DEL RELOJ no cuenta como falta para nadie', () => {
    // El reloj empezó el 29: el 28 nadie pudo fichar. Ana y Bea fueron el 29.
    const ta28 = turno('a', '28');
    const tb28 = turno('b', '28');
    const ta29 = turno('a', '29');
    const tb29 = turno('b', '29');
    const bono = bonoDeAsistencia({
      turnos: [ta28, tb28, ta29, tb29],
      sesiones: [sesion(ta29), sesion(tb29)],
      empleados: [activo('a'), activo('b')],
      desde: DESDE,
      finISO: FIN,
      nowISO: TRAS_EL_MES,
      timezone: LIMA,
      relojDesde: '2026-09-29',
    });
    expect(bono.diasSinReloj).toEqual(['2026-09-28']);
    expect(bono.resultados.map((r) => [r.employeeId, r.estado, r.turnosContados])).toEqual([
      ['a', 'gana', 1],
      ['b', 'gana', 1],
    ]);
  });

  it('desde el reloj, quien era la única de turno y no vino faltó (1-oct)', () => {
    // Antes «nadie fichó ese día» la libraba: si era la única de turno, nadie fichó porque
    // no vino. Ahora la falta es la de toda la app.
    const ta = turno('a', '02');
    const [ana] = calcular([ta], [], [activo('a')]);
    expect(ana).toMatchObject({ estado: 'pierde', faltas: ['2026-09-02'] });
  });

  it('sin saber desde cuándo hay reloj, no se acusa a nadie de faltar', () => {
    const ta = turno('a', '02');
    const bono = bonoDeAsistencia({
      turnos: [ta],
      sesiones: [],
      empleados: [activo('a')],
      desde: DESDE,
      finISO: FIN,
      nowISO: TRAS_EL_MES,
      timezone: LIMA,
      relojDesde: undefined,
    });
    expect(bono.resultados[0]).toMatchObject({ faltas: [], turnosContados: 0 });
  });

  it('pero si otro sí fichó ese día, quien no vino faltó', () => {
    const ta = turno('a', '02');
    const tb = turno('b', '02');
    const [bea, ana] = calcular([ta, tb], [sesion(tb)], [activo('a'), activo('b')]);
    expect(bea).toMatchObject({ employeeId: 'b', estado: 'gana' });
    expect(ana).toMatchObject({ employeeId: 'a', estado: 'pierde', faltas: ['2026-09-02'] });
  });

  it('primero quien lo gana, después quien lo pierde', () => {
    const ta = turno('a', '02');
    const tb = turno('b', '02');
    const r = calcular([ta, tb], [sesion(tb)], [activo('a'), activo('b')]);
    expect(r.map((x) => [x.employeeId, x.estado])).toEqual([
      ['b', 'gana'],
      ['a', 'pierde'],
    ]);
  });
});

describe('cuándo no aplica (auditoría, 4-oct)', () => {
  it('quien se dio de baja a mitad de mes no lo gana: mes incompleto', () => {
    const t = turno('b', '02');
    const [r] = calcular(
      [t],
      [sesion(t)],
      [{ id: 'b', status: 'inactive', hire_date: null, end_date: '2026-09-10' }],
    );
    expect(r).toMatchObject({
      estado: 'noAplica',
      motivoNoAplica: 'bajaEnElMes',
      baja: '2026-09-10',
    });
  });

  it('quien se fue el último día del mes sí completó el mes', () => {
    const t = turno('b', '02');
    const [r] = calcular(
      [t],
      [sesion(t)],
      [{ id: 'b', status: 'inactive', hire_date: null, end_date: '2026-09-30' }],
    );
    expect(r).toMatchObject({ estado: 'gana' });
  });

  it('sin ningún turno que contar no se gana, aunque no tenga nada en contra', () => {
    // Su único turno fue antes del reloj: no cuenta para nadie.
    const t = turno('a', '02');
    const [r] = bonoDeAsistencia({
      turnos: [t],
      sesiones: [],
      empleados: [activo('a')],
      desde: DESDE,
      finISO: FIN,
      nowISO: TRAS_EL_MES,
      relojDesde: '2026-09-20',
      timezone: LIMA,
    }).resultados;
    expect(r).toMatchObject({ estado: 'noAplica', motivoNoAplica: 'sinTurnos', turnosContados: 0 });
  });
});
