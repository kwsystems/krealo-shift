/**
 * `activate-kiosk` (especificación §16).
 *
 * Canjea un código de activación temporal y devuelve la credencial limitada del
 * dispositivo, su organización y ubicación, las políticas de esa tienda y el
 * paquete mínimo para operar offline desde el primer momento.
 *
 * Esta es la única función del kiosco que NO exige credencial previa: es
 * justamente la que la emite. Por eso el código es de un solo uso, caduca, y su
 * hash es lo único que queda en la base.
 */

import {
  errorResponse,
  isNonEmptyString,
  jsonResponse,
  mapPostgresError,
  preflight,
  readJson,
} from '../_shared/http.ts';
import { serviceClient } from '../_shared/kiosk-auth.ts';

type Body = {
  activationCode: string;
  installationId: string;
  displayName: string;
  appVersion: string;
};

function validate(value: unknown): Body | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.activationCode, 64)) return null;
  if (!isNonEmptyString(v.installationId, 128)) return null;
  return {
    activationCode: v.activationCode.trim().toUpperCase(),
    installationId: v.installationId,
    displayName: isNonEmptyString(v.displayName, 80) ? v.displayName.trim() : 'iPad',
    appVersion: isNonEmptyString(v.appVersion, 32) ? v.appVersion : '0.0.0',
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return errorResponse('bad_request', 'Solo POST.', 405);

  const body = await readJson(request, validate);
  if (!body.ok) return body.response;

  const supabase = serviceClient();

  const { data, error } = await supabase.rpc('activate_kiosk_device', {
    p_code: body.data.activationCode,
    p_installation_id: body.data.installationId,
    p_display_name: body.data.displayName,
    p_app_version: body.data.appVersion,
  });

  if (error) {
    // Un código inválido o vencido es un caso normal, no un fallo del servidor:
    // alguien tecleó mal o tardó demasiado.
    if (error.code === '28000') {
      return errorResponse('not_authorized', 'Código de activación inválido o vencido.', 401);
    }
    return mapPostgresError(error);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return errorResponse('not_authorized', 'Código de activación inválido.', 401);

  const [org, location] = await Promise.all([
    supabase.from('organizations').select('id, name').eq('id', row.organization_id).maybeSingle(),
    supabase
      .from('locations')
      .select('id, name, timezone, settings')
      .eq('id', row.location_id)
      .maybeSingle(),
  ]);

  if (org.error) return mapPostgresError(org.error);
  if (location.error) return mapPostgresError(location.error);
  if (!org.data || !location.data) {
    return errorResponse('server_error', 'La activación quedó incompleta.', 500);
  }

  const settings = (location.data.settings ?? {}) as Record<string, unknown>;

  // La clave del dispositivo se deriva de la credencial: es lo que firma los
  // eventos offline y el verificador local del PIN, y nunca viaja después.
  const deviceKey = row.credential;

  return jsonResponse({
    credential: row.credential,
    deviceKey,
    device: {
      id: row.device_id,
      publicId: row.device_public_id,
      displayName: body.data.displayName,
    },
    organization: { id: org.data.id, name: org.data.name },
    location: {
      id: location.data.id,
      name: location.data.name,
      timezone: location.data.timezone,
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
  });
});
