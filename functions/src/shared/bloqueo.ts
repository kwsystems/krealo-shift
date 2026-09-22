/**
 * Cuando un reloj se bloquea por PIN equivocados, y cuando deja de estarlo.
 *
 * EL CONTADOR ES DEL APARATO Y NO DE LA PERSONA, y no es un descuido: el teclado
 * devuelve el mismo error para «ese PIN no es de nadie» y «ese PIN es de otro» a
 * proposito, asi que en el momento de contar el fallo NO SE SABE QUIEN FALLO. Contar
 * por persona exigiria decir a quien pertenece cada intento, que es justo lo que
 * convertiria el teclado en un comprobador de PIN ajenos.
 *
 * Pero contar por aparato tenia dos agujeros, los dos medidos contra produccion el
 * 22-sep-2026:
 *
 *   1. EL CONTADOR NO CADUCABA. Cuatro fallos el lunes y uno el martes bloqueaban la
 *      tienda. Solo un acierto lo reiniciaba.
 *   2. AL VENCER EL BLOQUEO, EL CONTADOR SEGUIA ARRIBA. Pasados los cinco minutos, UN
 *      solo fallo mas volvia a bloquear otros cinco. Una tienda donde nadie recuerda
 *      su PIN se quedaba bloqueada para siempre, de cinco en cinco minutos.
 *
 * Con ventana, cinco fallos sueltos a lo largo del dia no son nada y cinco seguidos en
 * un minuto sí. Y el limite sube de 5 a 10 porque el que pagaba los 5 era el cambio de
 * turno: veinte personas llegando a la vez y cinco despistes entre cinco personas
 * DISTINTAS dejaban fuera a las quince restantes. Diez intentos en cinco minutos siguen
 * siendo 2.880 al dia contra un millon de combinaciones, con bcrypt de por medio.
 *
 * Es una funcion pura para poder probar los cuatro casos sin Firestore: es una decision
 * con cuatro ramas sobre fechas, que es exactamente donde se cuelan los errores.
 */

/** Fallos permitidos dentro de la ventana antes de bloquear. */
export const MAX_INTENTOS = 10;
/** Los fallos mas viejos que esto no cuentan. */
export const VENTANA_MINUTOS = 5;
/** Lo que dura el bloqueo. */
export const BLOQUEO_MINUTOS = 5;

export type EstadoDeIntentos = {
  intentos: number;
  ultimoFallo: string | null;
  bloqueadoHasta: string | null;
};

/** Milisegundos de una fecha ISO, o `null` si no es una fecha. */
function instante(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** ¿Esta bloqueado el aparato AHORA? */
export function estaBloqueado(estado: EstadoDeIntentos, ahora: number): boolean {
  const hasta = instante(estado.bloqueadoHasta);
  return hasta !== null && hasta > ahora;
}

/** El estado que queda tras anotar UN fallo mas. */
export function trasUnFallo(estado: EstadoDeIntentos, ahora: number): EstadoDeIntentos {
  const ultimo = instante(estado.ultimoFallo);
  const bloqueo = instante(estado.bloqueadoHasta);

  /*
   * Se empieza a contar de cero cuando el fallo anterior queda fuera de la ventana, y
   * tambien cuando venia de un bloqueo YA VENCIDO: haber cumplido el castigo tiene que
   * devolver los intentos, o el segundo bloqueo llega al primer despiste.
   */
  const reinicia =
    ultimo === null ||
    ahora - ultimo > VENTANA_MINUTOS * 60_000 ||
    (bloqueo !== null && bloqueo <= ahora);

  const intentos = reinicia ? 1 : estado.intentos + 1;

  return {
    intentos,
    ultimoFallo: new Date(ahora).toISOString(),
    bloqueadoHasta:
      intentos >= MAX_INTENTOS ? new Date(ahora + BLOQUEO_MINUTOS * 60_000).toISOString() : null,
  };
}
