import * as Crypto from 'expo-crypto';
import { z } from 'zod';

import { execute, requireClient, selectRows, toAdminError } from '@/hooks/use-admin-query';
import { useSessionStore } from '@/stores/session-store';
import { RPC, TABLES, VIEWS } from '@/lib/supabase/types';

/**
 * Horas y hojas de tiempo (§11.4).
 *
 * Reglas de la especificación que este archivo respeta al pie de la letra:
 *   - los eventos crudos son append-only: la app NUNCA los edita ni los borra;
 *   - una corrección es un ajuste auditable con motivo obligatorio, y la hace
 *     `manager_adjust_time` en el servidor, que guarda valor anterior, valor
 *     nuevo, autor, fecha de servidor y motivo;
 *   - aprobar un periodo lo hace `approve_timesheet_period`, que se niega si
 *     quedan sesiones por revisar.
 */

const dailySummarySchema = z.object({
  employee_id: z.string().uuid(),
  location_id: z.string().uuid(),
  work_date: z.string(),
  sessions: z.coerce.number().int(),
  gross_minutes: z.coerce.number().int(),
  paid_break_minutes: z.coerce.number().int(),
  unpaid_break_minutes: z.coerce.number().int(),
  net_minutes: z.coerce.number().int(),
  needs_review: z.boolean().nullable(),
  flags: z.array(z.string()).nullable(),
});

export type DailySummary = z.infer<typeof dailySummarySchema>;

export const workSessionStatusValues = ['open', 'complete', 'needs_review', 'approved'] as const;
export type WorkSessionStatus = (typeof workSessionStatusValues)[number];

const workSessionSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  location_id: z.string().uuid(),
  shift_id: z.string().uuid().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  gross_minutes: z.number().int().nullable(),
  paid_break_minutes: z.number().int(),
  unpaid_break_minutes: z.number().int(),
  net_minutes: z.number().int().nullable(),
  status: z.enum(workSessionStatusValues),
  flags: z.array(z.string()),
  updated_at: z.string(),
});

export type WorkSession = z.infer<typeof workSessionSchema>;

const timeEventSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  event_type: z.enum(['clock_in', 'break_start', 'break_end', 'clock_out']),
  break_type: z.enum(['paid', 'unpaid', 'meal', 'other']).nullable(),
  occurred_at: z.string(),
  source: z.enum(['kiosk', 'manager', 'import']),
  is_offline: z.boolean(),
});

export type TimeEvent = z.infer<typeof timeEventSchema>;

const adjustmentSchema = z.object({
  id: z.string().uuid(),
  work_session_id: z.string().uuid().nullable(),
  target_type: z.string(),
  before_value: z.unknown(),
  after_value: z.unknown(),
  reason: z.string(),
  created_at: z.string(),
  channel: z.string(),
});

export type TimeAdjustment = z.infer<typeof adjustmentSchema>;

export const periodStatusValues = ['open', 'approved', 'reopened'] as const;
export type PeriodStatus = (typeof periodStatusValues)[number];

const periodSchema = z.object({
  id: z.string().uuid(),
  location_id: z.string().uuid().nullable(),
  starts_on: z.string(),
  ends_on: z.string(),
  status: z.enum(periodStatusValues),
  approved_at: z.string().nullable(),
});

export type TimesheetPeriod = z.infer<typeof periodSchema>;

export async function fetchDailySummaries(params: {
  locationId: string;
  from: string;
  to: string;
}): Promise<DailySummary[]> {
  return selectRows(z.array(dailySummarySchema), (db) =>
    db
      .from(VIEWS.dailyTimeSummary)
      .select(
        'employee_id, location_id, work_date, sessions, gross_minutes, paid_break_minutes, unpaid_break_minutes, net_minutes, needs_review, flags',
      )
      .eq('location_id', params.locationId)
      .gte('work_date', params.from)
      .lte('work_date', params.to)
      .order('work_date', { ascending: true }),
  );
}

export async function fetchWorkSessions(params: {
  locationId: string;
  fromISO: string;
  toISO: string;
}): Promise<WorkSession[]> {
  return selectRows(z.array(workSessionSchema), (db) =>
    db
      .from(TABLES.workSessions)
      .select(
        'id, employee_id, location_id, shift_id, starts_at, ends_at, gross_minutes, paid_break_minutes, unpaid_break_minutes, net_minutes, status, flags, updated_at',
      )
      .eq('location_id', params.locationId)
      .gte('starts_at', params.fromISO)
      .lt('starts_at', params.toISO)
      .order('starts_at', { ascending: true }),
  );
}

