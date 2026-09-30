import type { BreakReason } from '@/domain/break-reason';
import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addManualTimeEvent,
  adjustWorkSession,
  reclassifyDeparture,
  approvePeriod,
  createManualEntryRequest,
  ensurePeriod,
  fetchAdjustments,
  fetchDailySummaries,
  fetchPeriod,
  fetchTimeEvents,
  fetchWorkSessions,
  reopenPeriod,
  type DailySummary,
  type ManualEntryKind,
} from './api';
import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';
import { splitRegularAndOvertime } from '@/utils/time';
import { claveDelDia } from './horas-extra';
import { refrescarVistasDeHoras } from '@/hooks/refrescar-vistas';

/** Hooks de horas y hojas de tiempo (§11.4). */

export const timesheetKeys = {
  summaries: (locationId: string, from: string, to: string) =>
    ['timesheet', 'summaries', locationId, from, to] as const,
  sessions: (locationId: string, from: string, to: string) =>
    ['timesheet', 'sessions', locationId, from, to] as const,
  events: (employeeId: string, from: string, to: string) =>
    ['timesheet', 'events', employeeId, from, to] as const,
  adjustments: (sessionIds: string[]) => ['timesheet', 'adjustments', ...sessionIds] as const,
  period: (locationId: string, from: string, to: string) =>
    ['timesheet', 'period', locationId, from, to] as const,
};

