import { minutesBetween } from '@/utils/time';

/**
 * Detección de conflictos del editor de horarios (§11.3).
 *
 * Son advertencias, no bloqueos: el administrador puede tener una razón para
 * programar dos turnos seguidos. Lo que no puede es publicar sin verlos. El
 * solapamiento de turnos publicados además está protegido por un trigger en la
 * base, porque dos personas editando la misma semana pueden crear uno que
 * ninguna pantalla vio.
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
    totals.set(shift.employeeId, (totals.get(shift.employeeId) ?? 0) + shiftScheduledMinutes(shift));
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

/** Advierte cuando entre dos turnos consecutivos queda menos descanso del mínimo. */
export function detectShortRest(
  shifts: ScheduledShift[],
  minimumRestMinutes: number,
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
};

/** Todas las advertencias de la semana, en el orden en que importan. */
export function collectScheduleWarnings(
  shifts: ScheduledShift[],
  rules: ScheduleRules,
): ScheduleWarning[] {
  return [
    ...detectOverlaps(shifts),
    ...detectShortRest(shifts, rules.minimumRestMinutes),
    ...detectWeeklyExcess(shifts, rules.weeklyLimitMinutes),
  ];
}

/** Advertencias que afectan a un turno concreto, para marcarlo en la cuadrícula. */
export function warningsForShift(warnings: ScheduleWarning[], shiftId: string): ScheduleWarning[] {
  return warnings.filter(
    (warning) => warning.kind !== 'weeklyExcess' && warning.shiftIds.includes(shiftId),
  );
}
