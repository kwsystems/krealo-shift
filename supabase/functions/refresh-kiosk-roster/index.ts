/**
 * `refresh-kiosk-roster` (especificación §16).
 *
 * Devuelve lo mínimo que el iPad necesita para operar: identificador opaco del
 * empleado, nombre para mostrar DESPUÉS de verificar el PIN, puestos, turnos de
 * la ventana operativa y las políticas de la tienda.
 *
 * No devuelve email, teléfono, fecha de contratación ni el uuid interno del
 * empleado. Un iPad en el mostrador de una tienda es un dispositivo compartido y
 * físicamente accesible: lo que no está ahí no se puede filtrar.
 *
 * SOBRE LA VALIDACIÓN OFFLINE DEL PIN
 * Aquí se emiten también los verificadores que permiten validar un PIN sin red.
 * Son hashes bcrypt de coste 10 con su salt, no PIN recuperables: el dispositivo
 * compara, nunca descifra. La decisión de seguridad, sus alternativas y su costo
 * están explicados en `supabase/migrations/20260827000600_offline_pin.sql`.
 *
 * Solo llegan los verificadores de los empleados asignados a la ubicación de ESTE
 * kiosco, y un dispositivo revocado no recibe ninguno: eso es lo que hace que
 * revocar sirva también sin conexión.
 */

import { errorResponse, jsonResponse, mapPostgresError, preflight } from '../_shared/http.ts';
import { authenticateKiosk, serviceClient } from '../_shared/kiosk-auth.ts';

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
  if (kiosk === null) return errorResponse('revoked', 'Este reloj fue desactivado.', 401);

  const [location, organization, assignments, shifts, verifiers] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, timezone, settings')
      .eq('id', kiosk.locationId)
      .maybeSingle(),
    // El logotipo viaja en el refresco periódico y no solo en la activación: si un
    // administrador lo cambia, un kiosco ya instalado tiene que enterarse sin que
    // nadie vaya a la tienda a reactivarlo.
    supabase
      .from('organizations')
      .select('id, name, logo_path')
      .eq('id', kiosk.organizationId)
      .maybeSingle(),
    supabase
      .from('employee_location_assignments')
      .select('employee_id, employees:employee_id (id, full_name, preferred_name, status)')
      .eq('location_id', kiosk.locationId),
    // Ventana operativa: de ayer a pasado mañana. El iPad no necesita el
    // histórico ni el horario de la semana que viene para dejar fichar hoy.
    supabase
      .from('shifts')
      .select(
        'id, employee_id, starts_at, ends_at, employee_note, planned_unpaid_break_minutes, publication_version, job_roles:job_role_id (name)',
      )
      .eq('location_id', kiosk.locationId)
      .eq('status', 'published')
      .gte('starts_at', new Date(Date.now() - 24 * 3600_000).toISOString())
      .lte('starts_at', new Date(Date.now() + 48 * 3600_000).toISOString()),
    supabase.rpc('kiosk_offline_verifiers', { p_device_id: kiosk.deviceId }),
  ]);

  if (location.error) return mapPostgresError(location.error);
  if (assignments.error) return mapPostgresError(assignments.error);
  if (shifts.error) return mapPostgresError(shifts.error);
  if (verifiers.error) return mapPostgresError(verifiers.error);
  if (!location.data) return errorResponse('server_error', 'Ubicación no encontrada.', 500);

  const settings = (location.data.settings ?? {}) as Record<string, unknown>;

  // Identificador opaco por empleado: estable para el dispositivo, inútil fuera.
  const opaqueIds = new Map<string, string>();
  for (const row of assignments.data ?? []) {
    const employee = row.employees as { id: string; status: string } | null;
    if (!employee || employee.status !== 'active') continue;
    opaqueIds.set(employee.id, await sha256Hex(employee.id));
  }

  const roster = await Promise.all(
    (assignments.data ?? [])
      .map(
        (row) =>
          row.employees as {
            id: string;
            full_name: string;
            preferred_name: string | null;
            status: string;
          } | null,
      )
      .filter(
        (employee): employee is NonNullable<typeof employee> =>
          employee !== null && employee.status === 'active',
      )
      .map(async (employee) => ({
        opaqueId: opaqueIds.get(employee.id) ?? (await sha256Hex(employee.id)),
        // El nombre viaja porque el kiosco lo muestra tras validar el PIN, nunca
        // antes (§9.2). No viaja ningún otro dato personal.
        displayName: employee.preferred_name?.trim() || employee.full_name,
      })),
  );

  const shiftsByOpaqueId = await Promise.all(
    (shifts.data ?? []).map(async (shift) => ({
      id: shift.id,
      employeeOpaqueId: await sha256Hex(shift.employee_id),
      startsAt: shift.starts_at,
      endsAt: shift.ends_at,
      jobRoleName: (shift.job_roles as { name?: string } | null)?.name ?? null,
      employeeNote: shift.employee_note,
      plannedUnpaidBreakMinutes: shift.planned_unpaid_break_minutes,
      changedSinceLastPublication: (shift.publication_version ?? 0) > 1,
    })),
  );

  return jsonResponse({
    location: {
      id: location.data.id,
      name: location.data.name,
      timezone: location.data.timezone,
    },
    // `null` si no hay logotipo o si la consulta no devolvió nada: el kiosco pinta
    // el nombre de la app en su lugar, que es lo que hacía antes de existir esto.
    organization: {
      name: organization.data?.name ?? null,
      logoPath: organization.data?.logo_path ?? null,
    },
    policies: {
      pinLength: Number(settings.pinLength ?? 6),
      photoEnabled: settings.photoEnabled === true,
      earlyClockInMinutes: Number(settings.earlyClockInMinutes ?? 10),
      lateGraceMinutes: Number(settings.lateGraceMinutes ?? 5),
      allowUnscheduledShifts: settings.allowUnscheduledShifts !== false,
      timeFormat: settings.timeFormat === '12h' ? '12h' : '24h',
      requiredBreakMinutes: Number(settings.requiredBreakMinutes ?? 0),
    },
    roster,
    shifts: shiftsByOpaqueId,
    // El servidor manda el SALT de bcrypt y un VERIFICADOR derivado con la clave
    // de este dispositivo, nunca el hash. El iPad calcula bcrypt(PIN, salt) y lo
    // re-deriva con su clave del Keychain para comparar.
    //
    // La diferencia práctica: si alguien se lleva el archivo SQLite del iPad —un
    // backup sin cifrar, un bug de compartición— no puede probar ni un PIN, porque
    // le falta la clave. Ver 20260827000700_offline_verifier_device_key.sql.
    verifiers: (Array.isArray(verifiers.data) ? verifiers.data : []).map(
      (row: {
        employee_opaque_id: string;
        pin_salt: string;
        pin_verifier: string;
        pin_length: number;
        pin_version: number;
      }) => ({
        employeeOpaqueId: row.employee_opaque_id,
        pinSalt: row.pin_salt,
        pinVerifier: row.pin_verifier,
        pinLength: row.pin_length,
        pinVersion: row.pin_version,
      }),
    ),
    refreshedAt: new Date().toISOString(),
  });
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
