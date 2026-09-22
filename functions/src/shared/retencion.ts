/**
 * Cuanto se guarda una foto de fichaje, leido de los ajustes de una ubicacion.
 *
 * Vive aparte de `purga-fotos.ts` para poder comprobarse: ese modulo arranca el SDK de
 * administrador al cargarse, asi que importarlo desde una prueba no es posible. Aqui no
 * se importa nada, y asi la decision de abajo —la que de verdad tiene consecuencias— se
 * puede fijar con una prueba.
 */

/**
 * Un plazo de CERO NO BORRA NADA, y la eleccion es deliberada.
 *
 * El ajuste admite 0 y se puede leer de dos formas: «no guardes ni un dia» o
 * «desactivado». No hay forma de saber cual quiso quien lo escribio, asi que se elige
 * por la consecuencia de equivocarse: si se entiende «desactivado» y queria borrar, las
 * fotos se acumulan —se ve, se corrige, y siguen ahi—; si se entiende «borra ya» y
 * queria desactivar, las fotos desaparecen para siempre por un cero mal tecleado. Entre
 * un fallo reversible y uno que no lo es, se elige el reversible.
 *
 * Devuelve `null` cuando no hay que purgar: ausente, cero, negativo o no numerico.
 */
export function plazoDeRetencion(dias: unknown): number | null {
  if (typeof dias !== 'number' || !Number.isFinite(dias) || dias <= 0) return null;
  return Math.floor(dias);
}

/** El instante a partir del cual una foto ya cumplio su plazo. */
export function corteDeRetencion(dias: number, ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();
}
