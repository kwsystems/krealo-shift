/**
 * LOS MINUTOS DE REFRIGERIO, COMO SE ESCRIBEN (auditoría, 4-oct).
 *
 * El campo quitaba todo lo que no fuera dígito: «1:00» guardaba 100 minutos, «1h» uno y el
 * campo vacío cero, sin un aviso. Son minutos que se descuentan de las horas que se pagan.
 * Ahora se entiende lo que una persona escribe de verdad —«60», «45 min», «1:00», «1 h»,
 * «1h30», «1,5 h»— y lo demás es `null`, que la pantalla dice que no entendió.
 */
export function minutosDeRefrigerio(texto: string): number | null {
  const limpio = texto.trim().toLowerCase().replace(/\s+/g, '');
  if (limpio === '') return null;

  const minutos = /^(\d{1,3})(?:m|min|mins|minutos?)?$/.exec(limpio);
  if (minutos !== null) return Number(minutos[1]);

  const reloj = /^(\d{1,2}):(\d{2})$/.exec(limpio);
  if (reloj !== null) {
    const horas = Number(reloj[1]);
    const resto = Number(reloj[2]);
    return resto < 60 ? horas * 60 + resto : null;
  }

  const horas = /^(\d{1,2})(?:[.,](\d{1,2}))?(?:h|hr|hrs|hora|horas)(?:(\d{1,2})(?:m|min)?)?$/.exec(
    limpio,
  );
  if (horas !== null) {
    if (horas[2] !== undefined && horas[3] !== undefined) return null;
    const fraccion = horas[2] === undefined ? 0 : Number(`0.${horas[2]}`);
    const extra = horas[3] === undefined ? 0 : Number(horas[3]);
    if (extra >= 60) return null;
    return Math.round((Number(horas[1]) + fraccion) * 60) + extra;
  }
  return null;
}
