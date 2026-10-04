import { minutesBetween } from '@/utils/time';

import { dateKeyOf } from './week';

/**
 * Detección de conflictos del editor de horarios (§11.3).
 *
 * Son advertencias, no bloqueos: el administrador puede tener una razón para
 * programar dos turnos seguidos. Lo que no puede es publicar sin verlos.
 *
 * LA BASE NO IMPIDE DOS TURNOS ENCIMA (corregido el 4-oct). Aquí se decía que un trigger
 * lo protegía; eso era de la base anterior, y en Firestore no hay nada parecido: copiar la
 * semana dos veces creaba cada turno dos veces y «Publicar» los publicaba. Lo que crea
 * turnos en lote —pegar y copiar— se protege con `pisaAOtro`, abajo.
 */

export type ShiftStatus = 'draft' | 'published' | 'cancelled';

export type ScheduledShift = {
  id: string;
  employeeId: string;
  employeeName: string;
  startsAt: string;
  endsAt: string;
  plannedUnpaidBreakMinutes: number;
  status: ShiftStatus;
};

export type ScheduleWarning =
  | {
      kind: 'overlap';
      employeeId: string;
      employeeName: string;
      shiftIds: [string, string];
    }
  | {
      kind: 'shortRest';
      employeeId: string;
      employeeName: string;
      shiftIds: [string, string];
      restMinutes: number;
    }
  | {
      kind: 'weeklyExcess';
      employeeId: string;
      employeeName: string;
      minutes: number;
      limitMinutes: number;
    };

/** Un turno cancelado no cuenta para horas ni para conflictos. */
function isCountable(shift: ScheduledShift): boolean {
  return shift.status !== 'cancelled';
}

/**
 * Minutos programados de un turno: duración menos el descanso no pagado
 * planificado, igual que el cálculo real de horas trabajadas (§13).
 */
export function shiftScheduledMinutes(shift: ScheduledShift): number {
  const gross = minutesBetween(shift.startsAt, shift.endsAt);
  return Math.max(0, gross - Math.max(0, shift.plannedUnpaidBreakMinutes));
}

function byStart(a: ScheduledShift, b: ScheduledShift): number {
  return a.startsAt.localeCompare(b.startsAt);
}

export function groupByEmployee(shifts: ScheduledShift[]): Map<string, ScheduledShift[]> {
  const grouped = new Map<string, ScheduledShift[]>();
  for (const shift of shifts) {
    if (!isCountable(shift)) continue;
    const current = grouped.get(shift.employeeId);
    if (current === undefined) grouped.set(shift.employeeId, [shift]);
    else current.push(shift);
  }
  for (const list of grouped.values()) list.sort(byStart);
  return grouped;
}

/** Total programado por empleado en el conjunto recibido, en minutos. */
export function scheduledMinutesByEmployee(shifts: ScheduledShift[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const shift of shifts) {
    if (!isCountable(shift)) continue;
    totals.set(
      shift.employeeId,
      (totals.get(shift.employeeId) ?? 0) + shiftScheduledMinutes(shift),
    );
  }
  return totals;
}

function overlaps(a: ScheduledShift, b: ScheduledShift): boolean {
  // Tocarse no es solaparse: un turno que termina 14:00 y otro que empieza 14:00
  // es un relevo normal.
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export function detectOverlaps(shifts: ScheduledShift[]): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];

  for (const list of groupByEmployee(shifts).values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const first = list[i];
        const second = list[j];
        if (first === undefined || second === undefined) continue;
        if (!overlaps(first, second)) continue;
        warnings.push({
          kind: 'overlap',
          employeeId: first.employeeId,
          employeeName: first.employeeName,
          shiftIds: [first.id, second.id],
        });
      }
    }
  }

  return warnings;
}

/** Ninguna jornada de tienda dura más que esto, con su pausa: lo mismo que «Salida dudosa». */
export const JORNADA_MAXIMA_MINUTOS = 16 * 60;

/**
 * Dos turnos de UNA jornada: empiezan el mismo día de la sede y, de la primera entrada a la
 * última salida, caben en una jornada. 10:00–13:30 y 17:30–22:00 lo son; 09:00–17:00 y
 * 23:00–07:00 no, aunque empiecen el mismo día: son dos jornadas con seis horas entre medio.
 */
function esTurnoPartido(antes: ScheduledShift, despues: ScheduledShift, timezone: string): boolean {
  return (
    dateKeyOf(antes.startsAt, timezone) === dateKeyOf(despues.startsAt, timezone) &&
    minutesBetween(antes.startsAt, despues.endsAt) <= JORNADA_MAXIMA_MINUTOS
  );
}

