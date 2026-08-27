import { openOfflineDatabase } from '@/lib/offline/database';
import { pendingEvents } from '@/lib/offline/outbox';
import {
  allowedEvents,
  reduceEvents,
  type AttendanceState,
  type TimeEventType,
} from '@/domain/attendance-state-machine';

/**
 * Sesión del empleado reconstruida SIN CONEXIÓN (especificación §9.7).
 *
 * El problema que resuelve: offline no hay servidor que diga en qué estado está la
 * persona. Derivarlo solo desde la cola local sería falso —alguien pudo fichar
 * entrada con red y perderla después— y le ofrecería marcar entrada dos veces.
 *
 * La solución: se parte del último estado que el SERVIDOR confirmó, que se cachea
 * en cada verificación online, y encima se aplican los eventos que están en la
 * cola local con la misma máquina de estados que usa el servidor.
 *
 * Si no hay estado cacheado para esa persona, no se adivina: se devuelve
 * `unknown` y la interfaz le pide esperar conexión. Ofrecerle una acción que el
 * servidor va a rechazar es peor que decirle la verdad.
 */

export type OfflineSessionResult =
  | {
      status: 'ready';
      attendanceState: AttendanceState;
      allowedActions: TimeEventType[];
      displayName: string;
      jobRoleName: string | null;
      shiftId: string | null;
      sessionStartedAt: string | null;
      takenBreakMinutes: number;
      requiredBreakMinutes: number;
      shift: {
        id: string;
        startsAt: string;
        endsAt: string;
        jobRoleName: string | null;
        employeeNote: string | null;
        plannedUnpaidBreakMinutes: number;
        changedSinceLastPublication: boolean;
      } | null;
    }
  | { status: 'unknown_state' }
  | { status: 'unknown_employee' };

type StateRow = {
  attendance_state: AttendanceState;
  shift_id: string | null;
  session_started_at: string | null;
  taken_break_minutes: number;
};

type RosterRow = { display_name: string; job_role_name: string | null };

type ShiftRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  job_role_name: string | null;
  employee_note: string | null;
  planned_unpaid_break_minutes: number;
  changed_since_last_publication: number;
};

/** Guarda el estado que confirmó el servidor, para poder operar sin red después. */
export async function cacheAttendanceState(params: {
  employeeOpaqueId: string;
  attendanceState: AttendanceState;
  shiftId: string | null;
  sessionStartedAt: string | null;
  takenBreakMinutes: number;
}): Promise<void> {
  const database = await openOfflineDatabase();
  await database.runAsync(
    `insert into cached_attendance_state
       (employee_opaque_id, attendance_state, shift_id, session_started_at,
        taken_break_minutes, known_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict (employee_opaque_id) do update set
       attendance_state = excluded.attendance_state,
       shift_id = excluded.shift_id,
       session_started_at = excluded.session_started_at,
       taken_break_minutes = excluded.taken_break_minutes,
       known_at = excluded.known_at`,
    params.employeeOpaqueId,
    params.attendanceState,
    params.shiftId,
    params.sessionStartedAt,
    params.takenBreakMinutes,
    new Date().toISOString(),
  );
}

