import type { TFunction } from 'i18next';

/**
 * «4 h 49 min», «1 h», «45 min»: una duración como la dice una persona. La usan «Por
 * resolver» en Horas y el resumen de Reportes (4-oct), para que «salió 1 h 30 min antes»
 * se diga igual en los dos sitios.
 */
export function duracion(t: TFunction, minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return t('schedule.unusual.minutes', { m });
  if (m === 0) return t('schedule.unusual.hours', { h });
  return t('schedule.unusual.hoursMinutes', { h, m });
}
