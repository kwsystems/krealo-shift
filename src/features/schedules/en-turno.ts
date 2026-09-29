import type { ShiftRow } from './api';
import { OPEN_SESSION_ALERT_MINUTES } from '@/features/timesheets/alerts';
import { estadoVisible, type EstadoVisible } from '@/features/timesheets/en-curso';
import { minutesBetween } from '@/utils/time';

/**
 * ¿Está esta persona trabajando AHORA MISMO en este turno?
 *
 * Es lo que pinta de verde una tarjeta del Horario, y la pregunta es «¿ha fichado?», no
 * «¿le toca a esta hora?». Un turno en su horario y sin fichaje no se pinta: verde diría
 * «está en la tienda» de alguien que no ha llegado, y esa es justo la mentira que no se
 * puede contar en la pantalla desde la que se arma la semana. Quién falta lo dice Inicio,
 * con su tolerancia.
 *
 * El dato sale de la misma consulta que Inicio y Horas (`useWorkingNow`), así que las tres
 * pantallas no pueden discrepar sobre la misma persona en el mismo minuto.
 */

export type DentroAhora = {
  estado: 'trabajando' | 'descanso';
  /** El turno al que dijo pertenecer al fichar la entrada. `null` si fichó sin turno. */
  shiftId: string | null;
  /** Cuándo empezó la jornada abierta. */
  desde: string;
  /** El motivo de la pausa abierta: `meal` es «Almorzando». */
  motivo?: string | null;
  /** Desde cuándo está en pausa, si lo está. */
  descansoDesde?: string | null;
};

/** `almorzando` es un descanso cuyo motivo es la comida: ver `estadoVisible`. */
export type EstadoDelTurno = EstadoVisible | null;

export function estadoDelTurnoAhora(
  shift: ShiftRow,
  dentro: DentroAhora | undefined,
  nowISO: string,
): EstadoDelTurno {
  if (dentro === undefined || shift.status === 'cancelled') return null;

  /*
   * UNA SALIDA OLVIDADA NO ES ALGUIEN DENTRO. Con la jornada abierta desde ayer, el turno
   * de ayer saldría en verde el día entero. Es la misma regla de 16 h que usa Horas para
   * decir «Sin salida»: dos definiciones de «olvido» acabarían discrepando.
   */
  if (minutesBetween(dentro.desde, nowISO) > OPEN_SESSION_ALERT_MINUTES) return null;

  /*
   * SI FICHÓ CONTRA UN TURNO, ES ESE Y NINGÚN OTRO. Con dos turnos el mismo día —mañana y
   * tarde— solo se pinta aquel en el que entró. Y cubre a quien entra unos minutos antes
   * de su hora, que por reloj todavía no estaría «en turno».
   */
  const visible = estadoVisible(dentro.estado, dentro.motivo);
  if (dentro.shiftId !== null) return dentro.shiftId === shift.id ? visible : null;

  /*
   * FICHÓ SIN TURNO: se pinta el suyo que esté en curso, si lo hay. Pasa cuando el reloj no
   * encontró turno al que asociar la entrada —por ejemplo, porque se publicó después—.
   */
  const ahora = Date.parse(nowISO);
  return Date.parse(shift.starts_at) <= ahora && ahora < Date.parse(shift.ends_at) ? visible : null;
}