export async function fetchTimeEvents(params: {
  employeeId: string;
  fromISO: string;
  toISO: string;
}): Promise<TimeEvent[]> {
  return selectRows(z.array(timeEventSchema), (db) =>
    db
      .from(TABLES.timeEvents)
      .select('id, employee_id, event_type, break_type, occurred_at, source, is_offline')
      .eq('employee_id', params.employeeId)
      .gte('occurred_at', params.fromISO)
      .lt('occurred_at', params.toISO)
      .order('occurred_at', { ascending: true }),
  );
}

export async function fetchAdjustments(sessionIds: string[]): Promise<TimeAdjustment[]> {
  if (sessionIds.length === 0) return [];
  return selectRows(z.array(adjustmentSchema), (db) =>
    db
      .from(TABLES.timeAdjustments)
      .select(
        'id, work_session_id, target_type, before_value, after_value, reason, created_at, channel',
      )
      .in('work_session_id', sessionIds)
      .order('created_at', { ascending: false }),
  );
}

/**
 * Corrección de una sesión con motivo obligatorio (§11.4).
 *
 * `expectedUpdatedAt` va al servidor para que dos gerentes editando lo mismo no
 * se pisen en silencio: si cambió, la función devuelve conflicto y la pantalla
 * pide recargar.
 */
export async function adjustWorkSession(params: {
  workSessionId: string;
  expectedUpdatedAt: string | null;
  newStartsAt: string | null;
  newEndsAt: string | null;
  reason: string;
}): Promise<void> {
  const reason = params.reason.trim();
  if (reason.length === 0) throw toAdminError({ code: '23514', message: 'REASON_REQUIRED' });

  const db = requireClient();
  try {
    const { error } = await db.rpc(RPC.managerAdjustTime, {
      p_work_session_id: params.workSessionId,
      p_expected_updated_at: params.expectedUpdatedAt,
      p_new_starts_at: params.newStartsAt,
      p_new_ends_at: params.newEndsAt,
      p_reason: reason,
    });
    if (error !== null) throw toAdminError(error);
  } catch (error) {
    throw toAdminError(error);
  }
}

export async function fetchPeriod(params: {
  organizationId: string;
  locationId: string;
  from: string;
  to: string;
}): Promise<TimesheetPeriod | null> {
  const rows = await selectRows(z.array(periodSchema), (db) =>
    db
      .from(TABLES.timesheetPeriods)
      .select('id, location_id, starts_on, ends_on, status, approved_at')
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .eq('starts_on', params.from)
      .eq('ends_on', params.to)
      .limit(1),
  );
  return rows[0] ?? null;
}

/** El periodo se crea la primera vez que alguien lo aprueba o lo consulta. */
export async function ensurePeriod(params: {
  organizationId: string;
  locationId: string;
  from: string;
  to: string;
}): Promise<TimesheetPeriod> {
  const existing = await fetchPeriod(params);
  if (existing !== null) return existing;

  return selectRows(periodSchema, (db) =>
    db
      .from(TABLES.timesheetPeriods)
      .insert({
        organization_id: params.organizationId,
        location_id: params.locationId,
        starts_on: params.from,
        ends_on: params.to,
      })
      .select('id, location_id, starts_on, ends_on, status, approved_at')
      .single(),
  );
}

export async function approvePeriod(periodId: string): Promise<void> {
  const db = requireClient();
  try {
    const { error } = await db.rpc(RPC.approveTimesheetPeriod, { p_period_id: periodId });
    if (error !== null) throw toAdminError(error);
  } catch (error) {
    throw toAdminError(error);
  }
}

/** Reabrir devuelve el periodo a edición y queda constancia del estado. */
export async function reopenPeriod(periodId: string): Promise<void> {
  await execute((db) =>
    db
      .from(TABLES.timesheetPeriods)
      .update({ status: 'reopened', approved_at: null, approved_by: null })
      .eq('id', periodId),
  );
}

const exportRowSchema = z.object({
  employee_name: z.string(),
  work_date: z.string(),
  clock_in: z.string().nullable(),
  clock_out: z.string().nullable(),
  gross_minutes: z.number().int().nullable(),
  paid_break_minutes: z.number().int().nullable(),
  unpaid_break_minutes: z.number().int().nullable(),
  net_minutes: z.number().int().nullable(),
  net_hours_decimal: z.coerce.number(),
  status: z.string(),
  flags: z.array(z.string()).nullable(),
});

export type TimesheetExportRow = z.infer<typeof exportRowSchema>;

