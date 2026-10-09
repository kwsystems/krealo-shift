import type { WorkSession } from './api';
import type { Puntualidad } from './puntualidad';
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
  | 'unscheduled'
  /** Sin turno publicado, pero con uno en BORRADOR ese día: lo que falta es publicarlo. */
  | 'unpublishedShift'
  | 'needsReview';

/** Una sesión abierta más allá de esta duración es un olvido, no un turno largo. */
export const OPEN_SESSION_ALERT_MINUTES = 16 * 60;
/** Duración neta a partir de la cual conviene revisar el registro. */
export const ABNORMAL_NET_MINUTES = 14 * 60;

/*
 * SIN «DIFERENCIA DE RELOJ» (8-oct). Es un aviso de la tablet, no de las horas: las horas usan
 * siempre la del servidor, y no había nada que decidir. Salía en rojo, contaba en «Necesita
 * revisión» y no se podía quitar; corregir el fichaje incluso lo creaba. Ahora solo se dice,
 * en gris, dentro de la jornada (`session-detail.tsx`).
 */
const FLAG_TO_ALERT: Record<string, TimesheetAlert> = {
  late_arrival: 'lateArrival',
  early_departure: 'earlyDeparture',
  unscheduled: 'unscheduled',
  missing_clock_out: 'missingClockOut',
  overlap: 'overlap',
};

/**
 * Con `puntualidad`, «Llegó tarde» y «Salió antes» siguen la regla del turno y no la marca
 * de cada jornada: ver `puntualidad.ts`. Sin ella, las marcas tal cual —para quien solo
 * tiene una jornada a mano—.
 */
export function alertsForSession(
  session: WorkSession,
  nowISO: string,
  puntualidad?: Puntualidad,
): TimesheetAlert[] {
  const alerts = new Set<TimesheetAlert>();

  for (const flag of session.flags) {
    if (puntualidad !== undefined && (flag === 'late_arrival' || flag === 'early_departure')) {
      continue;
    }
    const mapped = FLAG_TO_ALERT[flag];
    if (mapped !== undefined) alerts.add(mapped);
  }
  // Decidido en Por resolver, ya no se revisa (8-oct): ver `Puntualidad.decidida`.
  if (puntualidad?.tarde === true && !puntualidad.decidida) alerts.add('lateArrival');
  if (puntualidad?.salioAntes === true && !puntualidad.decidida) alerts.add('earlyDeparture');

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

/**
 * «Sin turno» con un turno en borrador ese día se dice como lo que es: turno sin publicar.
 * Ver `timesheets-screen.tsx`.
 */
export function conTurnoSinPublicar(
  alerts: TimesheetAlert[],
  hayBorrador: boolean,
): TimesheetAlert[] {
  if (!hayBorrador || !alerts.includes('unscheduled')) return alerts;
  return alerts.map((alerta) => (alerta === 'unscheduled' ? 'unpublishedShift' : alerta));
}

/**
 * LOS AVISOS QUE SON UN DATO, NO UNA DECISIÓN (8-oct): tarde, salió antes, sin turno, muy
 * larga. Piden revisión —rojo, «Necesita revisión»— solo si ese día tiene un caso abierto en
 * «Por resolver», que es donde se decide; si no, se dicen en gris. Ver `casos-abiertos.ts`.
 */
const AVISOS_DE_REGISTRO: readonly TimesheetAlert[] = [
  'lateArrival',
  'earlyDeparture',
  'unscheduled',
  'abnormalDuration',
];

export function separarAvisos(
  alerts: readonly TimesheetAlert[],
  conCasoAbierto: boolean,
): { porRevisar: TimesheetAlert[]; registro: TimesheetAlert[] } {
  if (conCasoAbierto) return { porRevisar: [...alerts], registro: [] };
  return {
    porRevisar: alerts.filter((alert) => !AVISOS_DE_REGISTRO.includes(alert)),
    registro: alerts.filter((alert) => AVISOS_DE_REGISTRO.includes(alert)),
  };
}
