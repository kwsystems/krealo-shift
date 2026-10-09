import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { docId } from '@/lib/firebase/ids';

import { countPendingRequests } from '@/features/requests/api';
import { fetchWeekShifts } from '@/features/schedules/api';
import { currentWeekStart, dateKeyOf, weekRangeInstants } from '@/features/schedules/week';
import { shiftScheduledMinutes } from '@/features/schedules/conflicts';
import { useInicioDelReloj } from '@/features/schedules/horario-cumplido';
import { OPEN_SESSION_ALERT_MINUTES } from '@/features/timesheets/alerts';
import { conLasAbiertas, useJornadasAbiertas } from '@/features/timesheets/jornadas-abiertas';
import { fetchWorkSessions } from '@/features/timesheets/api';
import {
  dentroAhoraEnTotal,
  enCursoPorSesionDe,
  minutosEnCurso,
} from '@/features/timesheets/en-curso';
import {
  cubreElTurno,
  estadoDeFalta,
  faltasDeLosTurnos,
  turnoSinLlegar,
} from '@/features/timesheets/faltas';
import { useJustificaciones } from '@/features/timesheets/justificaciones';
import { ADMIN_LIST_STALE_MS, DASHBOARD_POLL_MS, selectRows } from '@/hooks/use-admin-query';
import { useNetworkStore } from '@/stores/network-store';
import { minutesBetween } from '@/utils/time';
import { VIEWS } from '@/lib/firebase/tables';
import { puntualidadDe, puntualidadPorJornada } from '@/features/timesheets/puntualidad';

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
  /*
   * El motivo de la pausa abierta. `default(null)` y no obligatorio: un servidor de antes
   * de este campo no lo manda, y un campo obligatorio tumbaría Inicio, Horas y Horario.
   */
  break_reason: z.string().nullable().default(null),
  attendance_state: z.enum(['WORKING', 'ON_BREAK']),
});

export type WorkingNowRow = z.infer<typeof workingNowSchema>;

async function fetchWorkingNow(locationId: string): Promise<WorkingNowRow[]> {
  return selectRows(z.array(workingNowSchema), (db) =>
    db
      .from(VIEWS.employeesWorkingNow)
      .select(
        'work_session_id, employee_id, full_name, preferred_name, starts_at, shift_id, break_started_at, break_reason, attendance_state',
      )
      .eq('location_id', locationId)
      .order('starts_at', { ascending: true }),
  );
}

/**
 * Quién está dentro ahora mismo, y si trabaja o está en descanso.
 *
 * SE EXPORTA PARA QUE HORAS LO LEA DE AQUÍ, con la misma clave de caché que Inicio. Las
 * dos pantallas hablan de lo mismo —esta persona está trabajando— y si cada una lo
 * calculara por su cuenta acabarían discrepando: Inicio diría «en descanso» y Horas
 * «trabajando» sobre la misma persona en el mismo minuto. Con una sola consulta, cambiar
 * de pestaña tampoco cuesta otra lectura.
 */
export function useWorkingNow(locationId: string | null) {
  return useQuery({
    queryKey: dashboardKeys.workingNow(locationId ?? 'none'),
    queryFn: () => fetchWorkingNow(locationId ?? ''),
    enabled: locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
    refetchInterval: DASHBOARD_POLL_MS,
  });
}

/**
 * Cuántas solicitudes esperan respuesta en la sede: lo dice Inicio y, desde el 2-oct, el
 * número de Bandeja en el menú. Una sola consulta con una sola clave, así que contestar
 * una en Bandeja baja los dos a la vez.
 */
export function usePendingRequestCount(organizationId: string | null, locationId: string | null) {
  return useQuery({
    queryKey: dashboardKeys.pendingRequests(locationId ?? 'none'),
    queryFn: () =>
      countPendingRequests({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
      }),
    enabled: locationId !== null && organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
    refetchInterval: DASHBOARD_POLL_MS,
  });
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
  /** El motivo de la pausa abierta (`meal`…): con él se dice «Almorzando», como en Horas. */
  motivo: string | null;
  /**
   * Lo trabajado en la jornada abierta, con la cuenta de Horas y Equipo
   * (`minutosEnCurso`): sin los descansos ya tomados. `null` si no está dentro.
   */
  minutosTrabajados: number | null;
};

