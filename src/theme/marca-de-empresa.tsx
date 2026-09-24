import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { rampaDeMarca } from '@/domain/marca';
import type { ColorSet } from './tokens';

/**
 * EL COLOR DE LA EMPRESA, INYECTADO EN EL TEMA.
 *
 * VA POR CONTEXTO Y NO POR PARÁMETRO DE `useTheme`, y la razón es que `useTheme` se llama
 * en unos cuarenta sitios: pasarle el color en cada uno sería cuarenta oportunidades de
 * olvidarse en uno, y ese uno se quedaría pintando el violeta de fábrica en mitad de una
 * pantalla de otro color. Con contexto, quien no sepa nada de marcas sigue funcionando y
 * hereda la correcta.
 *
 * POR DEFECTO NO HAY COLOR, y eso importa más que parezca: sin empresa que lo ponga —o con
 * una que no lo haya elegido— el juego de color es EXACTAMENTE el de siempre, el mismo
 * objeto, sin derivar nada. O sea que esta función no puede estropear a quien no la use.
 *
 * SE SUSTITUYE LA FAMILIA ENTERA, seis escalones, y no los tres que llevan promesa de
 * contraste. La primera versión cambiaba tres, y la captura la desmintió: con una marca
 * fucsia la pestaña activa salía con el texto fucsia y la píldora lavanda, porque usa otro
 * escalón, y con ella la tecla pulsada del teclado del reloj, los chips y el interruptor.
 * Media pantalla del color de la empresa y media del violeta de fábrica se ve peor que no
 * tener marca.
 */

const ContextoDeMarca = createContext<string | null>(null);

export function ProveedorDeMarca({
  color,
  children,
}: {
  /** El hex elegido por la empresa, o `null` si no ha elegido ninguno. */
  color: string | null;
  children: ReactNode;
}) {
  return <ContextoDeMarca.Provider value={color}>{children}</ContextoDeMarca.Provider>;
}

export function useColorDeMarca(): string | null {
  return useContext(ContextoDeMarca);
}

/**
 * El juego de color con el acento de la empresa dentro.
 *
 * SE MEMORIZA porque derivar la rampa hace dos búsquedas binarias de dieciocho pasos, y
 * esto se llama en cada render de cada componente que pinta algo. Sin memorizar sería la
 * misma cuenta cientos de veces por segundo para un resultado que solo cambia cuando la
 * empresa cambia de color, o sea casi nunca.
 */
export function useColoresConMarca(base: ColorSet, color: string | null): ColorSet {
  return useMemo(() => {
    if (color === null) return base;
    const veredicto = rampaDeMarca(color, base.surface, {
      trabajando: base.success600,
      pausa: base.warning600,
      tarde: base.danger600,
    });
    // Un color inválido guardado en la base no puede dejar la app sin tema: se ignora.
    if (veredicto === null) return base;
    return {
      ...base,
      primary50: veredicto.rampa.p50,
      primary100: veredicto.rampa.p100,
      primary200: veredicto.rampa.p200,
      primary500: veredicto.rampa.p500,
      primary600: veredicto.rampa.p600,
      primary700: veredicto.rampa.p700,
    };
  }, [base, color]);
}
