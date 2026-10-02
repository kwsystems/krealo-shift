/**
 * POR QUÉ FALTÓ ALGUIEN (2-oct). Lo comparten la app y el servidor, como los motivos de
 * pausa: si cada uno tuviera su lista, el servidor rechazaría un motivo que la app ofrece.
 *
 * Andree: «si faltó no solo debería haber esa opción… poner por qué faltó, si tiene
 * justificación o no, médico o lo que sea». Dos cosas, en el orden en que se deciden:
 *
 *   1. ¿JUSTIFICADA O NO? Es lo que cambia algo: una falta justificada no le quita el
 *      bono de asistencia (ver `features/reports/bono.ts`). Las dos siguen siendo faltas
 *      —no hubo horas— y las dos se cuentan, cada una con su nombre.
 *   2. ¿POR QUÉ? Unos pocos motivos fijos, para que Reportes pueda contarlos, y «Otro»,
 *      que pide escribir qué pasó.
 *
 * Una falta que nadie ha mirado todavía no tiene ninguna de las dos: es «sin revisar», y
 * para el bono cuenta como sin justificar, que es lo que es mientras nadie diga otra cosa.
 */

export const TIPOS_DE_FALTA = ['justified', 'unjustified'] as const;
export type TipoDeFalta = (typeof TIPOS_DE_FALTA)[number];

export const MOTIVOS_JUSTIFICADOS = ['medical', 'family', 'permission', 'other'] as const;
export const MOTIVOS_SIN_JUSTIFICAR = ['no_notice', 'late_notice', 'other'] as const;
export type MotivoDeFalta =
  (typeof MOTIVOS_JUSTIFICADOS)[number] | (typeof MOTIVOS_SIN_JUSTIFICAR)[number];

export const NOTA_MAXIMA_DE_FALTA = 280;

/** Los motivos que tiene cada tipo, en el orden en que se ofrecen. */
export function motivosDe(tipo: TipoDeFalta): readonly MotivoDeFalta[] {
  return tipo === 'justified' ? MOTIVOS_JUSTIFICADOS : MOTIVOS_SIN_JUSTIFICAR;
}

/** Si ese motivo vale para ese tipo: «no avisó» no puede ser una falta justificada. */
export function motivoValido(tipo: unknown, motivo: unknown): boolean {
  if (tipo !== 'justified' && tipo !== 'unjustified') return false;
  return (motivosDe(tipo) as readonly unknown[]).includes(motivo);
}
