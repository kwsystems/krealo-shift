import { z } from 'zod';

import { addDaysToKey, dateKeyOf, localTimeOf, shiftInstants, weekRangeInstants } from './week';
import { AdminError, execute, selectRows } from '@/hooks/use-admin-query';
import { useSessionStore } from '@/stores/session-store';
import { TABLES } from '@/lib/supabase/types';

/**
 * Turnos y publicaciones (§11.3).
 *
 * Decisiones que respeta este archivo:
 *   - un turno editado vuelve a `draft`: los cambios sobre un horario publicado
 *     permanecen como borrador hasta una nueva publicación;
 *   - un turno publicado NUNCA se borra, se cancela: si desapareciera, los
 *     fichajes que lo referencian perderían su contexto (la base también lo
 *     impide con un trigger);
 *   - copiar una semana suma siete días de calendario en la zona horaria de la
 *     ubicación, no 168 horas: así un cambio de horario de verano no mueve los
 *     turnos una hora.
 */

export const shiftStatusValues = ['draft', 'published', 'cancelled'] as const;

const shiftRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  location_id: z.string().uuid(),
  job_role_id: z.string().uuid().nullable(),
  starts_at: z.string(),
  ends_at: z.string(),
  timezone: z.string(),
  planned_unpaid_break_minutes: z.number().int(),
  employee_note: z.string().nullable(),
  manager_note: z.string().nullable(),
  status: z.enum(shiftStatusValues),
  publication_version: z.number().int(),
  published_at: z.string().nullable(),
  updated_at: z.string(),
});

export type ShiftRow = z.infer<typeof shiftRowSchema>;

const publicationSchema = z.object({
  id: z.string().uuid(),
  publication_version: z.number().int(),
  published_at: z.string(),
  changed_shift_ids: z.array(z.string().uuid()),
});

export type ShiftPublication = z.infer<typeof publicationSchema>;

const SHIFT_COLUMNS =
  'id, employee_id, location_id, job_role_id, starts_at, ends_at, timezone, planned_unpaid_break_minutes, employee_note, manager_note, status, publication_version, published_at, updated_at';

export async function fetchWeekShifts(params: {
  locationId: string;
  fromISO: string;
  toISO: string;
}): Promise<ShiftRow[]> {
  return selectRows(z.array(shiftRowSchema), (db) =>
    db
      .from(TABLES.shifts)
      .select(SHIFT_COLUMNS)
      .eq('location_id', params.locationId)
      .gte('starts_at', params.fromISO)
      .lt('starts_at', params.toISO)
      .order('starts_at', { ascending: true }),
  );
}

export type ShiftInput = {
  employeeId: string;
  jobRoleId: string | null;
  dateKey: string;
  startTime: string;
  endTime: string;
  plannedUnpaidBreakMinutes: number;
  employeeNote: string | null;
  managerNote: string | null;
};

function buildRow(params: {
  organizationId: string;
  locationId: string;
  timezone: string;
  input: ShiftInput;
}) {
  const { organizationId, locationId, timezone, input } = params;

  const instants = shiftInstants({
    dateKey: input.dateKey,
    startTime: input.startTime,
    endTime: input.endTime,
    timezone,
  });
  if (instants === null) throw new AdminError('invalid', 'INVALID_SHIFT_TIMES');

  return {
    organization_id: organizationId,
    location_id: locationId,
    employee_id: input.employeeId,
    job_role_id: input.jobRoleId,
    starts_at: instants.startsAt,
    ends_at: instants.endsAt,
    timezone,
    planned_unpaid_break_minutes: Math.max(0, Math.trunc(input.plannedUnpaidBreakMinutes)),
    employee_note: input.employeeNote,
    manager_note: input.managerNote,
  };
}

function actorId(): string | null {
  return useSessionStore.getState().user?.userId ?? null;
}

export async function createShift(params: {
  organizationId: string;
  locationId: string;
  timezone: string;
  input: ShiftInput;
}): Promise<void> {
  const row = buildRow(params);
  const createdBy = actorId();

  await execute((db) =>
    db.from(TABLES.shifts).insert({
      ...row,
      status: 'draft',
      created_by: createdBy,
      updated_by: createdBy,
    }),
  );
}

/**
 * Editar deja el turno en borrador, incluso si estaba publicado (§11.3 paso 8).
 * Se conserva `publication_version` para saber que ya existió publicado antes.
 */
export async function updateShift(params: {
  shiftId: string;
  organizationId: string;
  locationId: string;
  timezone: string;
  input: ShiftInput;
}): Promise<void> {
  const row = buildRow(params);

  await execute((db) =>
    db
      .from(TABLES.shifts)
      .update({ ...row, status: 'draft', updated_by: actorId() })
      .eq('id', params.shiftId),
  );
}

