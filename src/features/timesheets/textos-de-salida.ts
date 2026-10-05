import type { TFunction } from 'i18next';

/**
 * LA SALIDA QUE PUSO EL SISTEMA (5-oct), dicha en UN sitio: Horas, Equipo, Horario y el
 * celular la escriben igual. Quien no marcó la salida queda con la hora de fin de su turno
 * (`functions/src/cierre-automatico.ts`), y la jornada lleva `auto_clock_out` hasta que
 * alguien corrige esa salida. Sin la marca, «10:00 – 19:00» parecería fichado por ella.
 */

/** Si la salida de la jornada la puso el sistema y nadie la ha corregido. */
export function esSalidaAutomatica(jornada: { auto_clock_out?: boolean | null }): boolean {
  return jornada.auto_clock_out === true;
}

/** «Salida automática». */
export function etiquetaDeSalidaAutomatica(t: TFunction): string {
  return t('timesheet.autoExitLabel');
}

/** El tramo «10:00 – 19:00», con « · Salida automática» detrás si la puso el sistema. */
export function tramoConSalida(
  t: TFunction,
  jornada: { auto_clock_out?: boolean | null },
  tramo: string,
): string {
  return esSalidaAutomatica(jornada) ? `${tramo} · ${etiquetaDeSalidaAutomatica(t)}` : tramo;
}

/**
 * Lo que ve en su celular quien no marcó la salida: «Entraste 10:00 · Salida automática
 * 19:00». «Marcaste 10:00 – 19:00» le contaría una marca que no hizo.
 */
export function marcaConSalidaAutomatica(t: TFunction, desde: string, hasta: string): string {
  return `${t('portal.markOpen', { from: desde })} · ${etiquetaDeSalidaAutomatica(t)} ${hasta}`;
}
