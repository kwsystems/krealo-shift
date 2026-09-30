import type { TFunction } from 'i18next';

import { formatDateKeyShort, formatDayLong } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';

import type { Periodo } from './periodo';

/** Hasta cuántos días sueltos se nombran uno a uno; con más, se dice cuántos y entre cuándo. */
const SUELTOS_NOMBRADOS = 5;

/**
 * UNOS DÍAS ELEGIDOS, DICHOS CON PALABRAS: «Del 7 sep al 12 sep · 6 días», «3 días: 7 sep,
 * 10 sep, 12 sep». Lo usan el botón de Reportes, la hoja de elegir y lo que se comparte,
 * para que los tres digan lo mismo de la misma elección.
 */
export function etiquetaDeDias(
  periodo: Pick<Periodo, 'from' | 'to' | 'dias' | 'seguidos'>,
  language: SupportedLanguage,
  t: TFunction,
): string {
  if (periodo.dias.length === 1) return formatDayLong(periodo.from, language);
  if (periodo.seguidos) {
    return t('reports.daysRange', {
      from: formatDateKeyShort(periodo.from, language),
      to: formatDateKeyShort(periodo.to, language),
      total: periodo.dias.length,
    });
  }
  if (periodo.dias.length <= SUELTOS_NOMBRADOS) {
    return t('reports.daysLoose', {
      count: periodo.dias.length,
      list: periodo.dias.map((dia) => formatDateKeyShort(dia, language)).join(', '),
    });
  }
  return t('reports.daysLooseMany', {
    total: periodo.dias.length,
    from: formatDateKeyShort(periodo.from, language),
    to: formatDateKeyShort(periodo.to, language),
  });
}

/** El periodo entero, para el encabezado de lo que se comparte. */
export function etiquetaDelPeriodo(
  periodo: Periodo,
  language: SupportedLanguage,
  t: TFunction,
): string {
  if (periodo.tipo === 'dia' || periodo.tipo === 'dias')
    return etiquetaDeDias(periodo, language, t);
  return t('reports.periodRange', {
    from: formatDateKeyShort(periodo.from, language),
    to: formatDateKeyShort(periodo.to, language),
  });
}
