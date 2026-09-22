import type { DailySummary, WorkSession } from '@/features/timesheets/api';
import type { BreakReason } from '@/domain/break-reason';
import { BREAK_REASONS } from '@/domain/break-reason';
import { splitRegularAndOvertime } from '@/utils/time';

/**
 * Las cuentas de Reportes. Funciones puras, todas: reciben filas y devuelven filas.
 *
 * POR QUÉ ESTÁ SEPARADO DE LA PANTALLA
 * Porque la promesa de este módulo es comprobable y hay que comprobarla: los números
 * de los gráficos tienen que cuadrar con los que enseña Horas para el mismo periodo.
 * Si no cuadran, uno de los dos miente, y un tablero que miente es peor que no tener
 * tablero —se toman decisiones con él—. Con las cuentas aquí, una prueba las pasa por
 * los mismos datos que `computeTotals` y exige que salga lo mismo.
 *
 * Y POR QUÉ LEE LAS MISMAS FUENTES QUE HORAS
 * No hay una consulta nueva para "reportes". Se leen `daily_time_summary` y
 * `work_sessions`, exactamente las dos que ya lee Horas, y las horas extra se parten
 * con `splitRegularAndOvertime`, la misma función. Cuadrar no es entonces algo que
 * haya que vigilar: es la única cosa que estas funciones pueden hacer.
 */

export type EmployeeHours = {
  employeeId: string;
  netMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  /** Días con actividad. Aclara si 40 horas son cinco jornadas o dos maratones. */
  days: number;
};

/**
 * Horas por persona en el periodo, de más a menos.
 *
 * Las horas extra se parten POR DÍA y no sobre el total de la semana, igual que en
 * Horas: el umbral configurado es diario. Sumar la semana y restar 40 daría otro
 * número —uno que ningún día de la semana justifica— y sería justo el tipo de
 * desacuerdo entre dos pantallas que este módulo tiene prohibido producir.
 */
export function hoursByEmployee(
  summaries: DailySummary[],
  dailyThresholdMinutes: number,
): EmployeeHours[] {
  const porPersona = new Map<string, EmployeeHours>();

  for (const day of summaries) {
    const fila = porPersona.get(day.employee_id) ?? {
      employeeId: day.employee_id,
      netMinutes: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
      days: 0,
    };
    const parte = splitRegularAndOvertime(day.net_minutes, dailyThresholdMinutes);
    fila.netMinutes += day.net_minutes;
    fila.regularMinutes += parte.regularMinutes;
    fila.overtimeMinutes += parte.overtimeMinutes;
    fila.days += 1;
    porPersona.set(day.employee_id, fila);
  }

  return [...porPersona.values()].sort((a, b) => b.netMinutes - a.netMinutes);
}

export type DayTotal = { dateKey: string; netMinutes: number; sessions: number };

/**
 * Minutos por día del periodo. Devuelve TODOS los días pedidos, incluidos los que
 * no tienen ninguna fila: un día sin datos es una columna a cero, y quitarlo de la
 * serie convertiría una semana floja en una semana llena de días buenos.
 */
export function minutesByDay(summaries: DailySummary[], dateKeys: readonly string[]): DayTotal[] {
  const porDia = new Map<string, DayTotal>();
  for (const key of dateKeys) porDia.set(key, { dateKey: key, netMinutes: 0, sessions: 0 });

  for (const day of summaries) {
    const fila = porDia.get(day.work_date);
    if (fila === undefined) continue;
    fila.netMinutes += day.net_minutes;
    fila.sessions += day.sessions;
  }

  return dateKeys.map((key) => porDia.get(key) ?? { dateKey: key, netMinutes: 0, sessions: 0 });
}

export type Punctuality = {
  /** Sesiones que TENÍAN turno programado: las únicas que pueden llegar tarde. */
  measured: number;
  late: number;
  /** Sesiones sin turno programado, que no entran en la cuenta. */
  unscheduled: number;
  /** `null` cuando no hay ni una sesión medible: no es 100%, es que no se sabe. */
  onTimePercent: number | null;
  byEmployee: { employeeId: string; measured: number; late: number }[];
};

