/**
 * Qué es lo más importante HOY, y por qué ese y no otro.
 *
 * EL PROBLEMA QUE RESUELVE
 * Inicio tenía ocho cifras del mismo tamaño, del mismo peso y en el mismo orden
 * siempre: trabajando, en descanso, próximos, atrasados, ausentes, fichajes
 * incompletos, eventos sin sincronizar y solicitudes. Ocho cosas igual de importantes
 * es lo mismo que ninguna importante: quien abría la app a las nueve tenía que
 * leerlas las ocho para saber si había algo que hacer, y un «0» ocupaba exactamente
 * el mismo sitio que un «3».
 *
 * LA REGLA
 * Primero lo que PIDE UNA ACCIÓN; después lo que solo informa. Y dentro de lo que
 * pide acción, el orden no es una lista de gustos: es cuánto cuesta no hacerlo.
 *
 * Y CUANDO NO HAY NADA QUE HACER, SE DICE
 * No se enseñan seis ceros. Que todo vaya bien es información, y merece una frase, no
 * una fila de casillas vacías que hay que interpretar.
 */

export const CLAVES_ACCIONABLES = [
  'absent',
  'late',
  'incomplete',
  'requests',
  'pendingSync',
] as const;

export type ClaveAccionable = (typeof CLAVES_ACCIONABLES)[number];

/**
 * El orden, de lo más caro a lo más barato de ignorar. Número más bajo, antes.
 *
 *   1. AUSENTES — alguien que debía estar no está, y el local está corto de gente
 *      AHORA MISMO. Es lo único de esta lista que se arregla llamando a alguien, y
 *      cada minuto que pasa es un minuto de tienda mal cubierta.
 *   2. ATRASADOS — el mismo problema, pero la persona viene de camino. Se resuelve
 *      solo en un rato; un ausente, no.
 *   3. FICHAJES INCOMPLETOS — una jornada que no se puede pagar bien. No es urgente
 *      hoy pero tiene fecha límite: llega el cierre de nómina y se paga mal.
 *   4. SOLICITUDES — alguien está esperando una respuesta que solo el gerente puede
 *      dar. Bloquea a otra persona, pero no bloquea la tienda.
 *   5. SIN SINCRONIZAR — datos en la cola del dispositivo. Casi siempre se resuelve
 *      solo en cuanto vuelve la red, y por eso va última; pero si NO se resuelve, son
 *      fichajes que se pierden, así que tampoco puede desaparecer de la pantalla.
 */
const ORDEN: Readonly<Record<ClaveAccionable, number>> = {
  absent: 1,
  late: 2,
  incomplete: 3,
  requests: 4,
  pendingSync: 5,
};

/** Dónde se resuelve cada cosa. Una cifra destacada que no lleva a ningún sitio obliga
 *  a buscar la pantalla a mano, y entonces da igual lo visible que sea. */
const DESTINO: Readonly<Record<ClaveAccionable, string | null>> = {
  // Un ausente y un atrasado se resuelven llamando por teléfono, no dentro de la app.
  // Se lleva al horario, que es donde se ve a quién le tocaba y se puede recolocar.
  absent: '/(manager)/schedule',
  late: '/(manager)/schedule',
  incomplete: '/(manager)/hours',
  requests: '/(manager)/more',
  pendingSync: null,
};

export type Destacado = {
  clave: ClaveAccionable;
  count: number;
  /** A dónde lleva tocarlo. `null` cuando no se arregla dentro de la app. */
  destino: string | null;
};

export type PrioridadDelDia = {
  /**
   * Lo único que va en grande. Es UNA sola cosa a propósito: dos titulares son cero
   * titulares, y la pregunta que responde esta pantalla es «¿qué hago primero?».
   */
  titular: Destacado | null;
  /** Lo demás que pide acción, en orden, sin el titular. */
  resto: Destacado[];
  /** Nada que hacer. No es lo mismo que «no hay datos». */
  todoEnOrden: boolean;
};

export type ConteosDelDia = Readonly<Record<ClaveAccionable, number>>;

export function prioridadDelDia(conteos: ConteosDelDia): PrioridadDelDia {
  const accionables = CLAVES_ACCIONABLES.filter((clave) => conteos[clave] > 0)
    .sort((a, b) => ORDEN[a] - ORDEN[b])
    .map<Destacado>((clave) => ({ clave, count: conteos[clave], destino: DESTINO[clave] }));

  const [titular, ...resto] = accionables;

  return {
    titular: titular ?? null,
    resto,
    todoEnOrden: accionables.length === 0,
  };
}
