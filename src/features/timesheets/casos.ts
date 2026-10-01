import type { ShiftRow } from '@/features/schedules/api';
import {
  dateKeyOf,
  localDateTimeToInstant,
  localTimeOf,
  type DateKey,
} from '@/features/schedules/week';

import type { WorkSession } from './api';

/**
 * «POR RESOLVER» EN HORAS: los casos que hay que arreglar, cada uno con su arreglo a un
 * toque (Andree, 1-oct).
 *
 * Venía de dos capturas. Una vendedora salió a las 12:04 de un turno hasta las 18:00
 * —se enfermó— y Horas solo decía «Salida anticipada»: «lo que debería salir acá es que
 * yo vea que ella me debe horas». Otra marcó de 10:00 a 18:50 sin refrigerio y Horas le
 * contaba 8:50 trabajadas: «se equivocó porque no marcó para comer». Ninguna de las dos
 * cosas tenía un sitio donde verse ni un botón que la arreglara. Ahora son casos:
 *
 *   - FALTAN HORAS: salió antes o llegó tarde y trabajó QUINCE MINUTOS O MÁS menos que su
 *     turno. Lo que falta es lo planificado —el turno menos su refrigerio— menos lo
 *     trabajado, que es lo que de verdad debe. «Le debe» o «está justificado».
 *   - SIN REFRIGERIO: su turno lleva refrigerio, la jornada no tiene ninguna pausa y duró lo
 *     bastante para haberlo tomado. «Descontar el del turno» o «trabajó sin refrigerio».
 *   - SIN SALIDA: sigue dentro y su turno acabó hace media hora o más —el caso de quien se
 *     fue sin marcar con la tienda ya cerrada—. «Marcar salida a la hora de fin de turno».
 *   - SALIDA DUDOSA: la salida quedó en una hora que todavía no llegó, o la jornada pasa de
 *     dieciséis horas. Casi siempre es el día equivocado —una salida «de hoy a las 21:00»
 *     escrita pasada la medianoche—, y mientras siga así la jornada está viva en todas las
 *     pantallas. «Salida el día de su entrada, a esa hora».
 *
 * Quince minutos y no la tolerancia de la sede: cinco minutos antes no son horas que
 * cobrar, y un caso por cada uno llenaría la lista de ruido hasta que nadie la mirara.
 *
 * PURA, para poder probar cada caso sin pantalla delante.
 */

export const MINUTOS_MINIMOS_DE_UN_CASO = 15;
/** Cuánto después del fin de su turno una jornada abierta es alguien que no marcó salida. */
const MINUTOS_SIN_SALIDA = 30;
/** Sin turno, una jornada abierta más de esto es una salida olvidada. */
const HORAS_ABIERTA_SIN_TURNO = 12;
/** Ninguna jornada de tienda dura más que esto: una que sí, tiene mal la salida. */
const HORAS_DE_UNA_JORNADA_DUDOSA = 16;
/** Lo que se tolera de reloj adelantado, como el servidor. */
const MARGEN_FUTURO_MS = 5 * 60_000;

export type CasoPorResolver =
  | {
      tipo: 'faltan_horas';
      id: string;
      sesion: WorkSession;
      turno: ShiftRow;
      dia: DateKey;
      /** Lo planificado menos lo trabajado: lo que debe. */
      faltan: number;
      /** Cuánto antes de su fin de turno salió, y cuánto después de su inicio entró. */
      salioAntes: number;
      llegoTarde: number;
    }
  | {
      tipo: 'sin_refrigerio';
      id: string;
      sesion: WorkSession;
      turno: ShiftRow;
      dia: DateKey;
      refrigerio: number;
    }
  | {
      tipo: 'sin_salida';
      id: string;
      sesion: WorkSession;
      turno: ShiftRow | null;
      dia: DateKey;
      /** La hora que se propone: el fin de su turno. `null` sin turno. */
      salidaPropuesta: string | null;
    }
  | {
      tipo: 'salida_dudosa';
      id: string;
      sesion: WorkSession;
      turno: ShiftRow | null;
      dia: DateKey;
      /** La salida está en una hora que todavía no llegó. */
      futura: boolean;
      /** La misma hora el día en que entró —el error de siempre—, o el fin de su turno. */
      salidaPropuesta: string | null;
    };

const minutos = (desde: string, hasta: string) =>
  Math.round((Date.parse(hasta) - Date.parse(desde)) / 60_000);

