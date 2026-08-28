/**
 * `submit-time-edit-request` — la acción "Olvidé marcar" del kiosco (§10.3).
 *
 * Crea una solicitud PENDIENTE. Nunca modifica la hoja de tiempo: eso lo decide
 * un gerente, y su decisión queda auditada. Es la diferencia entre un empleado
 * que reporta un olvido y un empleado que se edita sus propias horas.
 */

import {
  errorResponse,
  isNonEmptyString,
  isUuid,
  jsonResponse,
  mapPostgresError,
  preflight,
  readJson,
} from '../_shared/http.ts';
import { authenticateKiosk, serviceClient, verifyActionToken } from '../_shared/kiosk-auth.ts';

const KINDS = ['forgot_clock_in', 'forgot_break', 'forgot_clock_out'] as const;

type Body = {
  actionToken: string;
  kind: (typeof KINDS)[number];
  proposedAt: string;
  reason: string;
};

function validate(value: unknown): Body | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.actionToken !== 'string' || v.actionToken.length < 20) return null;
  if (typeof v.kind !== 'string' || !KINDS.includes(v.kind as Body['kind'])) return null;
  if (!isNonEmptyString(v.proposedAt, 64)) return null;
  // El motivo es obligatorio: una corrección sin motivo no es auditable (§11.4).
  if (!isNonEmptyString(v.reason, 500)) return null;

  return {
    actionToken: v.actionToken,
    kind: v.kind as Body['kind'],
    proposedAt: v.proposedAt,
    reason: v.reason.trim(),
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return errorResponse('bad_request', 'Solo POST.', 405);

  const supabase = serviceClient();

  let kiosk;
  try {
    kiosk = await authenticateKiosk(request, supabase);
  } catch (error) {
    return mapPostgresError(error as { code?: string; message?: string });
  }
  if (kiosk === null) return errorResponse('revoked', 'Este reloj no está activo.', 401);

  const body = await readJson(request, validate);
  if (!body.ok) return body.response;

  const claim = await verifyActionToken(body.data.actionToken, kiosk);
  if (claim === null) return errorResponse('not_authorized', 'Vuelve a ingresar tu PIN.', 401);

  const { data, error } = await supabase
    .from('time_edit_requests')
    .insert({
      organization_id: kiosk.organizationId,
      employee_id: claim.employeeId,
      location_id: kiosk.locationId,
      kind: body.data.kind,
      // La hora propuesta se guarda tal como la escribió el empleado, sin
      // interpretarla: es una propuesta, no un dato del sistema.
      proposed_value: { proposedAt: body.data.proposedAt, source: 'kiosk' },
      reason: body.data.reason,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) return mapPostgresError(error);
  if (!isUuid(data?.id))
    return errorResponse('server_error', 'No se pudo crear la solicitud.', 500);

  return jsonResponse({ requestId: data.id, status: 'pending' });
});
