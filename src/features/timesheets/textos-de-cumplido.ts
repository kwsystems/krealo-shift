import type { TFunction } from 'i18next';

import { motivoDeCumplidoValido } from '@/domain/motivos-de-cumplido';

/**
 * CÓMO SE DICE UN TURNO CUMPLIDO POR UN MOTIVO ESPECIAL (4-oct), en UN sitio: Horario, Horas,
 * Equipo, Reportes y el celular lo escriben igual. Con una copia por pantalla, una diría
 * «Miembro de mesa» y otra «Cumplido» a secas, que es justo lo que Andree no quiere: «debe
 * verse en todas las vistas».
 */

/** «Miembro de mesa», o el texto genérico si el motivo es de un servidor más nuevo. */
export function motivoDeCumplido(t: TFunction, motivo: string | null): string {
  if (!motivoDeCumplidoValido(motivo)) return t('credit.reasonUnknown');
  switch (motivo) {
    case 'election_duty':
      return t('credit.reason.election_duty');
    case 'offsite_work':
      return t('credit.reason.offsite_work');
    case 'training':
      return t('credit.reason.training');
    case 'other':
      return t('credit.reason.other');
  }
}

/** «Cumplido · Miembro de mesa», con el comentario si lo hay. */
export function etiquetaDeCumplido(
  t: TFunction,
  jornada: { credit_reason: string | null; credit_note?: string | null },
  conNota = false,
): string {
  const base = t('credit.label', { reason: motivoDeCumplido(t, jornada.credit_reason) });
  const nota = jornada.credit_note ?? null;
  return conNota && nota !== null && nota.trim() !== '' ? `${base}: «${nota}»` : base;
}

/** Si una jornada es un cumplido especial: la llevan solo las que escribe `creditShiftAsWorked`. */
export function esCumplidoEspecial(jornada: { credit_reason?: string | null }): boolean {
  return typeof jornada.credit_reason === 'string' && jornada.credit_reason !== '';
}
