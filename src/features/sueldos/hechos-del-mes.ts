import { feriadoDe } from '@/domain/feriados-peru';
import type { EstadoDeLaFalta } from '@/domain/sueldo-estimado';
import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf, type DateKey } from '@/features/schedules/week';
import type { WorkSession } from '@/features/timesheets/api';
import { estadoDeFalta, faltasDeLosTurnos, type Falta } from '@/features/timesheets/faltas';
import type { HoraDebida } from '@/features/timesheets/horas-debidas';
import {
  minutosPlanificadosDelTurno,
  type HoraExtraAprobada,
} from '@/features/timesheets/horas-extra';
import type { ResolucionDeFalta } from '@/features/timesheets/justificaciones';
import { splitRegularAndOvertime } from '@/utils/time';

/**
 * LO QUE PASÓ EN EL MES DE UNA PERSONA, con las reglas de siempre (13-oct), para el sueldo
 * aproximado. No decide nada nuevo: la falta es la de `faltas.ts` —la misma de Horario,
 * Horas, Equipo, Reportes y su celular—, la hora extra es la APROBADA, el feriado es el de
 * `feriados-peru.ts` y lo que debe es lo pendiente de «Horas que debe». Por eso lo que dice
 * el sueldo cuadra con lo que dice cada pantalla.
 */
export type HechosDelMes = {
  /** Los DÍAS en que faltó a todos sus turnos: uno por día, aunque fueran dos turnos. */
  faltas: { dia: DateKey; estado: EstadoDeLaFalta }[];
  /** Los turnos a los que no vino en un día en que sí trabajó otro, con lo planificado. */
  turnosSinTrabajar: { dia: DateKey; estado: EstadoDeLaFalta; minutos: number }[];
  /** Minutos de extra que se pagan, por día con extra: lo aprobado, con el tope de Reportes. */
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

  const suyos = params.turnos.filter((turno) => turno.employee_id === employeeId);
  const faltasDeTurno = faltasDeLosTurnos({
    turnos: suyos,
    jornadas: params.jornadas,
    relojDesde: params.relojDesde,
    ahoraISO: params.nowISO,
    timezone,
    resoluciones: params.resoluciones,
  }).filter((falta) => delMes(falta.dia));
  const { faltas, turnosSinTrabajar } = faltasPorDia(faltasDeTurno, suyos, timezone);

  /*
   * LA EXTRA QUE SE PAGA ES LA DE REPORTES (26-oct). Se sumaba lo aprobado tal cual: si
   * después se corregía la jornada de ese día —un fichaje anulado, una salida mal puesta—, la
   * aprobación se quedaba y el sueldo pagaba horas extra de un día sin horas. Reportes, Horas
   * y su CSV ya lo topan con `splitRegularAndOvertime`: nunca más extra que lo trabajado ese
   * día. El sueldo usa ESA función con lo trabajado de cada día, sumado como lo suma el
   * servidor en `daily_time_summary` (todas sus jornadas, por el día local de su entrada), así
   * que la extra del sueldo es la misma cifra que la de Reportes.
   *
   * El tope es lo trabajado, NO lo trabajado por encima de lo planificado: aprobar más de lo
   * que pasó del turno está permitido a propósito (la hoja de la extra deja hasta lo trabajado,
   * y el refrigerio sin marcar se paga así, ver `casos.ts`). Toparlo aquí sobre lo planificado
   * haría que el sueldo dijera otra extra que Reportes; si eso se quiere, se cambia en
   * `splitRegularAndOvertime` para todas las pantallas a la vez.
   */
  const trabajadoPorDia = new Map<DateKey, number>();
  for (const jornada of params.jornadas) {
    if (jornada.employee_id !== employeeId) continue;
    const dia = dateKeyOf(jornada.starts_at, timezone);
    trabajadoPorDia.set(dia, (trabajadoPorDia.get(dia) ?? 0) + (jornada.net_minutes ?? 0));
  }
  const extrasPorDia = params.aprobadas
    .filter((fila) => fila.employee_id === employeeId && delMes(fila.work_date) && fila.minutes > 0)
    .map(
      (fila) =>
        splitRegularAndOvertime(trabajadoPorDia.get(fila.work_date) ?? 0, fila.minutes)
          .overtimeMinutes,
    )
    .filter((minutos) => minutos > 0);

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

  return { faltas, turnosSinTrabajar, extrasPorDia, feriadosTrabajados, minutosQueDebe };
}

