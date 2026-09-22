import type { TFunction } from 'i18next';

import { BREAK_REASONS, type BreakReason } from '@/domain/break-reason';

/**
 * El nombre visible de cada motivo de pausa, en un solo sitio.
 *
 * Estaba escrito a mano dentro del kiosco. Al añadir Reportes habría quedado escrito
 * dos veces, y dos listas de las mismas seis etiquetas se separan: se traduce una,
 * se renombra la otra, y el mismo motivo acaba llamándose «Reunión o charla» en el
 * reloj y «Reunión» en el reporte. Un gerente que ve dos nombres no sabe si son dos
 * cosas.
 */
export function breakReasonLabels(t: TFunction): Record<BreakReason, string> {
  return {
    meal: t('kiosk.reasonMeal'),
    rest: t('kiosk.reasonRest'),
    permit: t('kiosk.reasonPermit'),
    meeting: t('kiosk.reasonMeeting'),
    training: t('kiosk.reasonTraining'),
    errand: t('kiosk.reasonErrand'),
    other: t('kiosk.reasonOther'),
  };
}

/** Las claves que `breakReasonLabels` debe cubrir. La prueba de paridad las usa. */
export const BREAK_REASON_KEYS = BREAK_REASONS.map((reason) => {
  const sufijo = reason.charAt(0).toUpperCase() + reason.slice(1);
  return `kiosk.reason${sufijo}`;
});
