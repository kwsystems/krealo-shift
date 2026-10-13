/**
 * Dónde va el refrigerio de un turno que no se fichó: en el centro de la jornada, en
 * cuartos de hora. 10:00–19:00 con una hora da 14:00–15:00. No es un dato —nadie lo
 * marcó—, es la forma más neutra de que la jornada descuente lo que el turno planificó.
 *
 * UNA SOLA REGLA (13-oct) para el servidor —«Registrar como cumplido», «Descontar
 * refrigerio», «Vino y no marcó»— y para la demostración, que la imita.
 */
export function refrigerioCentrado(
  startsAt: string,
  endsAt: string,
  minutos: number,
): { desde: string; hasta: string } | null {
  const inicio = Date.parse(startsAt);
  const total = Math.floor((Date.parse(endsAt) - inicio) / 60000);
  if (minutos <= 0 || minutos >= total) return null;
  const antes = Math.min(Math.round((total - minutos) / 2 / 15) * 15, total - minutos);
  const desde = inicio + antes * 60000;
  return {
    desde: new Date(desde).toISOString(),
    hasta: new Date(desde + minutos * 60000).toISOString(),
  };
}