const GRAVEDAD: Record<EstadoDeLaFalta, number> = {
  justificada: 0,
  sinRevisar: 1,
  injustificada: 2,
};

/**
 * LA FALTA DEL SUELDO ES POR DÍA, NO POR TURNO (26-oct). `faltas.ts` da una falta por turno,
 * que es lo que Horario y Horas tienen que enseñar —cada turno con su «faltó»—. Pero el sueldo
 * descuenta DÍAS: con un turno partido (10:00–14:00 y 17:00–19:00), faltar al día entero
 * eran dos faltas y descontaba dos días y dos sextos del descanso; y venir a la mañana y no a
 * la tarde descontaba un día entero con su sexto, habiendo trabajado 4 h. Ahora:
 *
 *   · Un día en que faltó a TODOS sus turnos publicados es UNA falta de día. Su estado es el
 *     peor de sus turnos: con uno sin justificar, sin justificar; si no, con uno sin revisar,
 *     sin revisar; justificada solo si lo están todos.
 *   · Un día en que trabajó algún turno y faltó a otro NO es falta de día: se descuentan las
 *     horas planificadas del turno al que no vino (`minutosPlanificadosDelTurno`), con el
 *     estado de ese turno. No se suman a «Horas que debe»: esas son filas por jornada que se
 *     compensan o perdonan en la ficha, y un turno sin jornada nunca tiene una —«Faltan horas»
 *     mide cada jornada contra SU turno (`casos.ts`)—, así que no hay nada que se cuente dos
 *     veces. Va en su propia línea para que «Horas que debe» del sueldo siga diciendo lo mismo
 *     que la lista de la ficha y del celular.
 *
 * Un turno de hoy que todavía no termina no es falta: mientras dure, el día cuenta como
 * trabajado a medias, y al acabar sin marca pasa a ser falta de día. Lo que se ve cambia con
 * el día, como todo el sueldo.
 */
function faltasPorDia(
  faltasDeTurno: readonly Falta[],
  turnos: readonly ShiftRow[],
  timezone: string,
): Pick<HechosDelMes, 'faltas' | 'turnosSinTrabajar'> {
  const turnosDelDia = new Map<DateKey, number>();
  for (const turno of turnos) {
    // Los mismos turnos que mira `faltas.ts`: solo los publicados pueden ser falta.
    if (turno.status !== 'published') continue;
    const dia = dateKeyOf(turno.starts_at, timezone);
    turnosDelDia.set(dia, (turnosDelDia.get(dia) ?? 0) + 1);
  }
  const porDia = new Map<DateKey, Falta[]>();
  for (const falta of faltasDeTurno) {
    porDia.set(falta.dia, [...(porDia.get(falta.dia) ?? []), falta]);
  }

  const faltas: HechosDelMes['faltas'] = [];
  const turnosSinTrabajar: HechosDelMes['turnosSinTrabajar'] = [];
  for (const [dia, delDia] of porDia) {
    if (delDia.length >= (turnosDelDia.get(dia) ?? 0)) {
      const estado = delDia
        .map(estadoDeFalta)
        .reduce((peor, estado) => (GRAVEDAD[estado] > GRAVEDAD[peor] ? estado : peor));
      faltas.push({ dia, estado });
      continue;
    }
    for (const falta of delDia) {
      turnosSinTrabajar.push({
        dia,
        estado: estadoDeFalta(falta),
        minutos: minutosPlanificadosDelTurno(falta.turno),
      });
    }
  }
  return { faltas, turnosSinTrabajar };
}