/**
 * Puntualidad a partir de las banderas que pone el SERVIDOR, no de una comparación
 * hecha aquí.
 *
 * `late_arrival` la escribe `submit_time_event` comparando el fichaje con el inicio
 * del turno MÁS la tolerancia configurada en la sede. Recalcularlo en el cliente
 * significaría tener dos definiciones de "tarde" —y la del cliente no conoce la
 * tolerancia de cada sede ni el turno al que se asoció el fichaje—, así que se lee
 * la que ya existe.
 *
 * LO QUE NO SE CUENTA, Y ESTO ES LO IMPORTANTE
 * Una sesión sin turno programado (`unscheduled`) no puede llegar tarde: no había
 * hora a la que llegar. Queda FUERA del denominador. Si se metiera dentro como "a
 * tiempo", una tienda que no programa turnos saldría con el 100% de puntualidad
 * para siempre, que es exactamente la cifra tranquilizadora y falsa que hace que un
 * tablero deje de servir. Por eso la pantalla enseña también cuántas quedaron fuera.
 */
export function punctuality(sessions: WorkSession[]): Punctuality {
  const porPersona = new Map<string, { employeeId: string; measured: number; late: number }>();
  let measured = 0;
  let late = 0;
  let unscheduled = 0;

  for (const session of sessions) {
    if (session.flags.includes('unscheduled')) {
      unscheduled += 1;
      continue;
    }
    const tarde = session.flags.includes('late_arrival');
    measured += 1;
    if (tarde) late += 1;

    const fila = porPersona.get(session.employee_id) ?? {
      employeeId: session.employee_id,
      measured: 0,
      late: 0,
    };
    fila.measured += 1;
    if (tarde) fila.late += 1;
    porPersona.set(session.employee_id, fila);
  }

  return {
    measured,
    late,
    unscheduled,
    onTimePercent: measured === 0 ? null : Math.round(((measured - late) / measured) * 100),
    byEmployee: [...porPersona.values()].sort((a, b) => b.late - a.late || b.measured - a.measured),
  };
}

export type BreakNote = { at: string; minutes: number; note: string };

export type BreakRow = {
  employee_id: string;
  break_reason: string;
  minutes: number;
  pauses: number;
  notes?: BreakNote[];
};

export type ReasonTotal = {
  reason: BreakReason;
  minutes: number;
  pauses: number;
  /** Parte del total no trabajado, 0-100. Responde «en qué se va» sin un quesito. */
  sharePercent: number;
  /**
   * Lo que escribió cada persona, con QUIÉN lo escribió y CUÁNDO.
   *
   * Solo lo trae «Otro», que es el único motivo que obliga a poner una explicación. Las
   * demás filas llevan la lista vacía: «Comida» no necesita justificarse.
   *
   * Van de más reciente a más antigua: al abrir la fila lo primero que se quiere ver es
   * lo de hoy, no lo de hace una semana.
   */
  notes: (BreakNote & { employeeId: string })[];
};

/**
 * En qué se va el tiempo que no se trabaja, por motivo y de más a menos.
 *
 * Un motivo desconocido —una fila vieja, un valor que la base gane en el futuro— cae
 * en `other` en vez de descartarse. Perder minutos por no reconocer una etiqueta
 * haría que la suma de los motivos no llegue al total de pausas, y entonces el
 * gráfico y el total se contradicen sin que nada avise.
 */
export function minutesByReason(rows: BreakRow[]): ReasonTotal[] {
  const porMotivo = new Map<BreakReason, ReasonTotal>();
  for (const reason of BREAK_REASONS) {
    porMotivo.set(reason, { reason, minutes: 0, pauses: 0, sharePercent: 0, notes: [] });
  }

  for (const row of rows) {
    const reason = (BREAK_REASONS as readonly string[]).includes(row.break_reason)
      ? (row.break_reason as BreakReason)
      : 'other';
    const fila = porMotivo.get(reason);
    if (fila === undefined) continue;
    fila.minutes += row.minutes;
    fila.pauses += row.pauses;
    for (const nota of row.notes ?? []) {
      // Una nota en blanco no es una nota: ocuparía una línea para no decir nada.
      if (nota.note.trim() === '') continue;
      fila.notes.push({ ...nota, employeeId: row.employee_id });
    }
  }

  for (const fila of porMotivo.values()) {
    fila.notes.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  const total = [...porMotivo.values()].reduce((suma, fila) => suma + fila.minutes, 0);

  return [...porMotivo.values()]
    .filter((fila) => fila.minutes > 0 || fila.pauses > 0)
    .map((fila) => ({
      ...fila,
      sharePercent: total > 0 ? Math.round((fila.minutes / total) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}
