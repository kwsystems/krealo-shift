/**
 * `verify-pin` (especificación §16).
 *
 * Valida el PIN de un empleado en la ubicación del kiosco, limita intentos y
 * devuelve un token de acción de corta duración ligado a empleado + kiosco +
 * ubicación.
 *
 * Lo que NUNCA hace:
 *   - devolver el hash del PIN ni parte de él;
 *   - decir a quién pertenece un PIN incorrecto o bloqueado;
 *   - devolver la lista del personal (§9.2: nunca se revela antes de validar).
 */

import {
  errorResponse,
  jsonResponse,
  mapPostgresError,
  preflight,
  readJson,
} from '../_shared/http.ts';
import { authenticateKiosk, issueActionToken, serviceClient } from '../_shared/kiosk-auth.ts';

type Body = { pin: string; locationId?: string };

function validate(value: unknown): Body | null {
  if (typeof value !== 'object' || value === null) return null;
  const { pin } = value as Record<string, unknown>;
  // Entre 4 y 6 dígitos: cualquier otra cosa no llega a la base.
  if (typeof pin !== 'string' || !/^[0-9]{4,6}$/.test(pin)) return null;
  return { pin };
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
  if (kiosk === null) {
    return errorResponse('revoked', 'Este reloj no está activo.', 401);
  }

  const body = await readJson(request, validate);
  if (!body.ok) return body.response;

  const { data, error } = await supabase.rpc('verify_employee_pin', {
    p_location_id: kiosk.locationId,
    p_pin: body.data.pin,
  });

  if (error) return mapPostgresError(error);

  const row = Array.isArray(data) ? data[0] : data;

  if (!row || row.employee_id === null) {
    if (row?.locked_until) {
      return errorResponse('locked', 'Demasiados intentos.', 429, {
        lockedUntil: row.locked_until,
      });
    }
    // Mismo mensaje para "no existe" y "PIN equivocado": distinguirlos permitiría
    // averiguar qué PIN pertenece a alguien probando de uno en uno.
    return errorResponse('invalid_pin', 'Ese PIN no es correcto.', 401, {
      remainingAttempts: row?.remaining_attempts ?? null,
    });
  }

  const employeeId: string = row.employee_id;

  const context = await supabase.rpc('kiosk_employee_context', {
    p_employee_id: employeeId,
    p_location_id: kiosk.locationId,
  });

  if (context.error) return mapPostgresError(context.error);
  if (!context.data) {
    return errorResponse('bad_request', 'No pudimos preparar tu turno.', 404);
  }

  const { token, expiresAt } = await issueActionToken({
    employeeId,
    deviceId: kiosk.deviceId,
    locationId: kiosk.locationId,
  });

  return jsonResponse({
    actionToken: token,
    expiresAt,
    ...context.data,
  });
});
