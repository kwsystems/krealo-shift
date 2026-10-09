import type { WorkSession } from './api';

/**
 * TARDANZA Y SALIDA ANTES SE MIDEN POR TURNO, NO POR JORNADA (auditoría, 4-oct).
 *
 * El servidor marca cada jornada por su cuenta (`functions/src/shared/marcas.ts`): una
 * entrada pasada la tolerancia es `late_arrival` y una salida antes del fin del turno es
 * `early_departure`. Con un turno de 10:00 a 19:00 y la salida a almorzar marcada en el
 * reloj, son DOS jornadas del mismo turno: la de la mañana «salió 5 h antes» y la de la
 * tarde «llegó 5 h tarde». Reportes lo apuntaba así, mientras el bono, Inicio y el celular
 * decían «a tiempo»: la misma persona, el mismo día, dos verdades.
 *
 * LA REGLA, UNA VEZ Y AQUÍ: de las jornadas de un mismo turno, la tardanza es la de la
 * PRIMERA y la salida antes la de la ÚLTIMA. Una jornada sin turno se queda con sus marcas.
 * La usan Horas, Reportes, el resumen de incidencias, el bono, Inicio y el celular.
 */
export type Puntualidad = {
  tarde: boolean;
  salioAntes: boolean;
  /**
   * La primera jornada de su turno —o una sin turno—: la única que cuenta para «a tiempo».
   * Contar las demás medía la vuelta del almuerzo como una llegada.
   */
  primera: boolean;
  /**
   * Lo que faltó de ese turno ya se decidió en Por resolver —«le debe» o «está justificado»—
   * (8-oct). Sigue siendo un dato (Reportes lo anota), pero ya no es algo que revisar: Horas y
   * Equipo seguían contándolo en «Necesita revisión» después de decidirlo.
   */
  decidida: boolean;
};

const NADA: Puntualidad = { tarde: false, salioAntes: false, primera: true, decidida: false };

export function puntualidadPorJornada(
  sesiones: readonly WorkSession[],
): ReadonlyMap<string, Puntualidad> {
  const grupos = new Map<string, WorkSession[]>();
  for (const sesion of sesiones) {
    const clave =
      sesion.shift_id === null ? `sola:${sesion.id}` : `${sesion.employee_id}|${sesion.shift_id}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), sesion]);
  }

  const resultado = new Map<string, Puntualidad>();
  for (const grupo of grupos.values()) {
    const ordenadas = [...grupo].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const decidida = ordenadas.some((sesion) => sesion.casos_resueltos.includes('faltan_horas'));
    ordenadas.forEach((sesion, indice) => {
      resultado.set(sesion.id, {
        primera: indice === 0,
        decidida,
        tarde: indice === 0 && sesion.flags.includes('late_arrival'),
        salioAntes:
          indice === ordenadas.length - 1 &&
          sesion.ends_at !== null &&
          sesion.flags.includes('early_departure'),
      });
    });
  }
  return resultado;
}

/** La de una jornada, o «nada» si no está en el mapa. */
export function puntualidadDe(
  mapa: ReadonlyMap<string, Puntualidad>,
  sesion: WorkSession,
): Puntualidad {
  return mapa.get(sesion.id) ?? NADA;
}
