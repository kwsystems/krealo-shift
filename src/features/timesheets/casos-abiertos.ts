import { useMemo } from 'react';

import type { WorkSession } from './api';
import { casosPorResolver } from './casos';
import { aprobadasPorDia, claveDelDia, useHorasExtra } from './horas-extra';
import { useHorasDebidasDeLaSede } from './horas-debidas';
import { useWeekShifts } from '@/features/schedules/hooks';
import { addDaysToKey } from '@/features/schedules/week';

/**
 * QUÉ DÍAS TIENEN ALGO QUE DECIDIR (8-oct), por persona y día. Lo usan Horas y Equipo para
 * «Necesita revisión»: rojo es lo que tiene un caso abierto en «Por resolver», y nada más.
 *
 * Andree: «sigue saliendo eso y ya lo corregí, no se borró». Una «Entrada tardía» de nueve
 * minutos no abre caso —no le falta nada que deber—, así que no había botón que la quitara,
 * y seguía en rojo y en «Necesita revisión» para siempre. Lo mismo un «Sin turno» con la
 * hora extra ya aprobada. Ahora son un dato, en gris; Reportes y el bono los siguen contando.
 */
export function diasConCasoAbierto(
  casos: readonly { dia: string; sesion: { employee_id: string } }[],
): ReadonlySet<string> {
  return new Set(casos.map((caso) => claveDelDia(caso.sesion.employee_id, caso.dia)));
}

export function useDiasConCasoAbierto(params: {
  organizationId: string | null;
  locationId: string | null;
  weekStart: string;
  timezone: string;
  nowISO: string;
  sesiones: readonly WorkSession[];
  umbralExtra: number;
}): ReadonlySet<string> {
  const { organizationId, locationId, weekStart, timezone, nowISO, sesiones, umbralExtra } = params;
  const turnos = useWeekShifts({ organizationId, locationId, weekStart, timezone });
  const horasExtra = useHorasExtra({
    organizationId,
    locationId,
    from: weekStart,
    to: addDaysToKey(weekStart, 6),
  });
  const debidas = useHorasDebidasDeLaSede({ organizationId, locationId });
  return useMemo(
    () =>
      diasConCasoAbierto(
        casosPorResolver({
          sesiones,
          turnos: turnos.data ?? [],
          ahoraISO: nowISO,
          timezone,
          aprobadas: aprobadasPorDia(horasExtra.data ?? []),
          umbralExtra,
          debidas: debidas.data ?? [],
        }),
      ),
    [sesiones, turnos.data, nowISO, timezone, horasExtra.data, umbralExtra, debidas.data],
  );
}