/** Guarda el equipo y los turnos que envió el servidor, para usarlos sin red. */
export async function cacheRosterAndShifts(params: {
  roster: readonly { opaqueId: string; displayName: string; jobRoleName?: string | null }[];
  shifts: readonly {
    id: string;
    employeeOpaqueId: string;
    startsAt: string;
    endsAt: string;
    jobRoleName: string | null;
    employeeNote: string | null;
    plannedUnpaidBreakMinutes: number;
    changedSinceLastPublication: boolean;
  }[];
  policies: {
    pinLength: number;
    photoEnabled: boolean;
    earlyClockInMinutes: number;
    lateGraceMinutes: number;
    allowUnscheduledShifts: boolean;
    timeFormat: '12h' | '24h';
    requiredBreakMinutes: number;
  };
}): Promise<void> {
  const database = await openOfflineDatabase();
  const now = new Date().toISOString();

  await database.withTransactionAsync(async () => {
    // Se reemplaza el conjunto: quien salió de la tienda debe desaparecer del
    // iPad, y eso solo pasa borrando su fila.
    await database.runAsync('delete from cached_roster');
    for (const person of params.roster) {
      await database.runAsync(
        `insert into cached_roster (employee_opaque_id, display_name, job_role_name, updated_at)
         values (?, ?, ?, ?)`,
        person.opaqueId,
        person.displayName,
        person.jobRoleName ?? null,
        now,
      );
    }

    await database.runAsync('delete from cached_shifts');
    for (const shift of params.shifts) {
      await database.runAsync(
        `insert into cached_shifts (
           id, employee_opaque_id, starts_at, ends_at, job_role_name, employee_note,
           planned_unpaid_break_minutes, changed_since_last_publication, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        shift.id,
        shift.employeeOpaqueId,
        shift.startsAt,
        shift.endsAt,
        shift.jobRoleName,
        shift.employeeNote,
        shift.plannedUnpaidBreakMinutes,
        shift.changedSinceLastPublication ? 1 : 0,
        now,
      );
    }

    await database.runAsync(
      `insert into cached_policies (
         id, pin_length, photo_enabled, early_clock_in_minutes, late_grace_minutes,
         allow_unscheduled_shifts, time_format, required_break_minutes, updated_at
       ) values (1, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (id) do update set
         pin_length = excluded.pin_length,
         photo_enabled = excluded.photo_enabled,
         early_clock_in_minutes = excluded.early_clock_in_minutes,
         late_grace_minutes = excluded.late_grace_minutes,
         allow_unscheduled_shifts = excluded.allow_unscheduled_shifts,
         time_format = excluded.time_format,
         required_break_minutes = excluded.required_break_minutes,
         updated_at = excluded.updated_at`,
      params.policies.pinLength,
      params.policies.photoEnabled ? 1 : 0,
      params.policies.earlyClockInMinutes,
      params.policies.lateGraceMinutes,
      params.policies.allowUnscheduledShifts ? 1 : 0,
      params.policies.timeFormat,
      params.policies.requiredBreakMinutes,
      now,
    );
  });
}

/**
 * Reconstruye la sesión de un empleado con lo que hay en el dispositivo.
 *
 * El estado final es: último estado confirmado por el servidor + los eventos que
 * la cola local tiene para esa persona, aplicados en orden con la misma máquina de
 * estados del servidor.
 */
export async function buildOfflineSession(
  employeeOpaqueId: string,
): Promise<OfflineSessionResult> {
  const database = await openOfflineDatabase();

  const person = await database.getFirstAsync<RosterRow>(
    'select display_name, job_role_name from cached_roster where employee_opaque_id = ?',
    employeeOpaqueId,
  );
  if (person === null) return { status: 'unknown_employee' };

  const cached = await database.getFirstAsync<StateRow>(
    `select attendance_state, shift_id, session_started_at, taken_break_minutes
       from cached_attendance_state where employee_opaque_id = ?`,
    employeeOpaqueId,
  );
  if (cached === null) return { status: 'unknown_state' };

  // Eventos de ESTA persona que están en la cola, en orden de secuencia.
  const queued = (await pendingEvents(200))
    .filter((event) => event.employeeOpaqueId === employeeOpaqueId)
    .map((event) => event.eventType);

  const { state } = reduceEvents(queued, cached.attendance_state);

  const policies = await database.getFirstAsync<{ required_break_minutes: number }>(
    'select required_break_minutes from cached_policies where id = 1',
  );

  const shiftRow = await database.getFirstAsync<ShiftRow>(
    `select id, starts_at, ends_at, job_role_name, employee_note,
            planned_unpaid_break_minutes, changed_since_last_publication
       from cached_shifts
      where employee_opaque_id = ?
      order by abs(strftime('%s', starts_at) - strftime('%s', 'now'))
      limit 1`,
    employeeOpaqueId,
  );

  return {
    status: 'ready',
    attendanceState: state,
    allowedActions: allowedEvents(state),
    displayName: person.display_name,
    jobRoleName: person.job_role_name,
    shiftId: cached.shift_id,
    sessionStartedAt: cached.session_started_at,
    takenBreakMinutes: cached.taken_break_minutes,
    requiredBreakMinutes: policies?.required_break_minutes ?? 0,
    shift:
      shiftRow === null
        ? null
        : {
            id: shiftRow.id,
            startsAt: shiftRow.starts_at,
            endsAt: shiftRow.ends_at,
            jobRoleName: shiftRow.job_role_name,
            employeeNote: shiftRow.employee_note,
            plannedUnpaidBreakMinutes: shiftRow.planned_unpaid_break_minutes,
            changedSinceLastPublication: shiftRow.changed_since_last_publication === 1,
          },
  };
}
