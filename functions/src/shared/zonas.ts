import { logger } from 'firebase-functions/v2';

/**
 * La zona horaria de una sede, con red debajo.
 *
 * POR QUE EXISTE. `Intl.DateTimeFormat` LANZA un `RangeError` con una zona que no
 * existe, y el servidor la usa para decidir a que dia pertenece cada jornada. Un solo
 * documento de sede con la zona mal escrita no estropeaba una fila: MATABA LA CONSULTA
 * ENTERA de Horas y de Reportes de esa semana, y con un error que no menciona la zona.
 *
 * Desde el 2026-09-23 el panel la comprueba al escribirla, asi que esto no deberia
 * disparar nunca. Se pone igual por dos razones: las sedes de antes de esa fecha no
 * pasaron por ninguna comprobacion, y el panel escribe en Firestore DIRECTAMENTE —no a
 * traves de una funcion— asi que el servidor no controla lo que llega.
 *
 * SE CAE A UTC Y LO REGISTRA, no se calla. Un dia agrupado en UTC en vez de en la zona
 * de la tienda puede estar mal; una pantalla que no carga esta mal seguro. Y el registro
 * es lo que permite enterarse: sin el, alguien veria numeros raros y no tendria por
 * donde empezar.
 */
export function zonaSegura(zona: unknown, dondeSaltó: string): string {
  const texto = typeof zona === 'string' ? zona.trim() : '';
  if (texto !== '') {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: texto });
      return texto;
    } catch {
      logger.error('Zona horaria invalida en la base: se agrupa en UTC', {
        zona: texto,
        donde: dondeSaltó,
      });
      return 'UTC';
    }
  }
  logger.error('Zona horaria vacia en la base: se agrupa en UTC', { donde: dondeSaltó });
  return 'UTC';
}
