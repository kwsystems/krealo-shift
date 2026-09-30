import {
  transition,
  type AttendanceState,
  type TimeEventType,
} from '../../../src/domain/attendance-state-machine';
import { tipoEfectivo } from './eventos';

/**
 * QUÉ FICHAJES CUENTAN, recorriéndolos en orden con la máquina de estados (30-sep).
 *
 * Un fichaje que no encaja —una segunda entrada sin salida entre medias— no se corrige ni
 * se borra: se deja fuera del cálculo, que es lo que ya decía §17 y lo que ya hacía
 * `attendanceStateAt`. La proyección de la sesión no lo hacía: tomaba «la última entrada»
 * a pelo, así que las dos preguntas —«¿en qué estado está?» y «¿dónde empieza su
 * jornada?»— podían contestar cosas distintas del mismo día.
 *
 * Con fichajes del reloj no pasa nunca, porque el servidor rechaza al marcar lo que no
 * encaja. Pasa en cuanto alguien AÑADE un fichaje en el pasado: quien olvidó la entrada de
 * las 08:00 y marcó a las 11:00 tiene, al aprobarse su solicitud, dos entradas seguidas.
 * La buena es la primera; la de las 11:00 ya no abre nada. Tomar «la última» dejaba la de
 * las 08:00 huérfana y la jornada empezando a las 11:00: la aprobación no servía de nada.
 */

type Ordenable = { occurred_at?: unknown; seq?: unknown };

/** Por instante, y a igual instante por `seq`: dos fichajes pueden compartir milisegundo. */
export function enOrden<T extends Ordenable>(eventos: readonly T[]): T[] {
  return [...eventos].sort((a, b) => {
    const porInstante = String(a.occurred_at).localeCompare(String(b.occurred_at));
    return porInstante !== 0 ? porInstante : Number(a.seq ?? 0) - Number(b.seq ?? 0);
  });
}

export type Paso<T> = {
  evento: T;
  tipo: TimeEventType;
  /** El estado de la persona justo antes de este fichaje. */
  antes: AttendanceState;
  cuenta: boolean;
};

/** Cada fichaje, en orden, con el estado de antes y si cuenta. `eventos` ya ordenados. */
export function recorrer<T extends Record<string, unknown>>(
  eventos: readonly T[],
  inicial: AttendanceState = 'OFF_SHIFT',
): Paso<T>[] {
  let estado = inicial;
  return eventos.map((evento) => {
    const tipo = tipoEfectivo(evento);
    const paso = transition(estado, tipo);
    const antes = estado;
    if (paso.allowed) estado = paso.nextState;
    return { evento, tipo, antes, cuenta: paso.allowed };
  });
}

/**
 * La jornada vigente de una lista ordenada: su entrada (la última que cuenta) y los
 * fichajes que cuentan desde ella. `undefined` si no hay ninguna entrada que cuente.
 */
export function jornadaVigente<T extends Record<string, unknown>>(
  eventos: readonly T[],
): { entrada: T; desdeLaEntrada: T[] } | undefined {
  let entrada: T | undefined;
  const desdeLaEntrada: T[] = [];
  for (const paso of recorrer(eventos)) {
    if (!paso.cuenta) continue;
    if (paso.tipo === 'clock_in') {
      entrada = paso.evento;
      desdeLaEntrada.length = 0;
    }
    if (entrada !== undefined) desdeLaEntrada.push(paso.evento);
  }
  return entrada === undefined ? undefined : { entrada, desdeLaEntrada };
}
