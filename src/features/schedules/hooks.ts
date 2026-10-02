import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  copyPreviousWeek,
  createShift,
  createShifts,
  duplicateShift,
  fetchPublications,
  fetchWeekRestDays,
  fetchWeekShifts,
  publishShifts,
  removeRestDay,
  removeShift,
  setRestDays,
  updateShift,
  type ShiftInput,
  type ShiftRow,
} from './api';
import {
  collectScheduleWarnings,
  scheduledMinutesByEmployee,
  shiftScheduledMinutes,
  type ScheduledShift,
  type ScheduleWarning,
} from './conflicts';
import { addDaysToKey, weekRangeInstants } from './week';
import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';
import { track } from '@/lib/analytics';
import { refrescarVistasDeHoras } from '@/hooks/refrescar-vistas';

/**
 * Estado del editor de horarios (§11.3).
 *
 * El borrador no vive en la app: cada turno se guarda en la base con estado
 * `draft` en cuanto se toca. Así "guarda automáticamente como borrador" es
 * literal y no se pierde nada si el iPad se bloquea a mitad de la semana.
 */

export const scheduleKeys = {
  week: (locationId: string, weekStart: string) =>
    ['schedule', 'week', locationId, weekStart] as const,
  publications: (locationId: string, weekStart: string) =>
    ['schedule', 'publications', locationId, weekStart] as const,
  restDays: (locationId: string, weekStart: string) =>
    ['schedule', 'restDays', locationId, weekStart] as const,
};

export function useWeekShifts(params: {
  organizationId: string | null;
  locationId: string | null;
  weekStart: string;
  timezone: string;
}) {
  const { organizationId, locationId, weekStart, timezone } = params;
  const range = useMemo(() => weekRangeInstants(weekStart, timezone), [weekStart, timezone]);

  return useQuery({
    queryKey: scheduleKeys.week(locationId ?? 'none', weekStart),
    queryFn: () =>
      fetchWeekShifts({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        fromISO: range.fromISO,
        toISO: range.toISO,
      }),
    enabled: locationId !== null && organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useWeekRestDays(params: {
  organizationId: string | null;
  locationId: string | null;
  weekStart: string;
}) {
  return useQuery({
    queryKey: scheduleKeys.restDays(params.locationId ?? 'none', params.weekStart),
    queryFn: () =>
      fetchWeekRestDays({
        organizationId: params.organizationId ?? '',
        locationId: params.locationId ?? '',
        fromKey: params.weekStart,
        toKey: addDaysToKey(params.weekStart, 6),
      }),
    enabled: params.locationId !== null && params.organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function usePublications(params: {
  organizationId: string | null;
  locationId: string | null;
  weekStart: string;
}) {
  return useQuery({
    queryKey: scheduleKeys.publications(params.locationId ?? 'none', params.weekStart),
    queryFn: () =>
      fetchPublications({
        organizationId: params.organizationId ?? '',
        locationId: params.locationId ?? '',
        weekStart: params.weekStart,
      }),
    enabled: params.locationId !== null && params.organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

/** Convierte filas de la base en la forma que entienden los cálculos puros. */
export function toScheduledShifts(rows: ShiftRow[], names: Map<string, string>): ScheduledShift[] {
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
  /** De ese total, lo que está en borrador: Inicio y Reportes cuentan solo lo publicado. */
  draftMinutes: number;
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
    draftMinutes: shifts
      .filter((shift) => shift.status === 'draft')
      .reduce((suma, shift) => suma + shiftScheduledMinutes(shift), 0),
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

  // Publicar o cambiar un turno cambia lo que Horas y Reportes dicen de ese día.
  const invalidate = () => refrescarVistasDeHoras(queryClient);

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

  const createMany = useMutation({
    mutationFn: (inputs: ShiftInput[]) =>
      createShifts({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        timezone,
        inputs,
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

  /*
   * DESCARTAR LOS BORRADORES DE LA SEMANA que nunca se publicaron (30-sep). Andree pegó dos
   * veces la misma semana y se quedó con 56 turnos encima unos de otros, y la única salida
   * era abrirlos y borrarlos de uno en uno. Solo los que NUNCA se publicaron: un borrador
   * con versión es el cambio de un turno que el equipo ya vio, y borrarlo lo quitaría del
   * horario sin avisar a nadie. De diez en diez, para no mandar 56 peticiones a la vez.
   */
  const discardDrafts = useMutation({
    mutationFn: async (shiftIds: string[]) => {
      for (let i = 0; i < shiftIds.length; i += 10) {
        await Promise.all(
          shiftIds.slice(i, i + 10).map((shiftId) => removeShift({ shiftId, status: 'draft' })),
        );
      }
      return shiftIds.length;
    },
    // También si falla a medias: la rejilla tiene que enseñar lo que de verdad quedó.
    onSettled: invalidate,
  });

  const markRestDays = useMutation({
    mutationFn: (days: { employeeId: string; dateKey: string }[]) =>
      setRestDays({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        days,
      }),
    onSuccess: invalidate,
  });

  const unmarkRestDay = useMutation({
    mutationFn: (variables: { restDayId: string }) => removeRestDay(variables),
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
    /*
     * §31 `schedule_published`, en `onSuccess` y no en `mutationFn`: publicar puede
     * fallar, y un evento "publicado" que se dispara antes de saberlo cuenta
     * publicaciones que no ocurrieron.
     *
     * `weekOffset` en semanas desde hoy, y no la fecha: la fecha de una semana concreta
     * junto al recuento de turnos empieza a describir a una tienda concreta, y §31 pide
     * medir producto, no espiar clientes. El desplazamiento contesta lo que interesa
     * —si se publica con antelación o a última hora— sin eso.
     */
    onSuccess: (_data, variables) => {
      track({
        name: 'schedule_published',
        shiftCount: variables.shiftIds.length,
        weekOffset: weeksFromToday(weekStart),
      });
      invalidate();
    },
  });

  return {
    create,
    createMany,
    update,
    duplicate,
    remove,
    discardDrafts,
    markRestDays,
    unmarkRestDay,
    copyWeek,
    publish,
  };
}

/**
 * Semanas de distancia entre hoy y el lunes de una semana, con signo.
 *
 * Para la analítica de §31: contesta si un horario se publica con antelación o a última
 * hora, sin enviar la fecha. Una fecha concreta junto al recuento de turnos empieza a
 * describir a una tienda concreta.
 */
function weeksFromToday(weekStart: string): number {
  const MS_POR_SEMANA = 7 * 24 * 60 * 60 * 1000;
  const inicio = Date.parse(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(inicio)) return 0;

  const hoy = new Date();
  const hoyUtc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Math.round((inicio - hoyUtc) / MS_POR_SEMANA);
}