/**
 * Advierte cuando entre dos turnos consecutivos queda menos descanso del mínimo.
 *
 * EL DESCANSO ES ENTRE JORNADAS, NO DENTRO DE UNA (4-oct). Dos turnos que empiezan el mismo
 * día de la sede son un turno partido —10:00–13:30 y 17:30–22:00—, y las cuatro horas del
 * medio son su pausa, no su descanso entre un día y otro. Se marcaban «Poco descanso» y el
 * horario de la semana enseñaba «Descanso insuficiente entre turnos: 04:00» por un turno que
 * está bien; lo vio Andree al pegar la semana. Entre días distintos se sigue avisando igual,
 * también si el de la noche cruza la medianoche.
 */
export function detectShortRest(
  shifts: ScheduledShift[],
  minimumRestMinutes: number,
  timezone: string,
): ScheduleWarning[] {
  if (minimumRestMinutes <= 0) return [];
  const warnings: ScheduleWarning[] = [];

  for (const list of groupByEmployee(shifts).values()) {
    for (let i = 1; i < list.length; i += 1) {
      const previous = list[i - 1];
      const next = list[i];
      if (previous === undefined || next === undefined) continue;
      if (overlaps(previous, next)) continue;
      if (next.startsAt < previous.endsAt) continue;
      if (esTurnoPartido(previous, next, timezone)) continue;

      const restMinutes = minutesBetween(previous.endsAt, next.startsAt);
      if (restMinutes >= minimumRestMinutes) continue;

      warnings.push({
        kind: 'shortRest',
        employeeId: next.employeeId,
        employeeName: next.employeeName,
        shiftIds: [previous.id, next.id],
        restMinutes,
      });
    }
  }

  return warnings;
}

/** Advierte cuando el total semanal programado supera el límite configurado. */
export function detectWeeklyExcess(
  shifts: ScheduledShift[],
  weeklyLimitMinutes: number,
): ScheduleWarning[] {
  if (weeklyLimitMinutes <= 0) return [];

  const names = new Map<string, string>();
  for (const shift of shifts) names.set(shift.employeeId, shift.employeeName);

  const warnings: ScheduleWarning[] = [];
  for (const [employeeId, minutes] of scheduledMinutesByEmployee(shifts)) {
    if (minutes <= weeklyLimitMinutes) continue;
    warnings.push({
      kind: 'weeklyExcess',
      employeeId,
      employeeName: names.get(employeeId) ?? '',
      minutes,
      limitMinutes: weeklyLimitMinutes,
    });
  }
  return warnings;
}

export type ScheduleRules = {
  minimumRestMinutes: number;
  weeklyLimitMinutes: number;
  /** La zona de la sede: decide qué turnos son del mismo día. */
  timezone: string;
};

/** Todas las advertencias de la semana, en el orden en que importan. */
export function collectScheduleWarnings(
  shifts: ScheduledShift[],
  rules: ScheduleRules,
): ScheduleWarning[] {
  return [
    ...detectOverlaps(shifts),
    ...detectShortRest(shifts, rules.minimumRestMinutes, rules.timezone),
    ...detectWeeklyExcess(shifts, rules.weeklyLimitMinutes),
  ];
}

/** Advertencias que afectan a un turno concreto, para marcarlo en la cuadrícula. */
export function warningsForShift(warnings: ScheduleWarning[], shiftId: string): ScheduleWarning[] {
  return warnings.filter(
    (warning) => warning.kind !== 'weeklyExcess' && warning.shiftIds.includes(shiftId),
  );
}

export type TurnoEnElTiempo = { employeeId: string; startsAt: string; endsAt: string };

/**
 * ¿Se pisa este turno con alguno que esa persona ya tiene? Lo usan pegar el horario y
 * copiar la semana anterior —las dos formas de crear muchos turnos de una vez—, con el
 * MISMO criterio: un relevo (uno acaba cuando el otro empieza) no se pisa.
 */
export function pisaAOtro(turno: TurnoEnElTiempo, existentes: readonly TurnoEnElTiempo[]): boolean {
  const desde = Date.parse(turno.startsAt);
  const hasta = Date.parse(turno.endsAt);
  return existentes.some(
    (otro) =>
      otro.employeeId === turno.employeeId &&
      Date.parse(otro.startsAt) < hasta &&
      Date.parse(otro.endsAt) > desde,
  );
}
