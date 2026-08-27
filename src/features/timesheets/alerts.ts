import type { WorkSession } from './api';
import { minutesBetween } from '@/utils/time';

/**
 * Alertas de la hoja de tiempo (§11.4).
 *
 * Parte vienen marcadas por el servidor en `work_sessions.flags` y parte se
 * derivan del estado de la sesión. Se calculan aquí, en una función pura, para
 * poder probarlas: una alerta que no se dispara es una hora mal pagada.
 */

export type TimesheetAlert =
  | 'missingClockOut'
  | 'overlap'
  | 'abnormalDuration'
  | 'lateArrival'
  | 'earlyDeparture'
  | 'clockDrift'
  | 'unscheduled'
  | 'needsReview';

/** Una sesión abierta más allá de esta duración es un olvido, no un turno largo. */
export const OPEN_SESSION_ALERT_MINUTES = 16 * 60;
/** Duración neta a partir de la cual conviene revisar el registro. */
export const ABNORMAL_NET_MINUTES = 14 * 60;

const FLAG_TO_ALERT: Record<string, TimesheetAlert> = {
  late_arrival: 'lateArrival',
  early_departure: 'earlyDeparture',
  clock_drift: 'clockDrift',
  unscheduled: 'unscheduled',
  missing_clock_out: 'missingClockOut',
  overlap: 'overlap',
};

export function alertsForSession(session: WorkSession, nowISO: string): TimesheetAlert[] {
  const alerts = new Set<TimesheetAlert>();

  for (const flag of session.flags) {
    const mapped = FLAG_TO_ALERT[flag];
    if (mapped !== undefined) alerts.add(mapped);
  }

  if (session.status === 'needs_review') alerts.add('needsReview');

  if (
    session.ends_at === null &&
    minutesBetween(session.starts_at, nowISO) > OPEN_SESSION_ALERT_MINUTES
  ) {
    alerts.add('missingClockOut');
  }

  if ((session.net_minutes ?? 0) > ABNORMAL_NET_MINUTES) alerts.add('abnormalDuration');

  return [...alerts];
}

/**
 * Solapamientos entre sesiones del mismo empleado. El servidor no puede marcarlo
 * en la fila individual porque depende de las vecinas.
 */
export function overlappingSessionIds(sessions: WorkSession[]): Set<string> {
  const overlapping = new Set<string>();

  const byEmployee = new Map<string, WorkSession[]>();
  for (const session of sessions) {
    const current = byEmployee.get(session.employee_id) ?? [];
    current.push(session);
    byEmployee.set(session.employee_id, current);
  }

  for (const list of byEmployee.values()) {
    const sorted = [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous === undefined || current === undefined) continue;
      const previousEnd = previous.ends_at;
      if (previousEnd === null) {
        // Una sesión abierta seguida de otra sesión es, con seguridad, un
        // solapamiento: nadie puede estar trabajando dos veces a la vez.
        overlapping.add(previous.id);
        overlapping.add(current.id);
        continue;
      }
      if (current.starts_at < previousEnd) {
        overlapping.add(previous.id);
        overlapping.add(current.id);
      }
    }
  }

  return overlapping;
}
