import type { TFunction } from 'i18next';

import { minutesToHHmm } from '@/utils/time';

/**
 * CÓMO SE DICE LO QUE TODAVÍA VA EN CURSO (5-oct), en UN sitio: Reportes e Inicio lo
 * escriben igual. Andree vio «00:00 trabajadas» con alguien dentro desde hacía una hora y
 * «Va al 122 %» en la misma tarjeta: el número grande no contaba lo que iba en curso y el
 * porcentaje sí. Ahora el número grande lo cuenta, y esta línea dice cuánto de él sigue
 * abierto, para que nadie crea que esas horas ya están cerradas.
 */
export function notaDeEnCurso(
  t: TFunction,
  enCurso: { personas: number; minutos: number },
): string {
  return t('timesheet.liveIncluded', {
    count: enCurso.personas,
    hours: minutesToHHmm(enCurso.minutos),
  });
}
