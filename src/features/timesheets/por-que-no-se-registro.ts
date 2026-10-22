import type { TFunction } from 'i18next';

import { adminErrorKind } from '@/hooks/use-admin-query';

/**
 * POR QUÉ NO SE REGISTRARON LAS HORAS de «Vino y no marcó», en palabras (22-oct).
 *
 * La hoja decía siempre «No se pudo registrar. Revisa las horas», también cuando las horas
 * estaban bien y el servidor había dicho el motivo exacto —«Ya figura dentro desde el 21/10
 * a las 10:02…», «Esa persona no trabaja en esta sede», «Esa hora todavía no llegó»—. Andree
 * lo vio con la entrada de una vendedora y no tenía por dónde seguir.
 *
 * Lo dice el servidor, que lo escribe en frases. Solo se cambia por un texto propio lo que no
 * es una frase —un código como `UNEXPECTED_SHAPE`, un `internal`— o la falta de red.
 */
export function porQueNoSeRegistro(t: TFunction, error: unknown): string {
  if (adminErrorKind(error) === 'offline') return t('errors.network');
  const mensaje = error instanceof Error ? error.message.trim() : '';
  if (mensaje.includes(' ') && !/^(internal|unknown)\b/i.test(mensaje)) return mensaje;
  return t('timesheet.absences.failed');
}
