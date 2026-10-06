import type { TFunction } from 'i18next';

import es from '@/i18n/locales/es-PE.json';
import type { Falta } from '../faltas';
import { detalleDeCuentaDeFaltas, detalleDeFaltas } from '../textos-de-falta';

/**
 * La línea bajo el número de faltas (6-oct). La casilla de Reportes y su resumen la decían
 * cada uno a su manera en la misma pantalla, y la casilla se callaba las faltas revisadas
 * sin justificar. Un solo módulo: los tres estados, siempre en el mismo orden.
 */
/** Las claves de verdad, con plural y `{{x}}` sustituido: lo que pinta la pantalla. */
const t = ((clave: string, valores: Record<string, unknown> = {}) => {
  const buscar = (ruta: string) =>
    ruta
      .split('.')
      .reduce<unknown>((nodo, parte) => (nodo as Record<string, unknown> | undefined)?.[parte], es);
  const cuenta = valores.count;
  const texto =
    typeof cuenta === 'number'
      ? (buscar(`${clave}_${cuenta === 1 ? 'one' : 'other'}`) ?? buscar(clave))
      : buscar(clave);
  return String(texto ?? clave).replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    String(valores[k] ?? ''),
  );
}) as unknown as TFunction;

const falta = (resolucion: Falta['resolucion']): Pick<Falta, 'resolucion'> => ({ resolucion });
const revisada = (kind: 'justified' | 'unjustified') =>
  falta({ kind } as unknown as NonNullable<Falta['resolucion']>);

describe('la línea de las faltas', () => {
  it('dice los tres estados, primero lo que pide algo', () => {
    expect(detalleDeFaltas(t, [revisada('justified'), falta(null), revisada('unjustified')])).toBe(
      '1 sin revisar · 1 sin justificar · 1 justificada',
    );
  });

  it('las revisadas sin justificar ya no se callan', () => {
    expect(detalleDeFaltas(t, [revisada('unjustified'), revisada('unjustified')])).toBe(
      '2 sin justificar',
    );
  });

  it('sin faltas, nada: el número ya lo dice', () => {
    expect(detalleDeFaltas(t, [])).toBeUndefined();
  });

  it('desde las cuentas dice lo mismo que desde las faltas', () => {
    const faltas = [falta(null), falta(null), revisada('justified'), revisada('unjustified')];
    expect(detalleDeCuentaDeFaltas(t, { sinRevisar: 2, injustificadas: 1, justificadas: 1 })).toBe(
      detalleDeFaltas(t, faltas),
    );
  });
});
