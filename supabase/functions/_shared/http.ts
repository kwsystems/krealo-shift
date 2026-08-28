/**
 * Utilidades HTTP compartidas por las Edge Functions (especificación §16).
 *
 * Dos reglas que se aplican aquí y no en cada función:
 *   - las respuestas son consistentes y tipadas: `{ code, message }` en el error,
 *     nunca un stack trace ni el mensaje crudo de Postgres (§20);
 *   - los códigos de error son los que la app sabe traducir, y se derivan del
 *     `errcode` de la excepción de la base, no de comparar textos.
 */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-kiosk-credential, x-kiosk-device',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

export type ErrorCode =
  | 'revoked'
  | 'invalid_pin'
  | 'locked'
  | 'wrong_location'
  | 'invalid_transition'
  | 'too_early'
  | 'not_authorized'
  | 'bad_request'
  | 'server_error';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ code, message, ...extra }, status);
}

export function preflight(): Response {
  return new Response('ok', { headers: CORS_HEADERS });
}

/**
 * Traduce una excepción de Postgres a un código que la app entiende.
 *
 * Las funciones SQL levantan excepciones con `errcode` explícito precisamente
 * para que esta traducción no dependa de leer mensajes en español.
 */
export function mapPostgresError(error: { code?: string; message?: string }): Response {
  switch (error.code) {
    case '28000': // invalid_authorization_specification
      return errorResponse('revoked', 'Este reloj fue desactivado.', 401);
    case '42501': // insufficient_privilege
      return errorResponse('wrong_location', 'Este iPad pertenece a otra tienda.', 403);
    case '23514': // check_violation
      // Cubre transición imposible y entrada temprana; el detalle lo pone la app
      // con su propio texto localizado.
      return errorResponse(
        'invalid_transition',
        'Esa acción no corresponde al estado actual.',
        409,
      );
    case '40001': // serialization_failure
      return errorResponse('bad_request', 'Alguien más cambió este dato. Vuelve a cargarlo.', 409);
    case '02000': // no_data_found
      return errorResponse('bad_request', 'El dato solicitado no existe.', 404);
    default:
      // Nunca se devuelve `error.message` al cliente: puede contener nombres de
      // tablas, columnas o valores. Solo se registra del lado del servidor.
      console.error('[edge] error no mapeado', error.code, error.message);
      return errorResponse('server_error', 'No pudimos completar la acción.', 500);
  }
}

/** Lee y valida el cuerpo JSON. Un cuerpo inválido nunca llega a la base. */
export async function readJson<T>(
  request: Request,
  validate: (value: unknown) => T | null,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: errorResponse('bad_request', 'Cuerpo JSON inválido.') };
  }

  const parsed = validate(raw);
  if (parsed === null) {
    return { ok: false, response: errorResponse('bad_request', 'Faltan campos obligatorios.') };
  }
  return { ok: true, data: parsed };
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function isNonEmptyString(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
