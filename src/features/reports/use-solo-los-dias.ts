import { useMemo } from 'react';

import { dateKeyOf } from '@/features/schedules/week';

import { soloLosDias } from './periodo';

/**
 * LAS FILAS DE LOS DÍAS ELEGIDOS, como hooks y no como `useMemo` en la pantalla.
 *
 * En la pantalla, el React Compiler no podía conservar esos memos: `dias` sale del
 * periodo, y el periodo es un objeto que la pantalla pasa luego a otras funciones, así que
 * desde fuera no puede probar que nadie lo cambie. Ante la duda se rendía con el
 * componente ENTERO (`react-hooks/preserve-manual-memoization`). Aquí `dias` llega como
 * argumento, y lo que devuelve un hook el compilador ya sabe que no se toca.
 */

/** Filas con `work_date`: resúmenes, pausas, correcciones. */
export function useSoloLosDias<T extends { work_date: string }>(
  filas: readonly T[] | undefined,
  dias: string | null,
): T[] {
  return useMemo(() => soloLosDias(filas ?? [], dias, (fila) => fila.work_date), [filas, dias]);
}

/** Jornadas: su día es el de la entrada, en la zona de la sede —el mismo que usa Horas—. */
export function useSesionesDeLosDias<T extends { starts_at: string }>(
  filas: readonly T[] | undefined,
  dias: string | null,
  timezone: string,
): T[] {
  return useMemo(
    () => soloLosDias(filas ?? [], dias, (fila) => dateKeyOf(fila.starts_at, timezone)),
    [filas, dias, timezone],
  );
}
