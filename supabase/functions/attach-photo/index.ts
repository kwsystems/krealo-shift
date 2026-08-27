/**
 * `attach-photo` — sube la foto de un fichaje y deja el puntero en el evento (§9.6).
 *
 * POR QUÉ LA IMAGEN PASA POR AQUÍ Y NO POR UNA URL FIRMADA
 * Una URL firmada de subida haría falta si el archivo fuera grande. Estas no lo
 * son: el bucket limita a 2 MB y la app comprime antes de enviar. A cambio de un
 * poco de ancho de banda en la función, se gana lo que importa:
 *
 *   * `photo_path` se escribe DESPUÉS de que el archivo esté arriba. Con una URL
 *     firmada habría que apuntar la columna antes y confiar en que la subida
 *     ocurra; cada subida fallida dejaría la columna apuntando a un objeto que no
 *     existe, y nadie sabría distinguir eso de una foto purgada;
 *   * el iPad no recibe ninguna capacidad de escritura sobre Storage. Solo puede
 *     pedir esto, para un evento de SU ubicación.
 *
 * LA RUTA LA DERIVA EL SERVIDOR, siempre, con `attendance_photo_path`. Si el
 * cliente pudiera proponerla, podría apuntar la foto de un fichaje al archivo de
 * otro, o escribir fuera de su organización.
 *
 * ES IDEMPOTENTE: reintentar con la misma imagen sobrescribe el mismo objeto y
 * vuelve a dejar el mismo puntero. Con red mala el reintento es la norma, no la
 * excepción.
 */

import {
  errorResponse,
  jsonResponse,
  mapPostgresError,
  preflight,
  readJson,
} from '../_shared/http.ts';
import { authenticateKiosk, serviceClient } from '../_shared/kiosk-auth.ts';

const BUCKET = 'attendance-photos';
const MAX_BYTES = 2 * 1024 * 1024;

type Body = { eventId: string; imageBase64: string; contentType?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validate(value: unknown): Body | null {
  if (typeof value !== 'object' || value === null) return null;
  const { eventId, imageBase64, contentType } = value as Record<string, unknown>;
  if (typeof eventId !== 'string' || !UUID.test(eventId)) return null;
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) return null;
  // El bucket solo acepta estos dos; rechazarlo aquí da un error claro en vez de
  // uno de Storage que no dice nada.
  if (contentType !== undefined && contentType !== 'image/jpeg' && contentType !== 'image/webp') {
    return null;
  }
  return { eventId, imageBase64, contentType: (contentType as string) ?? 'image/jpeg' };
}

/** base64 → bytes. Devuelve `null` si la cadena no es base64 válida. */
function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return errorResponse('bad_request', 'Solo POST.', 405);

  const supabase = serviceClient();

  let kiosk;
  try {
    kiosk = await authenticateKiosk(request, supabase);
  } catch {
    return errorResponse('revoked', 'Este reloj fue desactivado.', 401);
  }
  if (kiosk === null) return errorResponse('revoked', 'Este reloj fue desactivado.', 401);

  const body = await readJson(request, validate);
  if (!body.ok) return errorResponse('bad_request', 'Petición incompleta.', 400);

  const bytes = decodeBase64(body.data.imageBase64);
  if (bytes === null) return errorResponse('bad_request', 'La imagen no es base64 válida.', 400);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return errorResponse('bad_request', 'La imagen no tiene un tamaño válido.', 400);
  }

  // El evento tiene que ser de LA UBICACIÓN de este kiosco. Sin esta comprobación
  // un iPad podría adjuntar fotos a fichajes de otra tienda, o de otra empresa.
  const event = await supabase
    .from('time_events')
    .select('id, location_id, organization_id')
    .eq('id', body.data.eventId)
    .maybeSingle();

  if (event.error) return mapPostgresError(event.error);
  if (!event.data || event.data.location_id !== kiosk.locationId) {
    // Mismo mensaje para "no existe" y "no es de aquí": distinguirlos permitiría
    // averiguar qué eventos existen probando identificadores.
    return errorResponse('bad_request', 'Ese fichaje no es de este reloj.', 404);
  }

  const pathResult = await supabase.rpc('attendance_photo_path', {
    p_event_id: body.data.eventId,
  });
  if (pathResult.error) return mapPostgresError(pathResult.error);

  const path = typeof pathResult.data === 'string' ? pathResult.data : null;
  if (path === null) return errorResponse('server_error', 'No pudimos calcular la ruta.', 500);

  const upload = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: body.data.contentType,
    // `upsert` es lo que hace idempotente el reintento.
    upsert: true,
  });

  if (upload.error) {
    // No se filtra el mensaje de Storage: puede llevar la ruta completa.
    return errorResponse('server_error', 'No pudimos guardar la foto.', 502);
  }

  // Y AHORA, no antes, se apunta la columna. El disparador append-only de
  // `time_events` permite exactamente este cambio y ningún otro.
  const update = await supabase
    .from('time_events')
    .update({ photo_path: path })
    .eq('id', body.data.eventId);

  if (update.error) return mapPostgresError(update.error);

  return jsonResponse({ ok: true, photoPath: path });
});