export function useDailySummaries(params: { locationId: string | null; from: string; to: string }) {
  return useQuery({
    queryKey: timesheetKeys.summaries(params.locationId ?? 'none', params.from, params.to),
    queryFn: () =>
      fetchDailySummaries({
        locationId: params.locationId ?? '',
        from: params.from,
        to: params.to,
      }),
    enabled: params.locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useWorkSessions(params: {
  organizationId: string | null;
  locationId: string | null;
  fromISO: string;
  toISO: string;
  cacheKey: { from: string; to: string };
}) {
  return useQuery({
    queryKey: timesheetKeys.sessions(
      params.locationId ?? 'none',
      params.cacheKey.from,
      params.cacheKey.to,
    ),
    queryFn: () =>
      fetchWorkSessions({
        organizationId: params.organizationId ?? '',
        locationId: params.locationId ?? '',
        fromISO: params.fromISO,
        toISO: params.toISO,
      }),
    enabled: params.locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

/**
 * LAS SESIONES SE VUELVEN A PEDIR CUANDO CAMBIA QUIÉN ESTÁ DENTRO.
 *
 * «Quién está dentro» se consulta cada minuto; las sesiones y los resúmenes no. Así que
 * al marcar alguien su salida, la fila seguía abierta en la caché y Horas seguía
 * diciendo «Trabajando · en curso» de quien ya se había ido, hasta recargar. Lo mismo al
 * volver del refrigerio: el descanso recién cerrado no se descontaba.
 *
 * En vez de pedir la semana entera cada minuto, se pide SOLO cuando algo cambia: una
 * entrada, una salida, un descanso que empieza o acaba. Cada uno de esos cambia la firma
 * de abajo, y es justo cuando las horas cambian.
 *
 * El primer resultado no dispara nada: es la foto inicial, no un cambio. Y cambiar de
 * sede tampoco, porque es otra sede y no un cambio en esta.
 */
export function useSesionesAlDiaCon(
  locationId: string | null,
  filas: readonly { work_session_id: string; attendance_state: string }[] | undefined,
) {
  const queryClient = useQueryClient();
  const firma =
    filas === undefined
      ? null
      : filas
          .map((fila) => `${fila.work_session_id}:${fila.attendance_state}`)
          .sort()
          .join('|');
  const anterior = useRef<{ locationId: string; firma: string } | null>(null);

  useEffect(() => {
    if (firma === null || locationId === null) return;
    const antes = anterior.current;
    anterior.current = { locationId, firma };
    if (antes === null || antes.locationId !== locationId || antes.firma === firma) return;
    void queryClient.invalidateQueries({ queryKey: ['timesheet', 'sessions', locationId] });
    void queryClient.invalidateQueries({ queryKey: ['timesheet', 'summaries', locationId] });
  }, [firma, locationId, queryClient]);
}

export function useTimeEvents(params: {
  organizationId: string | null;
  employeeId: string | null;
  fromISO: string;
  toISO: string;
  cacheKey: string;
}) {
  return useQuery({
    queryKey: timesheetKeys.events(params.employeeId ?? 'none', params.cacheKey, params.cacheKey),
    queryFn: () =>
      fetchTimeEvents({
        organizationId: params.organizationId ?? '',
        employeeId: params.employeeId ?? '',
        fromISO: params.fromISO,
        toISO: params.toISO,
      }),
    enabled: params.employeeId !== null && params.organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useAdjustments(sessionIds: string[]) {
  return useQuery({
    queryKey: timesheetKeys.adjustments(sessionIds),
    queryFn: () => fetchAdjustments(sessionIds),
    enabled: sessionIds.length > 0,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function usePeriod(params: {
  organizationId: string | null;
  locationId: string | null;
  from: string;
  to: string;
}) {
  return useQuery({
    queryKey: timesheetKeys.period(params.locationId ?? 'none', params.from, params.to),
    queryFn: () =>
      fetchPeriod({
        organizationId: params.organizationId ?? '',
        locationId: params.locationId ?? '',
        from: params.from,
        to: params.to,
      }),
    enabled: params.organizationId !== null && params.locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export type TimesheetTotals = {
  netMinutes: number;
  grossMinutes: number;
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  needsReviewDays: number;
};

/**
 * Totales del periodo. Las horas extra son las APROBADAS de cada persona y día (ver
 * `horas-extra.ts`) y son informativas: la app resume tiempo, no calcula nómina (§13).
 */
export function computeTotals(
  summaries: DailySummary[],
  aprobadas: ReadonlyMap<string, number>,
): TimesheetTotals {
  const totals: TimesheetTotals = {
    netMinutes: 0,
    grossMinutes: 0,
    paidBreakMinutes: 0,
    unpaidBreakMinutes: 0,
    regularMinutes: 0,
    overtimeMinutes: 0,
    needsReviewDays: 0,
  };

  for (const day of summaries) {
    const split = splitRegularAndOvertime(
      day.net_minutes,
      aprobadas.get(claveDelDia(day.employee_id, day.work_date)) ?? 0,
    );
    totals.netMinutes += day.net_minutes;
    totals.grossMinutes += day.gross_minutes;
    totals.paidBreakMinutes += day.paid_break_minutes;
    totals.unpaidBreakMinutes += day.unpaid_break_minutes;
    totals.regularMinutes += split.regularMinutes;
    totals.overtimeMinutes += split.overtimeMinutes;
    if (day.needs_review === true) totals.needsReviewDays += 1;
  }

  return totals;
}

export function useTimesheetTotals(
  summaries: DailySummary[],
  aprobadas: ReadonlyMap<string, number>,
): TimesheetTotals {
  return useMemo(() => computeTotals(summaries, aprobadas), [summaries, aprobadas]);
}

export function useTimesheetMutations(params: {
  organizationId: string | null;
  locationId: string | null;
  from: string;
  to: string;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => refrescarVistasDeHoras(queryClient);

  const adjust = useMutation({
    mutationFn: (variables: {
      workSessionId: string;
      expectedUpdatedAt: string | null;
      newStartsAt: string | null;
      newEndsAt: string | null;
      reason: string;
    }) => adjustWorkSession(variables),
    onSuccess: invalidate,
  });

  const manualEntry = useMutation({
    mutationFn: (variables: {
      employeeId: string;
      kind: ManualEntryKind;
      targetDate: string;
      proposedAt: string | null;
      proposedEndAt: string | null;
      reason: string;
      workSessionId?: string | null;
    }) =>
      createManualEntryRequest({
        organizationId: params.organizationId ?? '',
        locationId: params.locationId ?? '',
        ...variables,
      }),
    onSuccess: invalidate,
  });

  /**
   * Fichaje manual DIRECTO (§11.4). Distinto de `manualEntry`, que crea una
   * solicitud para que alguien la revise.
   *
   * Se usa cuando el gerente sabe qué pasó y actúa él: "se le olvidó marcar la
   * salida, se fue a casa, y hay que dejar la jornada cuadrada hoy". El servidor
   * valida permiso, empresa, ubicación, motivo, que la hora no esté en el futuro y
   * que la transición encaje con el estado del empleado en ESE instante.
   */
  const addEvent = useMutation({
    mutationFn: (variables: {
      employeeId: string;
      eventType: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
      occurredAt: string;
      reason: string;
    }) =>
      addManualTimeEvent({
        locationId: params.locationId ?? '',
        ...variables,
      }),
    onSuccess: invalidate,
  });

  const approve = useMutation({
    mutationFn: async () => {
      const period = await ensurePeriod({
        organizationId: params.organizationId ?? '',
        locationId: params.locationId ?? '',
        from: params.from,
        to: params.to,
      });
      await approvePeriod(period.id);
    },
    onSuccess: invalidate,
  });

  const reopen = useMutation({
    mutationFn: (variables: { periodId: string }) => reopenPeriod(variables.periodId),
    onSuccess: invalidate,
  });

  const reclassify = useMutation({
    mutationFn: (variables: { eventId: string; breakReason: BreakReason; reason: string }) =>
      reclassifyDeparture(variables),
    onSuccess: invalidate,
  });

  return { adjust, manualEntry, addEvent, approve, reopen, reclassify };
}
