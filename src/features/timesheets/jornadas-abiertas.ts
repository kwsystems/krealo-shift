import { useQuery } from '@tanstack/react-query';

import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';

import { fetchOpenWorkSessions, type WorkSession } from './api';

/**
 * LAS JORNADAS ABIERTAS, AUNQUE SEAN DE OTRA SEMANA (auditoría, 4-oct).
 *
 * «Por resolver» en Horas y «fichajes sin cerrar» en Inicio miraban solo las jornadas de la
 * semana. Una salida olvidada el sábado desaparecía de las dos el lunes —solo se veía
 * volviendo a la semana anterior—, aunque el reloj seguía viendo a la persona dentro y su
 * jornada seguía contando. Las dos pantallas suman ahora las abiertas de la sede con la
 * misma función, para que no puedan decir cosas distintas de la misma jornada.
 *
 * LA CLAVE CUELGA DE `timesheet`: cerrar una jornada desde Horas la quita de aquí con todo
 * lo demás (`refrescarVistasDeHoras`).
 */
export function useJornadasAbiertas(params: {
  organizationId: string | null;
  locationId: string | null;
  /** Inicio la refresca sola cada tanto; Horas, al resolver un caso. */
  refetchInterval?: number;
}) {
  return useQuery({
    queryKey: ['timesheet', 'abiertas', params.locationId ?? 'none'],
    queryFn: () =>
      fetchOpenWorkSessions({
        organizationId: params.organizationId ?? '',
        locationId: params.locationId ?? '',
      }),
    enabled: params.organizationId !== null && params.locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
    refetchInterval: params.refetchInterval,
  });
}

/**
 * Las jornadas de un periodo más las abiertas que empezaron antes de que acabe: sin
 * repetir ninguna y por hora de entrada. Las que empezaron después no son del periodo.
 */
export function conLasAbiertas(
  delPeriodo: readonly WorkSession[],
  abiertas: readonly WorkSession[] | undefined,
  hastaISO: string,
): WorkSession[] {
  const ids = new Set(delPeriodo.map((sesion) => sesion.id));
  const extra = (abiertas ?? []).filter(
    (sesion) => !ids.has(sesion.id) && sesion.ends_at === null && sesion.starts_at < hastaISO,
  );
  if (extra.length === 0) return [...delPeriodo];
  return [...delPeriodo, ...extra].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
