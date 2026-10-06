import type { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';

import type { MotivoDeFalta } from '@/domain/motivos-de-falta';
import type { StatusTone } from '@/theme/tokens';

import { contarFaltas, estadoDeFalta, type EstadoDeFalta, type Falta } from './faltas';
import type { ResolucionDeFalta } from './justificaciones';

/**
 * CÓMO SE DICE UNA FALTA, igual en todas las pantallas (2-oct): «Sin revisar»,
 * «Justificada · Descanso médico», «Sin justificar · No avisó». Con una sola función, la
 * tarjeta de Horario, la fila de Equipo, Reportes y el celular no pueden llamarla distinto.
 *
 * EL TONO: rojo lo que cuenta en contra —sin justificar o sin revisar—, ámbar lo
 * justificado. Ámbar y no verde: sigue siendo una falta, no algo que salió bien. Es el
 * ámbar de `warning` y no el de `onBreak`, que es el mismo color pero habla de descansos.
 *
 * EL ICONO va con el texto para que el estado no sea solo color: una interrogación lo que
 * falta revisar, un documento lo justificado, una cruz lo que no.
 */

export function motivoDeFalta(t: TFunction, motivo: MotivoDeFalta): string {
  return t(`absence.reason.${motivo}`);
}

export function estadoLegible(t: TFunction, estado: EstadoDeFalta): string {
  return t(`absence.state.${estado}`);
}

export function etiquetaDeFalta(
  t: TFunction,
  falta: Pick<Falta, 'resolucion'> | { resolucion: ResolucionDeFalta | null },
): string {
  const estado = estadoDeFalta(falta);
  if (falta.resolucion === null) return estadoLegible(t, estado);
  return `${estadoLegible(t, estado)} · ${motivoDeFalta(t, falta.resolucion.reason)}`;
}

export function tonoDeFalta(falta: Pick<Falta, 'resolucion'>): StatusTone {
  return estadoDeFalta(falta) === 'justificada' ? 'warning' : 'late';
}

const ICONOS: Record<EstadoDeFalta, keyof typeof Ionicons.glyphMap> = {
  sinRevisar: 'help-circle-outline',
  justificada: 'document-text-outline',
  injustificada: 'close-circle-outline',
};

export function iconoDeFalta(falta: Pick<Falta, 'resolucion'>): keyof typeof Ionicons.glyphMap {
  return ICONOS[estadoDeFalta(falta)];
}

/**
 * La línea pequeña bajo el número de faltas, igual en Horas, Equipo y Reportes: «2 sin
 * revisar · 1 sin justificar · 1 justificada». Sin ninguna, nada: el número ya lo dice todo.
 *
 * LOS TRES ESTADOS, SIEMPRE EN ESTE ORDEN (6-oct). Esta línea decía solo justificadas y sin
 * revisar, así que con tres faltas —una de cada— se leía «1 justificada · 1 sin revisar» bajo
 * un 3; y el resumen de Reportes tenía su propia copia, con los tres estados y en otro orden,
 * en la misma pantalla. Ahora los dos salen de aquí. Primero lo que pide algo.
 */
export function detalleDeCuentaDeFaltas(
  t: TFunction,
  cuenta: {
    sinRevisar: number;
    /** Revisadas y sin justificar: cuentan en contra, pero ya no piden nada. */
    injustificadas: number;
    justificadas: number;
  },
): string | undefined {
  const partes = [
    cuenta.sinRevisar > 0 ? t('absence.pendingCount', { count: cuenta.sinRevisar }) : null,
    cuenta.injustificadas > 0
      ? t('absence.unjustifiedCount', { count: cuenta.injustificadas })
      : null,
    cuenta.justificadas > 0 ? t('absence.justifiedCount', { count: cuenta.justificadas }) : null,
  ].filter((parte): parte is string => parte !== null);
  return partes.length === 0 ? undefined : partes.join(' · ');
}

export function detalleDeFaltas(
  t: TFunction,
  faltas: readonly Pick<Falta, 'resolucion'>[],
): string | undefined {
  const cuenta = contarFaltas(faltas);
  return detalleDeCuentaDeFaltas(t, {
    sinRevisar: cuenta.sinRevisar,
    injustificadas: cuenta.sinJustificar - cuenta.sinRevisar,
    justificadas: cuenta.justificadas,
  });
}

/** Rojo si alguna cuenta en contra; ámbar si todas están justificadas; nada si no hay. */
export function tonoDelTotalDeFaltas(
  faltas: readonly Pick<Falta, 'resolucion'>[],
): StatusTone | undefined {
  const cuenta = contarFaltas(faltas);
  if (cuenta.total === 0) return undefined;
  return cuenta.sinJustificar > 0 ? 'late' : 'warning';
}

/**
 * Lo que dice la tarjeta del turno en Horario: «Falta · no marcó» mientras nadie la revisa,
 * y después «Falta justificada · Descanso médico» o «Falta sin justificar · No avisó».
 */
export function rotuloDeFaltaEnTurno(t: TFunction, falta: Pick<Falta, 'resolucion'>): string {
  if (falta.resolucion === null) return t('schedule.absent');
  const motivo = motivoDeFalta(t, falta.resolucion.reason);
  return falta.resolucion.kind === 'justified'
    ? t('schedule.absentJustified', { reason: motivo })
    : t('schedule.absentUnjustified', { reason: motivo });
}
