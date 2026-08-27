import { z } from 'zod';

import { adjustWorkSession } from '@/features/timesheets/api';
import { execute, selectRows } from '@/hooks/use-admin-query';
import { useSessionStore } from '@/stores/session-store';
import { TABLES } from '@/lib/supabase/types';

/**
 * Bandeja de solicitudes (§11.5).
 *
 * Aprobar una corrección no cambia el evento original: aplica un ajuste
 * auditable con `manager_adjust_time`, que conserva valor anterior, valor nuevo,
 * autor, motivo y fecha de servidor. Rechazar tampoco borra nada: deja la
 * decisión y el comentario.
 */

export const requestKindValues = [
  'forgot_clock_in',
  'forgot_break',
  'forgot_clock_out',
  'correction',
  'unscheduled_shift',
] as const;
export type RequestKind = (typeof requestKindValues)[number];

export const requestStatusValues = ['pending', 'approved', 'rejected'] as const;
export type RequestStatus = (typeof requestStatusValues)[number];

const proposedValueSchema = z
  .object({
    startsAt: z.string().nullable().optional(),
    endsAt: z.string().nullable().optional(),
    proposedAt: z.string().nullable().optional(),
    channel: z.string().optional(),
  })
  .catch({});

const requestSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  location_id: z.string().uuid(),
  work_session_id: z.string().uuid().nullable(),
  target_date: z.string().nullable(),
  kind: z.enum(requestKindValues),
  proposed_value: proposedValueSchema,
  reason: z.string(),
  status: z.enum(requestStatusValues),
  reviewer_comment: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
});

export type TimeEditRequest = z.infer<typeof requestSchema>;

/** Las tres pestañas de la bandeja (§11.5). */
export type RequestTab = 'corrections' | 'forgot' | 'unscheduled';

export function tabForKind(kind: RequestKind): RequestTab {
  if (kind === 'correction') return 'corrections';
  if (kind === 'unscheduled_shift') return 'unscheduled';
  return 'forgot';
}

export async function fetchRequests(params: {
  organizationId: string;
  locationId: string;
}): Promise<TimeEditRequest[]> {
  return selectRows(z.array(requestSchema), (db) =>
    db
      .from(TABLES.timeEditRequests)
      .select(
        'id, employee_id, location_id, work_session_id, target_date, kind, proposed_value, reason, status, reviewer_comment, reviewed_at, created_at',
      )
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .order('created_at', { ascending: false })
      .limit(200),
  );
}

export async function countPendingRequests(params: {
  organizationId: string;
  locationId: string;
}): Promise<number> {
  const rows = await selectRows(z.array(z.object({ id: z.string().uuid() })), (db) =>
    db
      .from(TABLES.timeEditRequests)
      .select('id')
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .eq('status', 'pending'),
  );
  return rows.length;
}

/** Solo comenta: no decide. Sirve para pedir contexto antes de resolver. */
export async function commentRequest(params: {
  requestId: string;
  comment: string;
}): Promise<void> {
  await execute((db) =>
    db
      .from(TABLES.timeEditRequests)
      .update({ reviewer_comment: params.comment.trim() })
      .eq('id', params.requestId),
  );
}

export type ReviewDecision = 'approved' | 'rejected';

/**
 * Aprueba o rechaza. Si al aprobar la solicitud propone horas concretas sobre una
 * sesión existente, se aplica el ajuste en el servidor antes de marcar la
 * solicitud: si el ajuste falla, la solicitud sigue pendiente y no queda una
 * aprobación que nadie aplicó.
 */
export async function reviewRequest(params: {
  request: TimeEditRequest;
  decision: ReviewDecision;
  comment: string | null;
}): Promise<{ applied: boolean }> {
  const { request, decision, comment } = params;
  let applied = false;

  const proposedStart =
    request.proposed_value.startsAt ?? request.proposed_value.proposedAt ?? null;
  const proposedEnd = request.proposed_value.endsAt ?? null;

  if (
    decision === 'approved' &&
    request.work_session_id !== null &&
    (proposedStart !== null || proposedEnd !== null)
  ) {
    await adjustWorkSession({
      workSessionId: request.work_session_id,
      // Sin comprobación de concurrencia: la solicitud puede llevar días abierta
      // y su `updated_at` de referencia ya no dice nada útil.
      expectedUpdatedAt: null,
      newStartsAt: proposedStart,
      newEndsAt: proposedEnd,
      reason: `${request.reason}${comment === null || comment.trim() === '' ? '' : ` — ${comment.trim()}`}`,
    });
    applied = true;
  }

  await execute((db) =>
    db
      .from(TABLES.timeEditRequests)
      .update({
        status: decision,
        reviewed_by: useSessionStore.getState().user?.userId ?? null,
        reviewed_at: new Date().toISOString(),
        reviewer_comment: comment === null || comment.trim() === '' ? null : comment.trim(),
      })
      .eq('id', request.id),
  );

  return { applied };
}
