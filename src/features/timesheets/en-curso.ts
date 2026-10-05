import { alertsForSession, type TimesheetAlert } from './alerts';
import type { WorkSession } from './api';
import { minutesBetween } from '@/utils/time';

/**
 * UNA JORNADA ABIERTA NO ES UNA JORNADA ROTA.
 *
 * En Horas, una sesión sin salida se pintaba igual pasara lo que pasara: «09:55 – Sin
 * salida» y «00:00». Y eso decía dos cosas falsas a la vez sobre alguien que estaba
 * trabajando en ese momento: «sin salida» suena a «se olvidó de marcar», y «00:00» a «no
 * ha trabajado nada». Lo vio Andree la primera mañana, con la primera persona del turno
 * dentro de la tienda.
 *
 * Son tres situaciones distintas y la fila tiene que distinguirlas:
 *
 *   - TRABAJANDO: entró hace un rato y sigue dentro. Es lo normal a mitad de turno.
 *   - EN DESCANSO: igual, pero ahora mismo está en su refrigerio.
 *   - SIN SALIDA: la sesión lleva abierta más de lo que dura cualquier turno
 *     (`OPEN_SESSION_ALERT_MINUTES`, 16 h). Eso SÍ es un olvido, y es lo único de las
 *     tres que hay que atender.
 *
 * La regla de «cuándo es un olvido» ya existía (`alertsForSession`) y se usa tal cual: dos
 * definiciones de «sesión olvidada» acabarían discrepando sobre la misma fila.
 */

export type EnCurso = {
  estado: 'trabajando' | 'descanso';
  /** Si está en descanso, desde cuándo. `null` si está trabajando. */
  descansoDesde: string | null;
  /** El motivo de la pausa abierta (`meal`, `errand`…). `null` si trabaja o no lo dijo. */
  motivo?: string | null;
};

/**
 * CÓMO SE DICE EL ESTADO DE ALGUIEN DENTRO: «Trabajando», «Almorzando» o «En descanso».
 *
 * «Almorzando» cuando su pausa abierta es la comida. Lo pidió Andree el 29-sep: en la
 * tienda importa saber quién está comiendo, y «En descanso» no lo decía. Vive aquí, una
 * vez, porque lo dicen Horas, Equipo y Horario: tres copias acabarían llamando distinto a
 * la misma persona en el mismo minuto.
 */
export type EstadoVisible = 'trabajando' | 'almorzando' | 'descanso';

export function estadoVisible(
  estado: 'trabajando' | 'descanso',
  motivo: string | null | undefined,
): EstadoVisible {
  if (estado === 'trabajando') return 'trabajando';
  return motivo === 'meal' ? 'almorzando' : 'descanso';
}

export const CLAVE_DE_ESTADO: Readonly<Record<EstadoVisible, string>> = {
  trabajando: 'timesheet.stateWorking',
  almorzando: 'timesheet.stateAtMeal',
  descanso: 'timesheet.stateOnBreak',
};

export const ICONO_DE_ESTADO: Readonly<
  Record<EstadoVisible, 'radio-button-on' | 'restaurant-outline' | 'cafe-outline'>
> = {
  trabajando: 'radio-button-on',
  almorzando: 'restaurant-outline',
  descanso: 'cafe-outline',
};

export type EstadoDeFila = 'cerrada' | 'trabajando' | 'descanso' | 'sinSalida';

export function estadoDeFila(
  session: WorkSession,
  alerts: TimesheetAlert[],
  enCurso: EnCurso | undefined,
): EstadoDeFila {
  if (session.ends_at !== null) return 'cerrada';
  if (alerts.includes('missingClockOut')) return 'sinSalida';
  /*
   * SIN DATO DE «AHORA MISMO», TRABAJANDO. La consulta de quién está dentro llega un poco
   * después que las sesiones; si mientras tanto se pintara «sin salida», la fila parpadearía
   * a rojo en cada carga. Una sesión abierta y reciente es, casi siempre, alguien
   * trabajando: el descanso se corrige solo en cuanto llega el dato.
   */
  return enCurso?.estado === 'descanso' ? 'descanso' : 'trabajando';
}

