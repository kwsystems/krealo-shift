import { useMemo } from 'react';

import { useInicioDelReloj } from '@/features/schedules/horario-cumplido';
import { useWeekShifts } from '@/features/schedules/hooks';
import { weekEnd, weekRangeInstants, type DateKey } from '@/features/schedules/week';

import { faltasDeLosTurnos, faltasPorPersona, turnoSinLlegar, type Falta } from './faltas';
import { useWorkSessions } from './hooks';
import { useJustificaciones } from './justificaciones';

export type FaltasDeLaSemana = {
  faltas: Falta[];
  /** Las faltas por id de turno: para marcar la tarjeta en Horario con su estado. */
  porTurno: ReadonlyMap<string, Falta>;
  porPersona: ReadonlyMap<string, Falta[]>;
  /**
   * Los turnos en curso de quien todavía no ha llegado (2-oct): ver `turnoSinLlegar`. Lo
   * pinta la tarjeta de Horario; Inicio lo cuenta con la misma regla.
   */
  sinLlegar: ReadonlySet<string>;
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
  /** La tolerancia de la sede para llegar tarde: lo que se espera antes de «no ha llegado». */
  toleranciaMin?: number;
}): FaltasDeLaSemana {
  const { organizationId, locationId, weekStart, timezone, nowISO } = params;
  const toleranciaMin = params.toleranciaMin ?? 0;
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
  // Lo que se dijo de cada falta: la misma consulta en Horas, Horario, Equipo y Reportes.
  const justificaciones = useJustificaciones(organizationId, locationId);

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
            resoluciones: justificaciones.data ?? [],
          });
    // Igual que las faltas: sin las jornadas no se sabe quién vino, y no se afirma nada.
    const sinLlegar = new Set(
      jornadas.data === undefined
        ? []
        : (turnos.data ?? [])
            .filter((turno) =>
              turnoSinLlegar({ turno, jornadas: jornadas.data, ahoraISO: nowISO, toleranciaMin }),
            )
            .map((turno) => turno.id),
    );
    return {
      faltas,
      porTurno: new Map(faltas.map((falta) => [falta.id, falta])),
      porPersona: faltasPorPersona(faltas),
      sinLlegar,
    };
  }, [
    turnos.data,
    jornadas.data,
    relojDesde,
    nowISO,
    timezone,
    justificaciones.data,
    toleranciaMin,
  ]);
}
