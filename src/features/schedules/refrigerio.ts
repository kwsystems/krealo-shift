import { minutosEscritos } from '@/domain/duracion-escrita';

/**
 * LOS MINUTOS DE REFRIGERIO, COMO SE ESCRIBEN (auditoría, 4-oct).
 *
 * El campo quitaba todo lo que no fuera dígito: «1:00» guardaba 100 minutos, «1h» uno y el
 * campo vacío cero, sin un aviso. Son minutos que se descuentan de las horas que se pagan.
 * Ahora se entiende lo que una persona escribe de verdad —«60», «45 min», «1:00», «1 h»,
 * «1h30», «1,5 h», y desde el 8-oct «1», que es una hora— y lo demás es `null`, que la
 * pantalla dice que no entendió. El lector es el mismo de la hora extra:
 * `src/domain/duracion-escrita.ts`.
 */
export function minutosDeRefrigerio(texto: string): number | null {
  return minutosEscritos(texto);
}