export type ManagerDashboard = {
  isPending: boolean;
  isFetching: boolean;
  /** Error de lo que sostiene la pantalla: turnos y jornadas de la semana. */
  error: unknown;
  /**
   * Error SOLO de «quién está dentro», aparte. Antes iba en `error` y un fallo de esa
   * consulta tapaba Inicio entero, turnos y todo: así se vio el 29-sep en San Miguel. Ver
   * `viewEmployeesWorkingNow` y `indices.test.ts`.
   */
  workingNowError: unknown;
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
  /**
   * Lo que llevan quienes están dentro ahora (5-oct): la barra de la semana lo suma a lo
   * cerrado y lo dice aparte, como el total de Reportes. Ver `dentroAhoraEnTotal`.
   */
  liveThisWeek: { personas: number; minutos: number };
  rightNow: RightNowEntry[];
  franjas: FranjaDeHoy[];
};

/** Ventana en la que un turno cuenta como "próximo a entrar". */
const UPCOMING_WINDOW_MINUTES = 120;

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

  const workingNow = useWorkingNow(locationId);

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

  // Desde qué día la sede usa el reloj: antes de eso un turno sin marcas no es una falta.
  const relojDesde = useInicioDelReloj({
    organizationId,
    locationId,
    timezone,
    enabled,
  }).data;
  // Lo que se dijo de cada falta (2-oct): una justificada ya no es algo que atender hoy.
  const justificaciones = useJustificaciones(organizationId, locationId);

  const pendingRequests = usePendingRequestCount(organizationId, locationId);
  // Las abiertas de semanas anteriores también son «sin cerrar»: ver `jornadas-abiertas.ts`.
  const abiertas = useJornadasAbiertas({
    organizationId,
    locationId,
    refetchInterval: DASHBOARD_POLL_MS,
  });

  // Pendientes de este dispositivo. Los pendientes de cada kiosco requieren leer
  // `kiosk_devices`, que hoy no está expuesta al rol autenticado.
  const localPending = useNetworkStore((state) => state.pendingCount);

  const todayKey = dateKeyOf(nowISO, timezone);

  return useMemo(() => {
    const shifts = weekShifts.data ?? [];
    const sessions = weekSessions.data ?? [];
    const sesionPorId = new Map(sessions.map((session) => [session.id, session]));
    /*
     * UNA SALIDA OLVIDADA NO ES ALGUIEN DENTRO (2-oct), con la regla de Horas, Equipo y
     * Reportes (`OPEN_SESSION_ALERT_MINUTES`). Inicio contaba como «Trabajando · Lleva
     * 26:00» a quien se fue ayer sin marcar, y a la vez lo contaba como fichaje sin cerrar:
     * la misma persona dentro y olvidada en la misma pantalla. Ahora es solo lo segundo.
     */
    const live = (workingNow.data ?? []).filter((row) => {
      const desde = sesionPorId.get(row.work_session_id)?.starts_at ?? row.starts_at;
      return minutesBetween(desde, nowISO) <= OPEN_SESSION_ALERT_MINUTES;
    });

    const activeByEmployee = new Set(live.map((row) => row.employee_id));

    const rightNow: RightNowEntry[] = [];

    for (const row of live) {
      const name =
        row.preferred_name !== null && row.preferred_name.trim() !== ''
          ? row.preferred_name
          : row.full_name;
      const enDescanso = row.attendance_state === 'ON_BREAK';
      const sesion = sesionPorId.get(row.work_session_id);
      rightNow.push({
        employeeId: row.employee_id,
        name,
        state: enDescanso ? 'onBreak' : 'working',
        since: row.break_started_at ?? row.starts_at,
        shiftId: row.shift_id,
        motivo: row.break_reason,
        minutosTrabajados:
          sesion === undefined
            ? minutesBetween(row.starts_at, row.break_started_at ?? nowISO)
            : minutosEnCurso(
                sesion,
                {
                  estado: enDescanso ? 'descanso' : 'trabajando',
                  descansoDesde: row.break_started_at,
                },
                nowISO,
              ),
      });
    }

    let upcomingCount = 0;
    let lateCount = 0;
    let absentCount = 0;

    const todaysShifts = shifts.filter(
      (shift) => shift.status === 'published' && dateKeyOf(shift.starts_at, timezone) === todayKey,
    );
    /*
     * LOS DE HOY Y EL QUE SIGUE EN CURSO DESDE AYER (3-oct): un turno de noche que empezó
     * ayer y no ha terminado también puede tener a alguien que no llegó. Horario lo marca
     * con «No ha llegado» (mira la semana); Inicio solo miraba los que empiezan hoy.
     */
    const enJuego = [
      ...todaysShifts,
      ...shifts.filter(
        (shift) =>
          shift.status === 'published' &&
          dateKeyOf(shift.starts_at, timezone) < todayKey &&
          shift.ends_at > nowISO,
      ),
    ];

    /*
     * LA FALTA, CON LA REGLA DE TODA LA APP (1-oct): ver `features/timesheets/faltas.ts`.
     * Antes bastaba con haber fichado algo hoy para no faltar, así que quien vino por la
     * mañana y no a su turno de la tarde no faltaba aquí y sí en el bono. Ahora un turno
     * está cubierto si hay una jornada suya DURANTE el turno, y uno terminado sin cubrir es
     * falta solo desde que la sede usa el reloj, como en Horario, Horas y Reportes.
     */
    const ahoraMs = Date.parse(nowISO);
    /*
     * Y UNA FALTA YA JUSTIFICADA NO ES ALGO QUE ATENDER (2-oct): quien gestiona ya dijo por
     * qué faltó. Sigue siendo falta en Horas, Horario y Reportes, en ámbar; aquí, que es lo
     * que pide una acción hoy, deja de salir.
     */
    const faltasDeHoy = new Set(
      faltasDeLosTurnos({
        turnos: todaysShifts,
        jornadas: sessions,
        relojDesde: () => relojDesde,
        ahoraISO: nowISO,
        timezone,
        resoluciones: justificaciones.data ?? [],
      })
        .filter((falta) => estadoDeFalta(falta) !== 'justificada')
        .map((falta) => falta.id),
    );

    /*
     * SIN JORNADAS NO SE ACUSA A NADIE (auditoría, 4-oct): mientras cargaban, Inicio decía
     * «No se presentó» de quien sí había venido. Hasta tenerlas, nada de tarde ni de falta.
     */
    const jornadasListas = weekSessions.data !== undefined;
    for (const shift of enJuego) {
      if (!jornadasListas) break;
      /*
       * UN TURNO QUE YA TERMINÓ SE DECIDE SOLO POR SI SE CUBRIÓ (auditoría, 4-oct). Estar
       * dentro ahora —en el turno de la tarde de un turno partido— borraba la falta del de
       * la mañana. Estar dentro solo cuenta para los turnos que siguen en curso.
       */
      const terminado = shift.ends_at < nowISO;
      if (!terminado && activeByEmployee.has(shift.employee_id)) continue;
      if (cubreElTurno(shift, sessions, ahoraMs)) continue;

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
            motivo: null,
            minutosTrabajados: null,
          });
        }
        continue;
      }

      if (shift.ends_at < nowISO) {
        // Terminado y sin cubrir, pero de antes del reloj o ya justificado: no se atiende.
        if (!faltasDeHoy.has(shift.id)) continue;
        absentCount += 1;
        rightNow.push({
          employeeId: shift.employee_id,
          name: '',
          state: 'absent',
          since: shift.starts_at,
          shiftId: shift.id,
          motivo: null,
          minutosTrabajados: null,
        });
        continue;
      }

      // Empezó su turno y no ha fichado, pasada la tolerancia: la regla de Horario también.
      if (
        turnoSinLlegar({
          turno: shift,
          jornadas: sessions,
          ahoraISO: nowISO,
          toleranciaMin: lateGraceMinutes,
        })
      ) {
        lateCount += 1;
        rightNow.push({
          employeeId: shift.employee_id,
          name: '',
          state: 'late',
          since: shift.starts_at,
          shiftId: shift.id,
          motivo: null,
          minutosTrabajados: null,
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
    const masTemprano = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
    const masTarde = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

    /*
     * EL DÍA ENTERO DE CADA PERSONA, no su último tramo (2-oct). Con un turno partido o
     * una salida a almorzar marcada en el reloj, la franja se quedaba con el último turno
     * y la última jornada, y la mañana desaparecía: quien vino a las 8 salía como si
     * hubiera entrado a las 14. Ahora el turno va del primero al último, y lo trabajado de
     * la primera entrada a la última salida.
     */
    for (const shift of todaysShifts) {
      const previa = franjasPorEmpleado.get(shift.employee_id);
      const desde = new Date(shift.starts_at);
      const hasta = new Date(shift.ends_at);
      franjasPorEmpleado.set(shift.employee_id, {
        employeeId: shift.employee_id,
        turno:
          previa?.turno === null || previa?.turno === undefined
            ? { desde, hasta }
            : {
                desde: masTemprano(previa.turno.desde, desde),
                hasta: masTarde(previa.turno.hasta, hasta),
              },
        trabajado: null,
        estado: 'normal',
      });
    }

    /*
     * TARDE ES LA MARCA DEL SERVIDOR (2-oct), `late_arrival` en su primera jornada del día:
     * la misma que dice «Entrada tardía» en Horas y cuenta en Reportes. Antes la franja lo
     * calculaba aquí con la tolerancia de la sede, y comparando la ÚLTIMA jornada con el
     * ÚLTIMO turno: quien volvía de almorzar a las 14:00 a un turno de 9 salía «tarde».
     */
    const primeraDeHoy = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
      if (!deHoy(session.starts_at)) continue;
      const primera = primeraDeHoy.get(session.employee_id);
      if (primera === undefined || session.starts_at < primera.starts_at) {
        primeraDeHoy.set(session.employee_id, session);
      }
      const previa = franjasPorEmpleado.get(session.employee_id);
      const desde = new Date(session.starts_at);
      const hasta = session.ends_at === null ? null : new Date(session.ends_at);
      const antes = previa?.trabajado ?? null;
      franjasPorEmpleado.set(session.employee_id, {
        employeeId: session.employee_id,
        turno: previa?.turno ?? null,
        trabajado:
          antes === null
            ? { desde, hasta }
            : {
                desde: masTemprano(antes.desde, desde),
                // Una jornada abierta deja la franja abierta: sigue dentro.
                hasta: antes.hasta === null || hasta === null ? null : masTarde(antes.hasta, hasta),
              },
        estado: 'normal',
      });
    }

    /*
     * Quien está DENTRO ahora manda sobre la sesión guardada: su jornada sigue abierta, y
     * el estado de descanso solo se sabe aquí.
     */
    for (const row of live) {
      const previa = franjasPorEmpleado.get(row.employee_id);
      const desde = new Date(row.starts_at);
      franjasPorEmpleado.set(row.employee_id, {
        employeeId: row.employee_id,
        turno: previa?.turno ?? null,
        trabajado: {
          desde:
            previa?.trabajado === null || previa?.trabajado === undefined
              ? desde
              : masTemprano(previa.trabajado.desde, desde),
          hasta: null,
        },
        estado: row.attendance_state === 'ON_BREAK' ? 'pausa' : 'normal',
      });
    }

    /*
     * Y POR TURNO, NO SOLO LA PRIMERA DEL DÍA (8-oct): con turno partido —09:00 a 13:00 y
     * 17:00 a 21:00—, llegar 40 min tarde a la tarde no salía en la banda, mientras el celular,
     * Reportes y el bono la contaban. La regla es la de `puntualidad.ts`.
     */
    const marcasDeHoy = puntualidadPorJornada(sessions.filter((s) => deHoy(s.starts_at)));
    const tardeHoy = new Set(
      sessions
        .filter((s) => deHoy(s.starts_at) && puntualidadDe(marcasDeHoy, s).tarde)
        .map((s) => s.employee_id),
    );
    const franjas = [...franjasPorEmpleado.values()]
      .map((franja) => {
        if (franja.estado === 'pausa') return franja;
        const tarde = tardeHoy.has(franja.employeeId);
        return tarde ? { ...franja, estado: 'tarde' as const } : franja;
      })
      .sort((a, b) => {
        const refA = (a.turno ?? a.trabajado)?.desde.getTime() ?? 0;
        const refB = (b.turno ?? b.trabajado)?.desde.getTime() ?? 0;
        return refA - refB;
      });

    /*
     * SIN CERRAR ES SIN SALIDA (2-oct): una jornada abierta más allá de lo que dura un turno,
     * la misma regla que la fila «Sin salida» de Horas. Aquí también contaba `needs_review`,
     * un estado que el servidor no escribe: en la demostración lo llevaban las tardanzas, y
     * Inicio llamaba «fichajes sin cerrar» a jornadas cerradas y bien.
     */
    const incompleteCount = conLasAbiertas(sessions, abiertas.data, nowISO).filter(
      (session) =>
        session.ends_at === null &&
        minutesBetween(session.starts_at, nowISO) > OPEN_SESSION_ALERT_MINUTES,
    ).length;

    /*
     * LO PROGRAMADO SON LOS TURNOS PUBLICADOS (2-oct), como en Reportes: un borrador no se
     * le dio a nadie. Inicio sumaba también los borradores y decía «144:00 programadas»
     * donde Reportes decía 122:00 de la misma semana.
     */
    let scheduledMinutesThisWeek = 0;
    for (const shift of shifts) {
      if (shift.status !== 'published') continue;
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
    const liveThisWeek = dentroAhoraEnTotal(sessions, enCursoPorSesionDe(workingNow.data), nowISO);

    return {
      isPending: workingNow.isPending || weekShifts.isPending,
      isFetching: workingNow.isFetching || weekShifts.isFetching || weekSessions.isFetching,
      error: weekShifts.error ?? weekSessions.error,
      workingNowError: workingNow.error,
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
      liveThisWeek,
      rightNow,
      franjas,
    };
  }, [
    abiertas.data,
    justificaciones.data,
    workingNow,
    weekShifts,
    weekSessions,
    pendingRequests,
    localPending,
    nowISO,
    todayKey,
    timezone,
    lateGraceMinutes,
    relojDesde,
  ]);
}
