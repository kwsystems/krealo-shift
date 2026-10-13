import type { TFunction } from 'i18next';

import type { WorkSession } from './api';
import { duracion } from './duracion';

/**
 * LO QUE SE DECIDIÓ EN UNA JORNADA, PARA PODER CAMBIARLO (13-oct).
 *
 * Andree pulsó «No es extra» en la jornada de una vendedora que trabajó de corrido: «me
 * equivoqué… necesito que haya opción para poder arreglar estas cosas, en todas las vistas».
 * Una decisión de «Por resolver» se tomaba y desaparecía: no se veía en ningún sitio y no
 * tenía vuelta atrás. Aquí se dice cuáles hay; `reopenSessionDecision` deja el día como
 * estaba y el caso vuelve a «Por resolver».
 *
 * La hora extra no está aquí: se ve y se cambia en su propia sección de la hoja.
 */
export type ClaveDeDecision =
  | 'refrigerio_del_turno'
  | 'faltan_horas'
  | 'sin_refrigerio'
  | 'salida_automatica'
  | 'salida_dudosa';

export type DecisionDeLaJornada = {
  clave: ClaveDeDecision;
  decision: string;
  nota: string | null;
  /** Para el refrigerio descontado: cuánto. */
  minutos: number | null;
};

const ORDEN: readonly ClaveDeDecision[] = [
  'refrigerio_del_turno',
  'sin_refrigerio',
  'faltan_horas',
  'salida_automatica',
  'salida_dudosa',
];

type Jornada = Pick<
  WorkSession,
  'id' | 'casos_resueltos' | 'casos_decision' | 'unpaid_break_minutes'
>;

/**
 * Las decisiones de esa jornada, en un orden fijo.
 *
 * El refrigerio descontado antes del 13-oct no dejó nota en la jornada: se reconoce por sus
 * dos fichajes, que el servidor guarda con un id fijo (`…_refrigerio_<jornada>_break_start`).
 * Un caso resuelto sin nota —de antes de que se guardara qué se decidió— sale igual, con
 * decisión desconocida: se puede cambiar aunque no se sepa qué se eligió.
 */
export function decisionesDeLaJornada(
  jornada: Jornada,
  eventos: readonly { id: string }[] = [],
): DecisionDeLaJornada[] {
  const notas = jornada.casos_decision ?? {};
  const resueltos = new Set<string>(jornada.casos_resueltos ?? []);
  const pausaPuesta = eventos.some((evento) =>
    evento.id.endsWith(`refrigerio_${jornada.id}_break_start`),
  );

  return ORDEN.flatMap((clave): DecisionDeLaJornada[] => {
    const nota = notas[clave];
    if (clave === 'refrigerio_del_turno') {
      if (nota === undefined && !pausaPuesta) return [];
      return [
        {
          clave,
          decision: 'applied',
          nota: null,
          minutos:
            nota?.minutos ??
            (jornada.unpaid_break_minutes > 0 ? jornada.unpaid_break_minutes : null),
        },
      ];
    }
    if (nota === undefined && !resueltos.has(clave)) return [];
    return [
      { clave, decision: nota?.decision ?? 'unknown', nota: nota?.nota ?? null, minutos: null },
    ];
  });
}

/** Cómo se dice cada decisión: el mismo texto en Horas y donde se enseñe. */
export function textoDeDecision(t: TFunction, decision: DecisionDeLaJornada): string {
  switch (decision.clave) {
    case 'refrigerio_del_turno':
      return decision.minutos === null
        ? t('timesheet.decisions.breakApplied')
        : t('timesheet.decisions.breakAppliedHours', { hours: duracion(t, decision.minutos) });
    case 'sin_refrigerio':
      return t('timesheet.decisions.workedThrough');
    case 'faltan_horas':
      return decision.decision === 'owes'
        ? t('timesheet.decisions.owes')
        : decision.decision === 'justified'
          ? t('timesheet.decisions.justified')
          : t('timesheet.decisions.shortDecided');
    case 'salida_automatica':
      return t('timesheet.decisions.autoExitOk');
    case 'salida_dudosa':
      return t('timesheet.decisions.longDayOk');
  }
}
