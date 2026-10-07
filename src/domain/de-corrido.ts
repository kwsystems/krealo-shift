/**
 * LA JORNADA DE CORRIDO: sin almuerzo, y se fue antes lo que dura el refrigerio (Andree, 7-oct).
 *
 * Una vendedora con turno de 10:00 a 19:00 y 1 h de refrigerio marcó de 09:53 a 18:01 sin
 * pausa. Andree: «no tuvo almuerzo pero hizo 8 horas de corrido, entonces valen las 8 horas;
 * salió 1 hora antes por eso. Haz que sea normal». Y salía como dos cosas que no eran: «salió
 * antes» en todas las pantallas, y el caso «sin refrigerio» de Horas, que proponía descontarle
 * una hora que nunca tomó y dejarla debiendo.
 *
 * ES DE CORRIDO si se cumplen las cuatro:
 *   - su turno lleva refrigerio;
 *   - no marcó ninguna pausa, ni dejó hueco entre dos jornadas del turno;
 *   - trabajó lo planificado (el turno menos el refrigerio), con menos de 15 min de
 *     diferencia arriba o abajo: 15 min de menos ya es «le faltan» en Por resolver;
 *   - y se fue antes como mucho lo que dura el refrigerio, con la misma holgura.
 *
 * LO QUE NO ES, y por eso la holgura es estrecha: quien se queda el turno entero sin almorzar
 * (de 8:00 a 14:00 en un turno que lleva 30 min) trabajó MÁS de lo planificado. Ahí sí puede
 * haber almorzado sin marcarlo, y el caso «sin refrigerio» sigue preguntando. Y quien se fue
 * antes y además trabajó menos sigue debiendo horas: eso es «salió antes» de verdad.
 *
 * VIVE EN `src/domain` PORQUE LA USAN TRES LADOS: el servidor, que con ella no marca
 * `early_departure` (`functions/src/shared/marcas.ts`); Horas, que no abre el caso «sin
 * refrigerio» (`src/features/timesheets/casos.ts`); y la demostración. Como la marca la lee
 * todo lo demás —Horas, Reportes, el bono, Inicio, Equipo y el celular—, decidirlo aquí lo
 * decide en todas partes.
 */

export const HOLGURA_DE_CORRIDO_MINUTOS = 15;

export type JornadaDeCorrido = {
  starts_at: string;
  ends_at: string | null;
  paid_break_minutes: number;
  unpaid_break_minutes: number;
};

const MINUTO = 60_000;

function minutos(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / MINUTO);
}

/**
 * Si las jornadas de UN turno son una jornada de corrido. Recibe todas las del turno: dos
 * jornadas son una salida a almorzar marcada en el reloj, y eso ya es una pausa.
 */
export function esJornadaDeCorrido(params: {
  turno: { starts_at: string; ends_at: string; planned_unpaid_break_minutes: number };
  jornadas: readonly JornadaDeCorrido[];
}): boolean {
  const refrigerio = Math.max(0, Number(params.turno.planned_unpaid_break_minutes) || 0);
  if (refrigerio === 0 || params.jornadas.length === 0) return false;
  if (params.jornadas.some((jornada) => jornada.ends_at === null)) return false;

  const ordenadas = [...params.jornadas].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const huecos = ordenadas
    .slice(1)
    .reduce(
      (suma, jornada, i) =>
        suma + Math.max(0, minutos(ordenadas[i]!.ends_at as string, jornada.starts_at)),
      0,
    );
  const pausas =
    huecos +
    ordenadas.reduce(
      (suma, jornada) =>
        suma + Math.max(0, jornada.paid_break_minutes) + Math.max(0, jornada.unpaid_break_minutes),
      0,
    );
  if (pausas > 0) return false;

  const trabajado = ordenadas.reduce(
    (suma, jornada) => suma + minutos(jornada.starts_at, jornada.ends_at as string),
    0,
  );
  const planificado = minutos(params.turno.starts_at, params.turno.ends_at) - refrigerio;
  const ultima = ordenadas[ordenadas.length - 1]!;
  const salioAntes = Math.max(0, minutos(ultima.ends_at as string, params.turno.ends_at));

  return (
    Math.abs(trabajado - planificado) < HOLGURA_DE_CORRIDO_MINUTOS &&
    salioAntes <= refrigerio + HOLGURA_DE_CORRIDO_MINUTOS
  );
}
