import { feriadoDe } from '@/domain/feriados-peru';
import type { EstadoDeLaFalta } from '@/domain/sueldo-estimado';
import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf, type DateKey } from '@/features/schedules/week';
import type { WorkSession } from '@/features/timesheets/api';
import { estadoDeFalta, faltasDeLosTurnos } from '@/features/timesheets/faltas';
import type { HoraDebida } from '@/features/timesheets/horas-debidas';
import type { HoraExtraAprobada } from '@/features/timesheets/horas-extra';
import type { ResolucionDeFalta } from '@/features/timesheets/justificaciones';

/**
 * LO QUE PASÓ EN EL MES DE UNA PERSONA, con las reglas de siempre (13-oct), para el sueldo
 * aproximado. No decide nada nuevo: la falta es la de `faltas.ts` —la misma de Horario,
 * Horas, Equipo, Reportes y su celular—, la hora extra es la APROBADA, el feriado es el de
 * `feriados-peru.ts` y lo que debe es lo pendiente de «Horas que debe». Por eso lo que dice
 * el sueldo cuadra con lo que dice cada pantalla.
 */
export type HechosDelMes = {
  faltas: { dia: DateKey; estado: EstadoDeLaFalta }[];
  /** Minutos aprobados como extra, por día con extra. */
  extrasPorDia: number[];
  /** Días de feriado en que trabajó. */
  feriadosTrabajados: DateKey[];
  minutosQueDebe: number;
};

export function hechosDelMes(params: {
  employeeId: string;
  mes: { desde: DateKey; hasta: DateKey };
  turnos: readonly ShiftRow[];
  jornadas: readonly WorkSession[];
  resoluciones: readonly ResolucionDeFalta[];
  relojDesde: (locationId: string) => DateKey | null | undefined;
  aprobadas: readonly HoraExtraAprobada[];
  debidas: readonly HoraDebida[];
  timezone: string;
  nowISO: string;
}): HechosDelMes {
  const { employeeId, mes, timezone } = params;
  const delMes = (dia: DateKey) => dia >= mes.desde && dia <= mes.hasta;

  const faltas = faltasDeLosTurnos({
    turnos: params.turnos.filter((turno) => turno.employee_id === employeeId),
    jornadas: params.jornadas,
    relojDesde: params.relojDesde,
    ahoraISO: params.nowISO,
    timezone,
    resoluciones: params.resoluciones,
  })
    .filter((falta) => delMes(falta.dia))
    .map((falta) => ({ dia: falta.dia, estado: estadoDeFalta(falta) }));

  const extrasPorDia = params.aprobadas
    .filter((fila) => fila.employee_id === employeeId && delMes(fila.work_date) && fila.minutes > 0)
    .map((fila) => fila.minutes);

  // Un feriado cuenta si ese día tuvo una jornada suya con horas: vino a trabajar.
  const feriadosTrabajados = [
    ...new Set(
      params.jornadas
        .filter((jornada) => jornada.employee_id === employeeId && (jornada.net_minutes ?? 0) > 0)
        .map((jornada) => dateKeyOf(jornada.starts_at, timezone))
        .filter((dia) => delMes(dia) && feriadoDe(dia, timezone) !== null),
    ),
  ].sort();

  const minutosQueDebe = params.debidas
    .filter(
      (fila) =>
        fila.employee_id === employeeId && fila.status === 'pending' && delMes(fila.work_date),
    )
    .reduce((suma, fila) => suma + Math.max(0, fila.minutes), 0);

  return { faltas, extrasPorDia, feriadosTrabajados, minutosQueDebe };
}
