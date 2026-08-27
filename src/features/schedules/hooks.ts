import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  copyPreviousWeek,
  createShift,
  duplicateShift,
  fetchPublications,
  fetchWeekShifts,
  publishShifts,
  removeShift,
  updateShift,
  type ShiftInput,
  type ShiftRow,
} from './api';
import {
  collectScheduleWarnings,
  scheduledMinutesByEmployee,
  type ScheduledShift,
  type ScheduleWarning,
} from './conflicts';
import { weekRangeInstants } from './week';
import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';

/**
 * Estado del editor de horarios (§11.3).
 *
 * El borrador no vive en la app: cada turno se guarda en la base con estado
 * `draft` en cuanto se toca. Así "guarda automáticamente como borrador" es
 * literal y no se pierde nada si el iPad se bloquea a mitad de la semana.
 */

export const scheduleKeys = {
  week: (locationId: string, weekStart: string) => ['schedule', 'week', locationId, weekStart] as const,
  publications: (locationId: string, weekStart: string) =>
    ['schedule', 'publications', locationId, weekStart] as const,
};

export function useWeekShifts(params: {
  locationId: string | null;
  weekStart: string;
  timezone: string;
}) {
  const { locationId, weekStart, timezone } = params;
  const range = useMemo(() => weekRangeInstants(weekStart, timezone), [weekStart, timezone]);

  return useQuery({
    queryKey: scheduleKeys.week(locationId ?? 'none', weekStart),
    queryFn: () =>
      fetchWeekShifts({
        locationId: locationId ?? '',
        fromISO: range.fromISO,
        toISO: range.toISO,
      }),
    enabled: locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function usePublications(params: { locationId: string | null; weekStart: string }) {
  return useQuery({
    queryKey: scheduleKeys.publications(params.locationId ?? 'none', params.weekStart),
    queryFn: () =>
      fetchPublications({ locationId: params.locationId ?? '', weekStart: params.weekStart }),
    enabled: params.locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

/** Convierte filas de la base en la forma que entienden los cálculos puros. */
export function toScheduledShifts(
  rows: ShiftRow[],
  names: Map<string, string>,
): ScheduledShift[] {
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    employeeName: names.get(row.employee_id) ?? '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    plannedUnpaidBreakMinutes: row.planned_unpaid_break_minutes,
    status: row.status,
  }));
}

export type WeekAnalysis = {
  warnings: ScheduleWarning[];
  minutesByEmployee: Map<string, number>;
  totalMinutes: number;
  pendingShiftIds: string[];
};

export function analyzeWeek(params: {
  shifts: ScheduledShift[];
  minimumRestMinutes: number;
  weeklyLimitMinutes: number;
}): WeekAnalysis {
  const { shifts, minimumRestMinutes, weeklyLimitMinutes } = params;
  const minutesByEmployee = scheduledMinutesByEmployee(shifts);

  let totalMinutes = 0;
  for (const minutes of minutesByEmployee.values()) totalMinutes += minutes;

  return {
    warnings: collectScheduleWarnings(shifts, { minimumRestMinutes, weeklyLimitMinutes }),
    minutesByEmployee,
    totalMinutes,
    // Lo pendiente de publicar es exactamente lo que está en borrador (§11.3).
    pendingShiftIds: shifts.filter((shift) => shift.status === 'draft').map((shift) => shift.id),
  };
}

export function useScheduleMutations(params: {
  organizationId: string | null;
  locationId: string | null;
  timezone: string;
  weekStart: string;
}) {
  const { organizationId, locationId, timezone, weekStart } = params;
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['schedule'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const create = useMutation({
    mutationFn: (input: ShiftInput) =>
      createShift({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        timezone,
        input,
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (variables: { shiftId: string; input: ShiftInput }) =>
      updateShift({
        shiftId: variables.shiftId,
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        timezone,
        input: variables.input,
      }),
    onSuccess: invalidate,
  });

  const duplicate = useMutation({
    mutationFn: (variables: { shift: ShiftRow; dateKey?: string }) =>
      duplicateShift({
        organizationId: organizationId ?? '',
        shift: variables.shift,
        timezone,
        dateKey: variables.dateKey,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (variables: { shiftId: string; status: string }) => removeShift(variables),
    onSuccess: invalidate,
  });

  const copyWeek = useMutation({
    mutationFn: (variables: { employeeId?: string | null }) =>
      copyPreviousWeek({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        timezone,
        targetWeekStart: weekStart,
        employeeId: variables.employeeId ?? null,
      }),
    onSuccess: invalidate,
  });

  const publish = useMutation({
    mutationFn: (variables: { shiftIds: string[] }) =>
      publishShifts({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        weekStart,
        shiftIds: variables.shiftIds,
      }),
    onSuccess: invalidate,
  });

  return { create, update, duplicate, remove, copyWeek, publish };
}
