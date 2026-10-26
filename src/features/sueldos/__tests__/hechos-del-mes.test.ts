import { sueldoEstimado } from '@/domain/sueldo-estimado';
import { hoursByEmployee } from '@/features/reports/aggregate';
import type { ShiftRow } from '@/features/schedules/api';
import type { DailySummary, WorkSession } from '@/features/timesheets/api';
import { aprobadasPorDia, type HoraExtraAprobada } from '@/features/timesheets/horas-extra';
import type { ResolucionDeFalta } from '@/features/timesheets/justificaciones';

import { hechosDelMes } from '../hechos-del-mes';

/**
 * Los hechos del mes que pasan al sueldo (26-oct): la falta del sueldo es por DÍA, aunque el
 * día tenga turno partido, y la extra que se paga es la misma que cuenta Reportes.
 *
 * Sueldo de S/ 1,230: el día vale 41, la falta con su sexto de descanso 47.83 y la hora
 * 5.125. El lunes 5 de octubre tiene turno partido: 10:00–14:00 y 17:00–19:00 en Lima.
 */

const LIMA = 'America/Lima';
const OCTUBRE = { desde: '2026-10-01', hasta: '2026-10-31' };
const LUEGO = '2026-10-20T15:00:00.000Z';

function turno(id: string, desde: string, hasta: string): ShiftRow {
  return {
    id,
    employee_id: 'vendedora',
    location_id: 'sede',
    job_role_id: null,
    starts_at: desde,
    ends_at: hasta,
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

const MANANA = turno('manana', '2026-10-05T15:00:00.000Z', '2026-10-05T19:00:00.000Z');
const TARDE = turno('tarde', '2026-10-05T22:00:00.000Z', '2026-10-06T00:00:00.000Z');

function jornada(extra: Partial<WorkSession>): WorkSession {
  return {
    id: 'j1',
    employee_id: 'vendedora',
    location_id: 'sede',
    shift_id: null,
    starts_at: '2026-10-05T15:00:00.000Z',
    ends_at: '2026-10-05T19:00:00.000Z',
    gross_minutes: 240,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_minutes: 240,
    status: 'closed',
    flags: [],
    ...extra,
  } as WorkSession;
}

function resolucion(shiftId: string, kind: 'justified' | 'unjustified'): ResolucionDeFalta {
  return {
    id: `r-${shiftId}`,
    organization_id: 'org',
    location_id: 'sede',
    employee_id: 'vendedora',
    shift_id: shiftId,
    work_date: '2026-10-05',
    kind,
    reason: kind === 'justified' ? 'medical' : 'no_notice',
    note: null,
    decided_at: null,
  };
}

function extra(workDate: string, minutes: number): HoraExtraAprobada {
  return {
    id: `x-${workDate}`,
    employee_id: 'vendedora',
    location_id: 'sede',
    work_date: workDate,
    minutes,
    approved_by: null,
    updated_at: null,
  };
}

function hechos(
  params: {
    turnos?: ShiftRow[];
    jornadas?: WorkSession[];
    resoluciones?: ResolucionDeFalta[];
    aprobadas?: HoraExtraAprobada[];
  } = {},
) {
  return hechosDelMes({
    employeeId: 'vendedora',
    mes: OCTUBRE,
    turnos: params.turnos ?? [MANANA, TARDE],
    jornadas: params.jornadas ?? [],
    resoluciones: params.resoluciones ?? [],
    relojDesde: () => '2026-09-01',
    aprobadas: params.aprobadas ?? [],
    debidas: [],
    timezone: LIMA,
    nowISO: LUEGO,
  });
}

function sueldoDe(h: ReturnType<typeof hechos>) {
  return sueldoEstimado({
    datos: { sueldoMensual: 1230, asignacionFamiliar: false, pension: null },
    mes: OCTUBRE,
    faltas: h.faltas,
    turnosSinTrabajar: h.turnosSinTrabajar,
    extrasPorDia: h.extrasPorDia,
    feriadosTrabajados: h.feriadosTrabajados.length,
    minutosQueDebe: h.minutosQueDebe,
  });
}

describe('la falta del sueldo es por día, con turno partido', () => {
  it('faltar a los dos turnos del día es UNA falta: S/ 47.83, no S/ 95.67', () => {
    const h = hechos();
    expect(h.faltas).toEqual([{ dia: '2026-10-05', estado: 'sinRevisar' }]);
    expect(h.turnosSinTrabajar).toEqual([]);
    const cuenta = sueldoDe(h);
    expect(cuenta.faltasSinRevisar).toEqual({ dias: 1, monto: 47.83 });
    expect(cuenta.bruto).toBe(1182.17);
  });

  it('el día toma el peor estado de sus turnos', () => {
    const estado = (kinds: ('justified' | 'unjustified' | null)[]) =>
      hechos({
        resoluciones: kinds.flatMap((kind, i) =>
          kind === null ? [] : [resolucion(i === 0 ? 'manana' : 'tarde', kind)],
        ),
      }).faltas.map((f) => f.estado);
    expect(estado(['justified', 'unjustified'])).toEqual(['injustificada']);
    expect(estado(['justified', null])).toEqual(['sinRevisar']);
    expect(estado(['unjustified', null])).toEqual(['injustificada']);
    expect(estado(['justified', 'justified'])).toEqual(['justificada']);
  });

  it('vino a la mañana y faltó a la tarde: no es falta de día, se descuentan las 2 h', () => {
    const h = hechos({ jornadas: [jornada({ shift_id: 'manana' })] });
    expect(h.faltas).toEqual([]);
    expect(h.turnosSinTrabajar).toEqual([
      { dia: '2026-10-05', estado: 'sinRevisar', minutos: 120 },
    ]);
    const cuenta = sueldoDe(h);
    expect(cuenta.faltas.dias + cuenta.faltasSinRevisar.dias).toBe(0);
    // 2 h × 5.125: ni el día ni su sexto.
    expect(cuenta.turnosSinTrabajar).toEqual({
      turnos: 1,
      minutos: 120,
      monto: 10.25,
      sinRevisar: 1,
      justificados: 0,
    });
    expect(cuenta.bruto).toBe(1219.75);
  });

  it('la tarde justificada no descuenta nada', () => {
    const h = hechos({
      jornadas: [jornada({ shift_id: 'manana' })],
      resoluciones: [resolucion('tarde', 'justified')],
    });
    const cuenta = sueldoDe(h);
    expect(cuenta.turnosSinTrabajar).toMatchObject({ turnos: 0, monto: 0 });
    expect(cuenta.bruto).toBe(1230);
  });

  it('un día de un solo turno sigue siendo una falta de día', () => {
    expect(hechos({ turnos: [MANANA] }).faltas).toEqual([
      { dia: '2026-10-05', estado: 'sinRevisar' },
    ]);
  });
});

describe('la extra que se paga es la de Reportes', () => {
  it('120 min aprobados de un día que se quedó sin horas: no se paga extra', () => {
    const h = hechos({ turnos: [], aprobadas: [extra('2026-10-05', 120)] });
    expect(h.extrasPorDia).toEqual([]);
    expect(sueldoDe(h).horasExtra).toEqual({ minutos: 0, monto: 0 });
  });

  it('nunca más que lo trabajado ese día; dentro de eso, lo aprobado', () => {
    const corto = jornada({ net_minutes: 45, gross_minutes: 45 });
    expect(
      hechos({ turnos: [], jornadas: [corto], aprobadas: [extra('2026-10-05', 120)] }),
    ).toMatchObject({ extrasPorDia: [45] });
    expect(
      hechos({ turnos: [], jornadas: [jornada({})], aprobadas: [extra('2026-10-05', 60)] }),
    ).toMatchObject({ extrasPorDia: [60] });
  });

  it('suma todas las jornadas del día, y cuadra con lo que dice Reportes', () => {
    const jornadas = [
      jornada({ id: 'a', net_minutes: 30 }),
      jornada({
        id: 'b',
        starts_at: '2026-10-05T22:00:00.000Z',
        ends_at: '2026-10-05T22:50:00.000Z',
        net_minutes: 50,
      }),
    ];
    const aprobadas = [extra('2026-10-05', 120)];
    const h = hechos({ turnos: [], jornadas, aprobadas });
    expect(h.extrasPorDia).toEqual([80]);

    const resumen = {
      employee_id: 'vendedora',
      location_id: 'sede',
      work_date: '2026-10-05',
      sessions: 2,
      gross_minutes: 80,
      paid_break_minutes: 0,
      unpaid_break_minutes: 0,
      net_minutes: 80,
      needs_review: false,
      flags: [],
    } as DailySummary;
    const [enReportes] = hoursByEmployee([resumen], aprobadasPorDia(aprobadas));
    expect(enReportes?.overtimeMinutes).toBe(h.extrasPorDia[0]);
  });
});