/**
 * Minutos trabajados HASTA AHORA de una sesión abierta.
 *
 * Duración desde la entrada menos los descansos no pagados ya cerrados. Si está en
 * descanso ahora, el reloj se para en el inicio del descanso: esos minutos no se trabajan.
 *
 * ES UNA CIFRA EN CURSO Y SE DICE: el número definitivo lo calcula el servidor al cerrar la
 * sesión, con el tipo real de cada pausa. Aquí se asume que el descanso abierto es no
 * pagado —el refrigerio, que es el caso de la tienda—; si fuera pagado, esto se queda corto
 * durante esos minutos y se corrige solo al volver.
 */
export function minutosEnCurso(
  session: WorkSession,
  enCurso: EnCurso | undefined,
  nowISO: string,
): number {
  const hasta =
    enCurso?.estado === 'descanso' && enCurso.descansoDesde !== null
      ? enCurso.descansoDesde
      : nowISO;
  return Math.max(0, minutesBetween(session.starts_at, hasta) - session.unpaid_break_minutes);
}

/**
 * LAS HORAS QUE ENSEÑA UNA JORNADA, en la fila de Horas y en su detalle (auditoría, 4-oct).
 *
 * La fila decía «03:05 en curso» y el detalle de la misma jornada «Horas netas 00:00»: el
 * detalle leía `net_minutes`, que vale cero hasta que la jornada se cierra. Una cifra que
 * se dice en dos sitios sale de aquí: en vivo si sigue dentro, `null` —una raya— si es una
 * salida olvidada, cuyas horas nadie sabe, y la del servidor si ya cerró.
 */
export function minutosVisibles(
  session: WorkSession,
  alerts: TimesheetAlert[],
  enCurso: EnCurso | undefined,
  nowISO: string,
): { minutos: number | null; enVivo: boolean } {
  const estado = estadoDeFila(session, alerts, enCurso);
  if (estado === 'trabajando' || estado === 'descanso') {
    return { minutos: minutosEnCurso(session, enCurso, nowISO), enVivo: true };
  }
  if (estado === 'sinSalida') return { minutos: null, enVivo: false };
  return { minutos: session.net_minutes ?? 0, enVivo: false };
}

function estaDentro(
  session: WorkSession,
  alertsBySession: Map<string, TimesheetAlert[]>,
  enCursoPorSesion: Map<string, EnCurso>,
): boolean {
  const estado = estadoDeFila(
    session,
    alertsBySession.get(session.id) ?? [],
    enCursoPorSesion.get(session.id),
  );
  return estado === 'trabajando' || estado === 'descanso';
}

/**
 * QUIEN ESTÁ DENTRO, ARRIBA. La lista va por hora de entrada, así que la jornada de hoy
 * —la única que sigue corriendo— caía la última: un sábado, debajo de treinta filas
 * cerradas, justo lo que se viene a mirar a media mañana. El resto conserva su orden.
 */
export function dentroPrimero(
  sessions: WorkSession[],
  alertsBySession: Map<string, TimesheetAlert[]>,
  enCursoPorSesion: Map<string, EnCurso>,
): WorkSession[] {
  const dentro: WorkSession[] = [];
  const resto: WorkSession[] = [];
  for (const session of sessions) {
    (estaDentro(session, alertsBySession, enCursoPorSesion) ? dentro : resto).push(session);
  }
  return [...dentro, ...resto];
}

/**
 * Cuánta gente está dentro de `sessions` y cuánto llevan trabajado entre todos.
 *
 * Una salida olvidada NO cuenta: no es alguien dentro, y sus horas no se saben.
 */
