/**
 * QUÉ TURNO ES EL DE UNA JORNADA: el que más se solapa con ella o, si ninguno se solapa, el
 * que empieza más cerca de su entrada dentro de tres horas. PURA, para probar cada caso.
 *
 * Vive en `src/domain` (8-oct) porque la usan dos lados: el servidor
 * (`functions/src/shared/turnos.ts`) y la demostración, que con ella da su turno a las
 * jornadas fichadas en vivo. Con dos copias, la demo enseñaría «sin turno» donde producción
 * enseña «llegó tarde».
 */

export type TurnoDeJornada = {
  id: string;
  starts_at: string;
  ends_at: string;
  /** El refrigerio planificado: con él se sabe si una jornada fue de corrido (7-oct). */
  planned_unpaid_break_minutes?: number;
};

const HORA_MS = 3600_000;
/** Lo más lejos que puede empezar un turno de la entrada para contar como suyo sin solaparse. */
const CERCANIA_MAXIMA_MS = 3 * HORA_MS;
/** Cuánto antes y después de la entrada se buscan turnos: cubre el turno de noche. */
export const VENTANA_DE_BUSQUEDA_MS = 16 * HORA_MS;

/** Elige entre turnos publicados de la persona. PURA, para poder probar cada caso. */
export function elegirTurno(
  turnos: readonly TurnoDeJornada[],
  entrada: string,
  salida: string | null,
  ahora: string = new Date().toISOString(),
): TurnoDeJornada | null {
  const inicio = Date.parse(entrada);
  // Una jornada abierta dura, de momento, hasta ahora; y nunca menos de un minuto.
  const fin = Math.max(Date.parse(salida ?? ahora), inicio + 60_000);

  let mejor: { turno: TurnoDeJornada; solape: number; distancia: number } | null = null;
  for (const turno of turnos) {
    const desde = Date.parse(turno.starts_at);
    const hasta = Date.parse(turno.ends_at);
    if (Number.isNaN(desde) || Number.isNaN(hasta)) continue;
    const solape = Math.max(0, Math.min(fin, hasta) - Math.max(inicio, desde));
    const distancia = Math.abs(desde - inicio);
    if (solape === 0 && distancia > CERCANIA_MAXIMA_MS) continue;
    const gana =
      mejor === null ||
      solape > mejor.solape ||
      (solape === mejor.solape && distancia < mejor.distancia);
    if (gana) mejor = { turno, solape, distancia };
  }
  return mejor?.turno ?? null;
}