export async function duplicateShift(params: {
  organizationId: string;
  shift: ShiftRow;
  timezone: string;
  /** Día destino de la copia. Por defecto, el mismo día del turno original. */
  dateKey?: string;
}): Promise<void> {
  const { shift, timezone } = params;
  const dateKey = params.dateKey ?? dateKeyOf(shift.starts_at, timezone);

  await createShift({
    organizationId: params.organizationId,
    locationId: shift.location_id,
    timezone,
    input: {
      employeeId: shift.employee_id,
      jobRoleId: shift.job_role_id,
      dateKey,
      startTime: localTimeOf(shift.starts_at, timezone),
      endTime: localTimeOf(shift.ends_at, timezone),
      plannedUnpaidBreakMinutes: shift.planned_unpaid_break_minutes,
      employeeNote: shift.employee_note,
      managerNote: shift.manager_note,
    },
  });
}

/** Borrador: se elimina. Publicado: se cancela, para conservar el historial. */
export async function removeShift(params: { shiftId: string; status: string }): Promise<void> {
  if (params.status === 'published') {
    await execute((db) =>
      db
        .from(TABLES.shifts)
        .update({ status: 'cancelled', updated_by: actorId() })
        .eq('id', params.shiftId),
    );
    return;
  }

  await execute((db) => db.from(TABLES.shifts).delete().eq('id', params.shiftId));
}

/**
 * Copia la semana anterior como borradores (§11.3).
 * Con `employeeId` copia solo los turnos de una persona.
 */
export async function copyPreviousWeek(params: {
  organizationId: string;
  locationId: string;
  timezone: string;
  targetWeekStart: string;
  employeeId?: string | null;
}): Promise<number> {
  const { organizationId, locationId, timezone, targetWeekStart, employeeId } = params;

  const previousWeekStart = addDaysToKey(targetWeekStart, -7);
  const range = weekRangeInstants(previousWeekStart, timezone);

  const source = (
    await fetchWeekShifts({
      locationId,
      fromISO: range.fromISO,
      toISO: range.toISO,
    })
  ).filter(
    (shift) =>
      shift.status !== 'cancelled' &&
      (employeeId === undefined || employeeId === null || shift.employee_id === employeeId),
  );

  if (source.length === 0) return 0;

  const createdBy = actorId();
  const rows = source.map((shift) => {
    const dateKey = addDaysToKey(dateKeyOf(shift.starts_at, timezone), 7);
    const instants = shiftInstants({
      dateKey,
      startTime: localTimeOf(shift.starts_at, timezone),
      endTime: localTimeOf(shift.ends_at, timezone),
      timezone,
    });
    if (instants === null) throw new AdminError('invalid', 'INVALID_SHIFT_TIMES');

    return {
      organization_id: organizationId,
      location_id: locationId,
      employee_id: shift.employee_id,
      job_role_id: shift.job_role_id,
      starts_at: instants.startsAt,
      ends_at: instants.endsAt,
      timezone,
      planned_unpaid_break_minutes: shift.planned_unpaid_break_minutes,
      employee_note: shift.employee_note,
      manager_note: shift.manager_note,
      status: 'draft' as const,
      created_by: createdBy,
      updated_by: createdBy,
    };
  });

  await execute((db) => db.from(TABLES.shifts).insert(rows));
  return rows.length;
}

/**
 * Publica los turnos indicados y deja constancia de qué cambió (§11.3 pasos 6-7).
 *
 * La versión de publicación de cada turno la pone un trigger de la base, no el
 * cliente: las tardanzas se miden contra el turno publicado vigente y esa
 * versión no puede depender de lo que envíe una app.
 */
export async function publishShifts(params: {
  organizationId: string;
  locationId: string;
  weekStart: string;
  shiftIds: string[];
}): Promise<void> {
  const { organizationId, locationId, weekStart, shiftIds } = params;
  if (shiftIds.length === 0) return;

  await execute((db) =>
    db
      .from(TABLES.shifts)
      .update({ status: 'published', updated_by: actorId() })
      .in('id', shiftIds)
      .eq('status', 'draft'),
  );

  const previous = await fetchPublications({ locationId, weekStart });
  const nextVersion = (previous[0]?.publication_version ?? 0) + 1;

  await execute((db) =>
    db.from(TABLES.shiftPublications).insert({
      organization_id: organizationId,
      location_id: locationId,
      week_starts_on: weekStart,
      publication_version: nextVersion,
      published_by: actorId(),
      changed_shift_ids: shiftIds,
    }),
  );
}

export async function fetchPublications(params: {
  locationId: string;
  weekStart: string;
}): Promise<ShiftPublication[]> {
  return selectRows(z.array(publicationSchema), (db) =>
    db
      .from(TABLES.shiftPublications)
      .select('id, publication_version, published_at, changed_shift_ids')
      .eq('location_id', params.locationId)
      .eq('week_starts_on', params.weekStart)
      .order('publication_version', { ascending: false }),
  );
}
