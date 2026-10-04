import { addDaysToKey, dateKeyOf } from '@/features/schedules/week';

import type { EligibleShift } from './api';

/**
 * QUÉ TURNO ENSEÑA EL RELOJ Y CUÁL QUEDA ELEGIDO (4-oct).
 *
 * POR QUÉ EXISTE. Andree, con la foto del reloj: «¿podría aparecer en esa vista los días
 * de las horas? Porque actualmente no sale y tienen que escoger horarios, es un poco
 * confuso». Una vendedora que venía a marcar su SALIDA veía «Elige tu turno» con
 * «10:00 – 22:00» y «10:00 – 21:00»: el de hoy y el de mañana, sin decir cuál era cuál, y
 * sin que elegir sirviera de nada, porque la jornada ya tenía su turno desde la entrada.
 *
 * Las reglas, que la pantalla solo pinta:
 *   - Con la jornada abierta, el turno es EL DE LA JORNADA. No se elige nada.
 *   - Al entrar, solo se ofrecen los turnos de HOY que no han terminado, y los que están
 *     en curso aunque empezaran ayer (el de noche). El de mañana no es un turno al que se
 *     pueda entrar ahora; ofrecerlo era la manera de equivocarse.
 *   - Si de esos hay uno, queda elegido. Si hay varios —turno partido—, queda elegido el
 *     que está en curso o el siguiente en empezar, y se puede cambiar.
 */

export type DiaRelativo = 'today' | 'tomorrow' | 'yesterday' | 'other';

/** De qué día es un instante, mirado desde hoy en la zona de la tienda. */
export function diaRelativo(instante: string, zona: string, ahora: Date): DiaRelativo {
  const hoy = dateKeyOf(ahora, zona);
  const dia = dateKeyOf(instante, zona);
  if (dia === '' || hoy === '') return 'other';
  if (dia === hoy) return 'today';
  if (dia === addDaysToKey(hoy, 1)) return 'tomorrow';
  if (dia === addDaysToKey(hoy, -1)) return 'yesterday';
  return 'other';
}

/** Los turnos que tiene sentido elegir AL ENTRAR, en orden de inicio. */
export function turnosParaEntrar(
  turnos: readonly EligibleShift[],
  ahora: Date,
  zona: string,
): EligibleShift[] {
  const ms = ahora.getTime();
  return turnos
    .filter((turno) => {
      const desde = Date.parse(turno.startsAt);
      const hasta = Date.parse(turno.endsAt);
      if (Number.isNaN(desde) || Number.isNaN(hasta) || hasta <= ms) return false;
      const enCurso = desde <= ms;
      return enCurso || diaRelativo(turno.startsAt, zona, ahora) === 'today';
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/**
 * El turno que queda elegido al abrir el reloj, o `null` si no hay ninguno que elegir.
 *
 * Con la jornada abierta manda la jornada: es el turno con el que se entró. Sin ella, el
 * de hoy que está en curso o, si no, el siguiente en empezar.
 */
export function turnoInicial(params: {
  turnos: readonly EligibleShift[];
  turnoDeLaJornada: string | null;
  ahora: Date;
  zona: string;
}): string | null {
  if (params.turnoDeLaJornada !== null) return params.turnoDeLaJornada;
  const posibles = turnosParaEntrar(params.turnos, params.ahora, params.zona);
  const ms = params.ahora.getTime();
  const enCurso = posibles.find((turno) => Date.parse(turno.startsAt) <= ms);
  return (enCurso ?? posibles[0])?.id ?? null;
}

/** El próximo turno que no ha terminado, para decir cuándo le toca aunque no se elija. */
export function proximoTurno(turnos: readonly EligibleShift[], ahora: Date): EligibleShift | null {
  const ms = ahora.getTime();
  return (
    [...turnos]
      .filter((turno) => Date.parse(turno.endsAt) > ms)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null
  );
}

/**
 * Hasta cuándo vale el permiso del PIN, en la hora DE ESTE APARATO.
 *
 * Se cuenta desde que llegó la respuesta y no desde `expiresAt`, que es hora del servidor:
 * una tableta con el reloj adelantado daría el permiso por vencido antes de tiempo, y una
 * atrasada lo daría por bueno cuando el servidor ya lo rechaza. Se quitan unos segundos
 * de margen por lo que tarda la red. Sin `expiresInSeconds` —un servidor de antes—, se
 * usa `expiresAt` tal cual.
 */
export const MARGEN_DEL_PERMISO_MS = 10_000;

export function permisoVigenteHasta(params: {
  recibidoEn: number;
  expiresInSeconds: number | undefined;
  expiresAt: string;
}): number {
  if (params.expiresInSeconds !== undefined) {
    return params.recibidoEn + params.expiresInSeconds * 1000 - MARGEN_DEL_PERMISO_MS;
  }
  const hasta = Date.parse(params.expiresAt);
  return Number.isNaN(hasta) ? params.recibidoEn : hasta - MARGEN_DEL_PERMISO_MS;
}
