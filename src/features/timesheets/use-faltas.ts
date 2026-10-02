import { useMemo } from 'react';

import { useInicioDelReloj } from '@/features/schedules/horario-cumplido';
import { useWeekShifts } from '@/features/schedules/hooks';
import { weekEnd, weekRangeInstants, type DateKey } from '@/features/schedules/week';

import { faltasDeLosTurnos, faltasPorPersona, type Falta } from './faltas';
import { useWorkSessions } from './hooks';

export type FaltasDeLaSemana = {
  faltas: Falta[];
  /** Ids de los turnos que son falta: para marcar la tarjeta en Horario. */
  porTurno: ReadonlySet<string>;
  porPersona: ReadonlyMap<string, Falta[]>;
};

/**
 * LAS FALTAS DE UNA SEMANA, para Horario, Horas y Equipo (1-oct).
 *
 * Con LAS MISMAS CONSULTAS Y CLAVES que ya usan esas pantallas —los turnos de Horario y las
 * jornadas de Horas—, así que no se pide nada dos veces y, sobre todo, se ve corregido en
 * las tres a la vez: un fichaje manual en Horas refresca esas jornadas, y con ellas la falta
 * desaparece de la tarjeta de Horario y de la fila de Equipo. La regla está en `faltas.ts`.
 */
export function useFaltasDeLaSemana(params: {
  organizationId: string | null;
  locationId: string | null;
  weekStart: DateKey;
  timezone: string;
  nowISO: string;
}): FaltasDeLaSemana {
  const { organizationId, locationId, weekStart, timezone, nowISO } = params;
  const rango = weekRangeInstants(weekStart, timezone);
  const turnos = useWeekShifts({ organizationId, locationId, weekStart, timezone });
  const jornadas = useWorkSessions({
    organizationId,
    locationId,
    fromISO: rango.fromISO,
    toISO: rango.toISO,
    cacheKey: { from: weekStart, to: weekEnd(weekStart) },
  });
  const relojDesde = useInicioDelReloj({
    organizationId,
    locationId,
    timezone,
    enabled: true,
  }).data;

  return useMemo(() => {
    // Sin las jornadas no se sabe quién vino: no se afirma ninguna falta.
    const faltas =
      jornadas.data === undefined
        ? []
        : faltasDeLosTurnos({
            turnos: turnos.data ?? [],
            jornadas: jornadas.data,
            relojDesde: () => relojDesde,
            ahoraISO: nowISO,
            timezone,
          });
    return {
      faltas,
      porTurno: new Set(faltas.map((falta) => falta.id)),
      porPersona: faltasPorPersona(faltas),
    };
  }, [turnos.data, jornadas.data, relojDesde, nowISO, timezone]);
}
