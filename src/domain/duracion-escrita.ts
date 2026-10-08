/**
 * UNA DURACIÓN, COMO LA ESCRIBE UNA PERSONA (8-oct). Un solo lector para el refrigerio del
 * turno y para «Cuenta como hora extra»: con dos, cada campo entendía otra cosa.
 *
 * Andree escribía «1» —una hora— en los dos, y los dos guardaban UN MINUTO: el turno quedaba
 * con 1 min de refrigerio y la hora extra en 0:01, y el caso «sin refrigerio» de Horas no se
 * iba hiciera lo que hiciera. Nadie apunta un refrigerio ni una hora extra de uno a cuatro
 * minutos, así que un número suelto del 1 al 4 son HORAS; del 5 en adelante, minutos
 * («30», «45», «90»). Lo demás se escribe como se diría: «1:30», «1 h», «1h30», «1,5», «45 min».
 *
 * Y cada campo dice debajo cómo lo va a guardar («Se guarda: 1 h»), para que nadie tenga que
 * adivinar qué entendió la app.
 */
export const HORAS_SUELTAS_HASTA = 4;

export function minutosEscritos(texto: string): number | null {
  const limpio = texto.trim().toLowerCase().replace(/\s+/g, '');
  if (limpio === '') return null;

  const suelto = /^(\d{1,4})(m|min|mins|minutos?)?$/.exec(limpio);
  if (suelto !== null) {
    const numero = Number(suelto[1]);
    if (suelto[2] === undefined && numero >= 1 && numero <= HORAS_SUELTAS_HASTA) {
      return numero * 60;
    }
    return numero;
  }

  const reloj = /^(\d{1,2}):(\d{2})$/.exec(limpio);
  if (reloj !== null) {
    const resto = Number(reloj[2]);
    return resto < 60 ? Number(reloj[1]) * 60 + resto : null;
  }

  // «1,5» y «1.5» sin unidad: horas, como «1,5 h».
  const horas =
    /^(\d{1,2})(?:[.,](\d{1,2}))?(?:h|hr|hrs|hora|horas)?(?:(\d{1,2})(?:m|min)?)?$/.exec(limpio);
  if (horas !== null && (horas[2] !== undefined || /h/.test(limpio))) {
    if (horas[2] !== undefined && horas[3] !== undefined) return null;
    const fraccion = horas[2] === undefined ? 0 : Number(`0.${horas[2]}`);
    const extra = horas[3] === undefined ? 0 : Number(horas[3]);
    if (extra >= 60) return null;
    return Math.round((Number(horas[1]) + fraccion) * 60) + extra;
  }
  return null;
}