/** Filas de exportación filtradas por rol y ubicación en el servidor (§16). */
export async function fetchExportRows(params: {
  locationId: string;
  from: string;
  to: string;
}): Promise<TimesheetExportRow[]> {
  const db = requireClient();
  try {
    const { data, error } = await db.rpc(RPC.exportTimesheetRows, {
      p_location_id: params.locationId,
      p_from: params.from,
      p_to: params.to,
    });
    if (error !== null) throw toAdminError(error);
    const parsed = z.array(exportRowSchema).safeParse(data);
    if (!parsed.success) throw toAdminError({ code: 'shape', message: parsed.error.message });
    return parsed.data;
  } catch (error) {
    throw toAdminError(error);
  }
}

const manualEventRowSchema = z.object({
  event_id: z.string().uuid(),
  // Un descanso no abre ni cierra sesion, asi que puede volver sin sesion asociada.
  work_session_id: z.string().uuid().nullable(),
});

export const manualEntryKinds = ['forgot_clock_in', 'forgot_clock_out', 'correction'] as const;
export type ManualEntryKind = (typeof manualEntryKinds)[number];

/**
 * Solicitud de corrección creada por el gerente.
 *
 * SIGUE EXISTIENDO, y no es lo mismo que `addManualTimeEvent`. Se usa cuando el
 * gerente no sabe la hora exacta, o cuando el caso necesita que alguien más lo
 * revise: la solicitud aparece en la bandeja con el resto de las correcciones y
 * alguien la aprueba. `addManualTimeEvent` registra el fichaje directamente,
 * cuando el gerente ya sabe qué pasó y actúa él.
 */
export async function createManualEntryRequest(params: {
  organizationId: string;
  locationId: string;
  employeeId: string;
  kind: ManualEntryKind;
  targetDate: string;
  proposedAt: string | null;
  proposedEndAt: string | null;
  reason: string;
  workSessionId?: string | null;
}): Promise<void> {
  const reason = params.reason.trim();
  if (reason.length === 0) throw toAdminError({ code: '23514', message: 'REASON_REQUIRED' });

  await execute((db) =>
    db.from(TABLES.timeEditRequests).insert({
      organization_id: params.organizationId,
      employee_id: params.employeeId,
      location_id: params.locationId,
      work_session_id: params.workSessionId ?? null,
      target_date: params.targetDate,
      kind: params.kind,
      proposed_value: {
        startsAt: params.proposedAt,
        endsAt: params.proposedEndAt,
        createdBy: useSessionStore.getState().user?.userId ?? null,
        channel: 'manager_app',
      },
      reason,
    }),
  );
}

/**
 * Fichaje manual DIRECTO del gerente (§11.4 "agregar fichaje manual con motivo").
 *
 * Pasa por el RPC `manager_add_time_event`, no por un insert: la app no tiene
 * —ni debe tener— permiso de escritura sobre `time_events`. El servidor comprueba
 * que quien llama administre la ubicación, que el empleado sea de esa ubicación y
 * de esa empresa, que el motivo no esté vacío, que la hora no esté en el futuro y
 * que la transición encaje con el estado del empleado EN ESE INSTANTE, no en el
 * actual.
 *
 * Crea un evento nuevo marcado `source = 'manager'`; no edita ninguno existente,
 * porque `time_events` es append-only. El motivo queda en `time_adjustments` y en
 * `audit_logs`.
 *
 * La clave de idempotencia se genera aquí, antes de enviar, para que un doble toque
 * del botón no produzca dos fichajes. Es la misma razón que en el kiosco.
 */
export async function addManualTimeEvent(params: {
  employeeId: string;
  locationId: string;
  eventType: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  occurredAt: string;
  reason: string;
  breakType?: 'paid' | 'unpaid' | 'meal' | 'other' | null;
  shiftId?: string | null;
}): Promise<{ eventId: string; workSessionId: string | null }> {
  const reason = params.reason.trim();
  if (reason.length === 0) throw toAdminError({ code: '23514', message: 'REASON_REQUIRED' });

  const db = requireClient();
  try {
    const { data, error } = await db.rpc(RPC.managerAddTimeEvent, {
      p_employee_id: params.employeeId,
      p_location_id: params.locationId,
      p_event_type: params.eventType,
      p_occurred_at: params.occurredAt,
      p_reason: reason,
      p_break_type: params.breakType ?? null,
      p_shift_id: params.shiftId ?? null,
      p_idempotency_key: Crypto.randomUUID(),
    });
    if (error !== null) throw toAdminError(error);

    const parsed = z.array(manualEventRowSchema).safeParse(data);
    const row = parsed.success ? parsed.data[0] : undefined;
    if (row === undefined) {
      // El servidor respondió con otra forma: no se inventa un resultado (§20).
      throw toAdminError({ code: 'shape', message: 'UNEXPECTED_SHAPE' });
    }
    return { eventId: row.event_id, workSessionId: row.work_session_id };
  } catch (error) {
    throw toAdminError(error);
  }
}
