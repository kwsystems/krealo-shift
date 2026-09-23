import type { TimeEventType } from '../../../src/domain/attendance-state-machine';

/**
 * El tipo de un fichaje PARA CALCULAR, que no siempre es el tipo con el que se marco.
 *
 * DE DONDE SALE. Un gerente tiene que poder decir «esa salida de las 17:00 no fue fin de
 * jornada: se fue al almacen y volvio a las 19:00». Pedido de Andree, 2026-09-22.
 *
 * Y LA REGLA DE ORO DEL PROYECTO ES QUE UN FICHAJE NO SE EDITA NUNCA. El evento crudo es
 * la unica prueba de lo que paso, y una correccion que lo reescribe borra la diferencia
 * entre un error honesto y un fraude en una auditoria laboral.
 *
 * Asi que no se edita: se AÑADE `reclassified_as`. El evento sigue diciendo
 * `event_type: 'clock_out'` para siempre —eso es lo que la persona marco y lo que se
 * enseña en «Fichajes en crudo»— y el calculo de horas usa el tipo efectivo. Las dos
 * verdades conviven porque son dos preguntas distintas: que hizo la persona, y como se
 * cuenta.
 *
 * TODO SITIO QUE DECIDA ALGO SEGUN EL TIPO USA ESTO. Leer `event_type` a pelo para
 * calcular es el fallo que esta funcion existe para impedir, y bastaria uno solo para
 * que la hoja de horas y los reportes dijeran cosas distintas del mismo dia.
 */
export function tipoEfectivo(evento: Record<string, unknown>): TimeEventType {
  const reclasificado = evento.reclassified_as;
  if (typeof reclasificado === 'string' && reclasificado !== '') {
    return reclasificado as TimeEventType;
  }
  return evento.event_type as TimeEventType;
}

/** Si a este fichaje le cambiaron el tipo para el calculo. */
export function estaReclasificado(evento: Record<string, unknown>): boolean {
  const reclasificado = evento.reclassified_as;
  return typeof reclasificado === 'string' && reclasificado !== '';
}
