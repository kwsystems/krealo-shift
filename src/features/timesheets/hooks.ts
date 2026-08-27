import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addManualTimeEvent,
  adjustWorkSession,
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
        locationId: params.locationId ?? '',
        fromISO: params.fromISO,
        toISO: params.toISO,
      }),
    enabled: params.locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useTimeEvents(params: {
  employeeId: string | null;
  fromISO: string;
  toISO: string;
  cacheKey: string;
}) {
  return useQuery({
    queryKey: timesheetKeys.events(params.employeeId ?? 'none', params.cacheKey, params.cacheKey),
    queryFn: () =>
      fetchTimeEvents({
        employeeId: params.employeeId ?? '',
        fromISO: params.fromISO,
        toISO: params.toISO,
      }),
    enabled: params.employeeId !== null,
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
 * Totales del periodo. Las horas extra se separan por día contra el umbral
 * configurado y son informativas: la app resume tiempo, no calcula nómina (§13).
 */
export function computeTotals(
  summaries: DailySummary[],
  dailyThresholdMinutes: number,
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
    const split = splitRegularAndOvertime(day.net_minutes, dailyThresholdMinutes);
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
  dailyThresholdMinutes: number,
): TimesheetTotals {
  return useMemo(
    () => computeTotals(summaries, dailyThresholdMinutes),
    [summaries, dailyThresholdMinutes],
  );
}

export function useTimesheetMutations(params: {
  organizationId: string | null;
  locationId: string | null;
  from: string;
  to: string;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['timesheet'] });
    void queryClient.invalidateQueries({ queryKey: ['requests'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

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

  return { adjust, manualEntry, addEvent, approve, reopen };
}