export function casosPorResolver(params: {
  sesiones: readonly WorkSession[];
  turnos: readonly ShiftRow[];
  ahoraISO: string;
  timezone: string;
}): CasoPorResolver[] {
  const turnoPorId = new Map(params.turnos.map((turno) => [turno.id, turno]));
  const casos: CasoPorResolver[] = [];

  for (const sesion of params.sesiones) {
    const turno = sesion.shift_id === null ? null : (turnoPorId.get(sesion.shift_id) ?? null);
    const dia = dateKeyOf(sesion.starts_at, params.timezone);
    const resuelto = (caso: string) => sesion.casos_resueltos.includes(caso);

    if (sesion.ends_at === null) {
      const abierta =
        turno !== null
          ? minutos(turno.ends_at, params.ahoraISO) >= MINUTOS_SIN_SALIDA
          : minutos(sesion.starts_at, params.ahoraISO) >= HORAS_ABIERTA_SIN_TURNO * 60;
      if (abierta) {
        casos.push({
          tipo: 'sin_salida',
          id: `${sesion.id}:sin_salida`,
          sesion,
          turno,
          dia,
          salidaPropuesta: turno?.ends_at ?? null,
        });
      }
      continue;
    }
    const futura = Date.parse(sesion.ends_at) > Date.parse(params.ahoraISO) + MARGEN_FUTURO_MS;
    if (
      (futura || minutos(sesion.starts_at, sesion.ends_at) > HORAS_DE_UNA_JORNADA_DUDOSA * 60) &&
      !resuelto('salida_dudosa')
    ) {
      casos.push({
        tipo: 'salida_dudosa',
        id: `${sesion.id}:salida_dudosa`,
        sesion,
        turno,
        dia,
        futura,
        salidaPropuesta: salidaDelDiaDeEntrada(sesion, turno, dia, params.timezone),
      });
      // Lo demás se mide con la salida buena: con esta, cualquier otro caso mentiría.
      continue;
    }
    if (turno === null) continue;

    const refrigerio = Math.max(0, turno.planned_unpaid_break_minutes);
    const pausas = sesion.paid_break_minutes + sesion.unpaid_break_minutes;
    const brutos = sesion.gross_minutes ?? minutos(sesion.starts_at, sesion.ends_at);
    // Lo bastante larga para haberlo tomado: más del doble del refrigerio y más de 4 h.
    if (
      refrigerio > 0 &&
      pausas === 0 &&
      brutos > Math.max(refrigerio * 2, 240) &&
      !resuelto('sin_refrigerio')
    ) {
      casos.push({
        tipo: 'sin_refrigerio',
        id: `${sesion.id}:sin_refrigerio`,
        sesion,
        turno,
        dia,
        refrigerio,
      });
    }

    const planificado = minutos(turno.starts_at, turno.ends_at) - refrigerio;
    const trabajado = sesion.net_minutes ?? brutos - sesion.unpaid_break_minutes;
    const faltan = planificado - trabajado;
    const salioAntes = Math.max(0, minutos(sesion.ends_at, turno.ends_at));
    const llegoTarde = Math.max(0, minutos(turno.starts_at, sesion.starts_at));
    if (
      faltan >= MINUTOS_MINIMOS_DE_UN_CASO &&
      (salioAntes >= MINUTOS_MINIMOS_DE_UN_CASO || llegoTarde >= MINUTOS_MINIMOS_DE_UN_CASO) &&
      !resuelto('faltan_horas')
    ) {
      casos.push({
        tipo: 'faltan_horas',
        id: `${sesion.id}:faltan_horas`,
        sesion,
        turno,
        dia,
        faltan,
        salioAntes,
        llegoTarde,
      });
    }
  }

  // Primero lo que sigue abierto —se está pagando ahora mismo—, y luego por día.
  const orden = { sin_salida: 0, salida_dudosa: 1, sin_refrigerio: 2, faltan_horas: 3 } as const;
  return casos.sort(
    (a, b) => orden[a.tipo] - orden[b.tipo] || a.sesion.starts_at.localeCompare(b.sesion.starts_at),
  );
}

/**
 * La salida que se propone para una salida dudosa: la misma hora el día en que entró, si
 * cae después de la entrada —«21:00 de mañana» era «21:00 de anoche»—; si no, el fin de su
 * turno; y si tampoco, ninguna.
 */
function salidaDelDiaDeEntrada(
  sesion: WorkSession,
  turno: ShiftRow | null,
  dia: DateKey,
  timezone: string,
): string | null {
  if (sesion.ends_at === null) return null;
  const mismaHora = localDateTimeToInstant(dia, localTimeOf(sesion.ends_at, timezone), timezone);
  if (mismaHora !== null && Date.parse(mismaHora) > Date.parse(sesion.starts_at)) return mismaHora;
  if (turno !== null && Date.parse(turno.ends_at) > Date.parse(sesion.starts_at)) {
    return turno.ends_at;
  }
  return null;
}
