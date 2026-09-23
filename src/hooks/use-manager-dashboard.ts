import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { docId } from '@/lib/firebase/ids';

import { countPendingRequests } from '@/features/requests/api';
import { fetchWeekShifts } from '@/features/schedules/api';
import { currentWeekStart, dateKeyOf, weekRangeInstants } from '@/features/schedules/week';
import { shiftScheduledMinutes } from '@/features/schedules/conflicts';
import { fetchWorkSessions } from '@/features/timesheets/api';
import { ADMIN_LIST_STALE_MS, DASHBOARD_POLL_MS, selectRows } from '@/hooks/use-admin-query';
import { useNetworkStore } from '@/stores/network-store';
import { minutesBetween } from '@/utils/time';
import { VIEWS } from '@/lib/firebase/tables';

/**
 * Inicio administrativo (§11.1).
 *
 * Funciona con sondeo y caché por diseño: Realtime puede adelantar la
 * actualización, pero si Realtime falla la pantalla sigue viva porque el sondeo
 * no depende de él. Cada tarjeta se calcula a partir de datos que ya existen en
 * la base; ninguna cifra está inventada.
 */

const workingNowSchema = z.object({
  work_session_id: docId(),
  employee_id: docId(),
  full_name: z.string(),
  preferred_name: z.string().nullable(),
  starts_at: z.string(),
  shift_id: docId().nullable(),
  break_started_at: z.string().nullable(),
  attendance_state: z.enum(['WORKING', 'ON_BREAK']),
});

export type WorkingNowRow = z.infer<typeof workingNowSchema>;

async function fetchWorkingNow(locationId: string): Promise<WorkingNowRow[]> {
  return selectRows(z.array(workingNowSchema), (db) =>
    db
      .from(VIEWS.employeesWorkingNow)
      .select(
        'work_session_id, employee_id, full_name, preferred_name, starts_at, shift_id, break_started_at, attendance_state',
      )
      .eq('location_id', locationId)
      .order('starts_at', { ascending: true }),
  );
}

export const dashboardKeys = {
  workingNow: (locationId: string) => ['dashboard', 'workingNow', locationId] as const,
  weekShifts: (locationId: string, weekStart: string) =>
    ['dashboard', 'weekShifts', locationId, weekStart] as const,
  weekSessions: (locationId: string, weekStart: string) =>
    ['dashboard', 'weekSessions', locationId, weekStart] as const,
  pendingRequests: (locationId: string) => ['dashboard', 'pendingRequests', locationId] as const,
};

/**
 * Una fila de la franja del día: quién, su turno y lo que de verdad fichó.
 *
 * Se calcula aquí, junto a los contadores, PORQUE SALE DE LOS MISMOS DATOS que ya están
 * cargados —los turnos de la semana y las sesiones de la semana— y calcularlo en la
 * pantalla obligaría a repetir el filtrado por día y por sede en otro sitio. Dos copias de
 * una regla de fecha es exactamente donde nacen los desajustes entre dos pantallas que
 * dicen mirar lo mismo.
 *
 * El NOMBRE no viene aquí a propósito: vive en el listado de personas, que ya está
 * cacheado por otras pantallas (`useEmployeeNames`). Cargarlo otra vez desde el tablero
 * sería una consulta más para un dato que la app ya tiene.
 */
export type FranjaDeHoy = {
  employeeId: string;
  /** El turno publicado de hoy, si lo hay. */
  turno: { desde: Date; hasta: Date } | null;
  /** La jornada de hoy. `hasta: null` significa que sigue dentro. */
  trabajado: { desde: Date; hasta: Date | null } | null;
  estado: 'normal' | 'tarde' | 'pausa';
};

export type RightNowEntry = {
  employeeId: string;
  name: string;
  state: 'working' | 'onBreak' | 'upcoming' | 'late' | 'absent';
  /** Instante de referencia: entrada, inicio de descanso o inicio del turno. */
  since: string;
  shiftId: string | null;
};

export type ManagerDashboard = {
  isPending: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
  workingCount: number;
  onBreakCount: number;
  upcomingCount: number;
  lateCount: number;
  absentCount: number;
  incompleteCount: number;
  pendingRequestCount: number;
  pendingSyncCount: number;
  scheduledMinutesThisWeek: number;
  workedMinutesThisWeek: number;
  rightNow: RightNowEntry[];
  franjas: FranjaDeHoy[];
};

/** Ventana en la que un turno cuenta como "próximo a entrar". */
const UPCOMING_WINDOW_MINUTES = 120;
/** Una sesión abierta más allá de esta duración es un fichaje incompleto. */
const OPEN_SESSION_LIMIT_MINUTES = 16 * 60;

