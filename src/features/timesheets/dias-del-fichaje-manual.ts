import { useTranslation } from 'react-i18next';

import { addDaysToKey, dateKeyOf, formatDayColumn } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';

import type { WorkSession } from './api';

/**
 * LOS DÍAS QUE OFRECE «AGREGAR FICHAJE MANUAL» (1-oct): hoy, ayer, anteayer y el de
 * cualquier jornada que siga abierta, del más reciente al más antiguo.
 *
 * Antes la fecha era siempre la de hoy, sin poder cambiarla. Pasada la medianoche, la
 * salida que faltaba de anoche se apuntaba en la noche de mañana y la persona seguía
 * «Trabajando» en Inicio y en Horario hasta entonces.
 *
 * `diaDeLaJornadaAbierta` es el día de entrada de quien sigue dentro: es el que se propone
 * al elegir «Olvidó marcar salida».
 */
export function useDiasDelFichajeManual(params: {
  sesiones: readonly WorkSession[];
  nowISO: string;
  timezone: string;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();
  const hoy = dateKeyOf(params.nowISO, params.timezone);
  const ayer = addDaysToKey(hoy, -1);
  const diaDeLaJornadaAbierta = new Map<string, string>();
  for (const sesion of params.sesiones) {
    if (sesion.ends_at === null) {
      diaDeLaJornadaAbierta.set(sesion.employee_id, dateKeyOf(sesion.starts_at, params.timezone));
    }
  }
  const claves = new Set([hoy, ayer, addDaysToKey(hoy, -2), ...diaDeLaJornadaAbierta.values()]);
  const diasDelFichajeManual = Array.from(claves)
    .sort((a, b) => b.localeCompare(a))
    .map((clave) => ({
      value: clave,
      label:
        clave === hoy
          ? t('common.today')
          : clave === ayer
            ? t('common.yesterday')
            : formatDayColumn(clave, params.language),
    }));
  return { diasDelFichajeManual, diaDeLaJornadaAbierta };
}
