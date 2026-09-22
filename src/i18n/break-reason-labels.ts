import type { TFunction } from 'i18next';

import { BREAK_REASONS, type BreakReason } from '@/domain/break-reason';
import {
  EARLY_DEPARTURE_REASONS,
  type EarlyDepartureReason,
} from '@/domain/early-departure-reason';

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

/**
 * El nombre visible de cada motivo de SALIDA ANTICIPADA.
 *
 * Lista aparte de la de pausas, y a propósito: «Comida» no es un motivo para irse a
 * casa. El razonamiento completo está en `src/domain/early-departure-reason.ts`.
 */
export function earlyDepartureReasonLabels(t: TFunction): Record<EarlyDepartureReason, string> {
  return {
    agreed_end: t('kiosk.departureAgreedEnd'),
    errand: t('kiosk.departureErrand'),
    medical: t('kiosk.departureMedical'),
    permit: t('kiosk.departurePermit'),
    emergency: t('kiosk.departureEmergency'),
    other: t('kiosk.departureOther'),
  };
}

/** Las claves que `earlyDepartureReasonLabels` debe cubrir. La prueba de paridad las usa. */
export const EARLY_DEPARTURE_REASON_KEYS = EARLY_DEPARTURE_REASONS.map((reason) => {
  const camello = reason.replace(/_(.)/g, (_, c: string) => c.toUpperCase());
  return `kiosk.departure${camello.charAt(0).toUpperCase()}${camello.slice(1)}`;
});

/**
 * La clave de traducción de un motivo de salida que viene de la base.
 *
 * ACEPTA UN `string` CUALQUIERA a propósito. Lo que llega es lo que guardó el servidor,
 * y un reloj más nuevo puede haber escrito un motivo que esta versión del panel no
 * conoce todavía. Devolver la clave de «Otro» enseña algo razonable en vez de dejar
 * escrito en pantalla el identificador crudo o, peor, romper la fila.
 */
export function departureReasonLabelKey(reason: string): string {
  const conocido = (EARLY_DEPARTURE_REASONS as readonly string[]).includes(reason);
  const usar = conocido ? reason : 'other';
  const camello = usar.replace(/_(.)/g, (_, c: string) => c.toUpperCase());
  return `kiosk.departure${camello.charAt(0).toUpperCase()}${camello.slice(1)}`;
}