export function totalEnCurso(
  sessions: WorkSession[],
  alertsBySession: Map<string, TimesheetAlert[]>,
  enCursoPorSesion: Map<string, EnCurso>,
  nowISO: string,
): { personas: number; minutos: number } {
  let personas = 0;
  let minutos = 0;
  for (const session of sessions) {
    if (!estaDentro(session, alertsBySession, enCursoPorSesion)) continue;
    personas += 1;
    minutos += minutosEnCurso(session, enCursoPorSesion.get(session.id), nowISO);
  }
  return { personas, minutos };
}

/** Lo que hace falta de una fila de «quién está dentro» (`employees_working_now`). */
export type FilaDentro = {
  work_session_id: string;
  attendance_state: string;
  break_started_at: string | null;
  break_reason?: string | null;
};

/**
 * De las filas de «quién está dentro» al estado de cada sesión abierta.
 *
 * Vive aquí, y no copiada en cada pantalla, porque Horas y Equipo la necesitan igual: dos
 * copias de «qué es estar en descanso» acabarían discrepando sobre la misma persona.
 */
export function enCursoPorSesionDe(filas: readonly FilaDentro[] | undefined): Map<string, EnCurso> {
  const map = new Map<string, EnCurso>();
  for (const fila of filas ?? []) {
    map.set(fila.work_session_id, {
      estado: fila.attendance_state === 'ON_BREAK' ? 'descanso' : 'trabajando',
      descansoDesde: fila.break_started_at,
      motivo: fila.break_reason ?? null,
    });
  }
  return map;
}

export type DentroDeLaPersona = {
  estado: 'trabajando' | 'descanso';
  /** El motivo de la pausa abierta: ver `estadoVisible`. */
  motivo: string | null;
  /** Cuándo entró. */
  desde: string;
  /** Si está en una pausa, desde cuándo; `null` si trabaja o no se sabe. */
  descansoDesde: string | null;
  /** Lo que lleva trabajado en la jornada abierta, con la misma cuenta que Horas. */
  minutos: number;
};

/**
 * Quién está dentro ahora, por persona, y cuánto lleva.
 *
 * Es la MISMA cuenta que las filas de Horas —`estadoDeFila` y `minutosEnCurso`—, así que
 * Equipo y Horas no pueden dar dos números distintos de la misma jornada. Una salida
 * olvidada no está aquí: no es alguien dentro, y sus horas no se saben.
 */
export function dentroPorEmpleado(
  sessions: readonly WorkSession[],
  enCursoPorSesion: Map<string, EnCurso>,
  nowISO: string,
): Map<string, DentroDeLaPersona> {
  const map = new Map<string, DentroDeLaPersona>();
  for (const session of sessions) {
    if (session.ends_at !== null) continue;
    const enCurso = enCursoPorSesion.get(session.id);
    const estado = estadoDeFila(session, alertsForSession(session, nowISO), enCurso);
    if (estado !== 'trabajando' && estado !== 'descanso') continue;
    map.set(session.employee_id, {
      estado,
      motivo: enCurso?.motivo ?? null,
      desde: session.starts_at,
      descansoDesde: estado === 'descanso' ? (enCurso?.descansoDesde ?? null) : null,
      minutos: minutosEnCurso(session, enCurso, nowISO),
    });
  }
  return map;
}

/**
 * LO QUE LLEVA TODA LA GENTE QUE ESTÁ DENTRO AHORA, sumado (5-oct): la parte «en curso» del
 * total en vivo de Reportes y de Inicio. La misma cuenta que «Dentro ahora» de Horas.
 */
export function dentroAhoraEnTotal(
  sessions: readonly WorkSession[],
  enCursoPorSesion: Map<string, EnCurso>,
  nowISO: string,
): { personas: number; minutos: number } {
  const dentro = [...dentroPorEmpleado(sessions, enCursoPorSesion, nowISO).values()];
  return {
    personas: dentro.length,
    minutos: dentro.reduce((suma, persona) => suma + persona.minutos, 0),
  };
}