export function useManagerDashboard(params: {
  organizationId: string | null;
  locationId: string | null;
  timezone: string;
  weekStartsOn: number;
  lateGraceMinutes: number;
  now: Date;
}): ManagerDashboard {
  const { organizationId, locationId, timezone, weekStartsOn, lateGraceMinutes, now } = params;

  const nowISO = now.toISOString();
  const weekStart = currentWeekStart(nowISO, weekStartsOn, timezone);
  // Dos cadenas ISO: calcularlas en cada render es más barato que memorizarlas.
  const weekRange = weekRangeInstants(weekStart, timezone);
  const enabled = locationId !== null;

  const workingNow = useQuery({
    queryKey: dashboardKeys.workingNow(locationId ?? 'none'),
    queryFn: () => fetchWorkingNow(locationId ?? ''),
    enabled,
    staleTime: ADMIN_LIST_STALE_MS,
    refetchInterval: DASHBOARD_POLL_MS,
  });

  const weekShifts = useQuery({
    queryKey: dashboardKeys.weekShifts(locationId ?? 'none', weekStart),
    queryFn: () =>
      fetchWeekShifts({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        fromISO: weekRange.fromISO,
        toISO: weekRange.toISO,
      }),
    enabled,
    staleTime: ADMIN_LIST_STALE_MS,
    refetchInterval: DASHBOARD_POLL_MS,
  });

  const weekSessions = useQuery({
    queryKey: dashboardKeys.weekSessions(locationId ?? 'none', weekStart),
    queryFn: () =>
      fetchWorkSessions({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        fromISO: weekRange.fromISO,
        toISO: weekRange.toISO,
      }),
    enabled,
    staleTime: ADMIN_LIST_STALE_MS,
    refetchInterval: DASHBOARD_POLL_MS,
  });

  const pendingRequests = useQuery({
    queryKey: dashboardKeys.pendingRequests(locationId ?? 'none'),
    queryFn: () =>
      countPendingRequests({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
      }),
    enabled: enabled && organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
    refetchInterval: DASHBOARD_POLL_MS,
  });

  // Pendientes de este dispositivo. Los pendientes de cada kiosco requieren leer
  // `kiosk_devices`, que hoy no está expuesta al rol autenticado.
  const localPending = useNetworkStore((state) => state.pendingCount);

  const todayKey = dateKeyOf(nowISO, timezone);

  return useMemo(() => {
    const live = workingNow.data ?? [];
    const shifts = weekShifts.data ?? [];
    const sessions = weekSessions.data ?? [];

    const activeByEmployee = new Set(live.map((row) => row.employee_id));
    const sessionsByEmployee = new Map<string, number>();
    for (const session of sessions) {
      const key = `${session.employee_id}|${dateKeyOf(session.starts_at, timezone)}`;
      sessionsByEmployee.set(key, (sessionsByEmployee.get(key) ?? 0) + 1);
    }

    const rightNow: RightNowEntry[] = [];

    for (const row of live) {
      const name =
        row.preferred_name !== null && row.preferred_name.trim() !== ''
          ? row.preferred_name
          : row.full_name;
      rightNow.push({
        employeeId: row.employee_id,
        name,
        state: row.attendance_state === 'ON_BREAK' ? 'onBreak' : 'working',
        since: row.break_started_at ?? row.starts_at,
        shiftId: row.shift_id,
      });
    }

    let upcomingCount = 0;
    let lateCount = 0;
    let absentCount = 0;

    const todaysShifts = shifts.filter(
      (shift) => shift.status === 'published' && dateKeyOf(shift.starts_at, timezone) === todayKey,
    );

    for (const shift of todaysShifts) {
      if (activeByEmployee.has(shift.employee_id)) continue;

      const hasSessionToday = (sessionsByEmployee.get(`${shift.employee_id}|${todayKey}`) ?? 0) > 0;
      if (hasSessionToday) continue;

      if (shift.starts_at > nowISO) {
        const minutesToStart = minutesBetween(nowISO, shift.starts_at);
        if (minutesToStart <= UPCOMING_WINDOW_MINUTES) {
          upcomingCount += 1;
          rightNow.push({
            employeeId: shift.employee_id,
            name: '',
            state: 'upcoming',
            since: shift.starts_at,
            shiftId: shift.id,
          });
        }
        continue;
      }

      if (shift.ends_at < nowISO) {
        absentCount += 1;
        rightNow.push({
          employeeId: shift.employee_id,
          name: '',
          state: 'absent',
          since: shift.starts_at,
          shiftId: shift.id,
        });
        continue;
      }

      // Empezó su turno y no ha fichado: es tardanza pasada la tolerancia.
      if (minutesBetween(shift.starts_at, nowISO) > lateGraceMinutes) {
        lateCount += 1;
        rightNow.push({
          employeeId: shift.employee_id,
          name: '',
          state: 'late',
          since: shift.starts_at,
          shiftId: shift.id,
        });
      }
    }

    /*
     * LAS FRANJAS DE HOY. Una por persona que tenga turno hoy, jornada hoy, o esté dentro
     * ahora mismo: las tres cosas, porque quien no vino también tiene que aparecer —su
     * carril vacío ES la información— y quien fichó sin turno también.
     */
    const franjasPorEmpleado = new Map<string, FranjaDeHoy>();

    const deHoy = (iso: string) => dateKeyOf(iso, timezone) === todayKey;

    for (const shift of todaysShifts) {
      franjasPorEmpleado.set(shift.employee_id, {
        employeeId: shift.employee_id,
        turno: { desde: new Date(shift.starts_at), hasta: new Date(shift.ends_at) },
        trabajado: null,
        estado: 'normal',
      });
    }

    for (const session of sessions) {
      if (!deHoy(session.starts_at)) continue;
      const previa = franjasPorEmpleado.get(session.employee_id);
      franjasPorEmpleado.set(session.employee_id, {
        employeeId: session.employee_id,
        turno: previa?.turno ?? null,
        trabajado: {
          desde: new Date(session.starts_at),
          hasta: session.ends_at === null ? null : new Date(session.ends_at),
        },
        estado: previa?.estado ?? 'normal',
      });
    }

    /*
     * Quien está DENTRO ahora manda sobre la sesión guardada: su jornada sigue abierta, y
     * el estado de descanso solo se sabe aquí.
     */
    for (const row of live) {
      const previa = franjasPorEmpleado.get(row.employee_id);
      franjasPorEmpleado.set(row.employee_id, {
        employeeId: row.employee_id,
        turno: previa?.turno ?? null,
        trabajado: { desde: new Date(row.starts_at), hasta: null },
        estado: row.attendance_state === 'ON_BREAK' ? 'pausa' : 'normal',
      });
    }

    /*
     * TARDE se decide con la MISMA tolerancia que usan los contadores de arriba, no con
     * «entró un minuto después». Si la franja llamara tarde a alguien que el contador no
     * cuenta como tardanza, la pantalla se contradiría a sí misma a dos centímetros de
     * distancia.
     */
    const franjas = [...franjasPorEmpleado.values()]
      .map((franja) => {
        if (franja.turno === null || franja.trabajado === null || franja.estado === 'pausa') {
          return franja;
        }
        const retraso = (franja.trabajado.desde.getTime() - franja.turno.desde.getTime()) / 60_000;
        return retraso > lateGraceMinutes ? { ...franja, estado: 'tarde' as const } : franja;
      })
      .sort((a, b) => {
        const refA = (a.turno ?? a.trabajado)?.desde.getTime() ?? 0;
        const refB = (b.turno ?? b.trabajado)?.desde.getTime() ?? 0;
        return refA - refB;
      });

    const incompleteCount = sessions.filter(
      (session) =>
        session.status === 'needs_review' ||
        (session.status === 'open' &&
          minutesBetween(session.starts_at, nowISO) > OPEN_SESSION_LIMIT_MINUTES),
    ).length;

    let scheduledMinutesThisWeek = 0;
    for (const shift of shifts) {
      if (shift.status === 'cancelled') continue;
      scheduledMinutesThisWeek += shiftScheduledMinutes({
        id: shift.id,
        employeeId: shift.employee_id,
        employeeName: '',
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
        plannedUnpaidBreakMinutes: shift.planned_unpaid_break_minutes,
        status: shift.status,
      });
    }

    let workedMinutesThisWeek = 0;
    for (const session of sessions) workedMinutesThisWeek += session.net_minutes ?? 0;

    return {
      isPending: workingNow.isPending || weekShifts.isPending,
      isFetching: workingNow.isFetching || weekShifts.isFetching || weekSessions.isFetching,
      error: workingNow.error ?? weekShifts.error ?? weekSessions.error,
      refetch: () => {
        void workingNow.refetch();
        void weekShifts.refetch();
        void weekSessions.refetch();
        void pendingRequests.refetch();
      },
      workingCount: live.filter((row) => row.attendance_state === 'WORKING').length,
      onBreakCount: live.filter((row) => row.attendance_state === 'ON_BREAK').length,
      upcomingCount,
      lateCount,
      absentCount,
      incompleteCount,
      pendingRequestCount: pendingRequests.data ?? 0,
      pendingSyncCount: localPending,
      scheduledMinutesThisWeek,
      workedMinutesThisWeek,
      rightNow,
      franjas,
    };
  }, [
    workingNow,
    weekShifts,
    weekSessions,
    pendingRequests,
    localPending,
    nowISO,
    todayKey,
    timezone,
    lateGraceMinutes,
  ]);
}
