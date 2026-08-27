/**
 * Autenticación del kiosco y token de acción (especificación §8, §16).
 *
 * Dos mecanismos distintos, a propósito:
 *
 *   1. CREDENCIAL DEL DISPOSITIVO — larga vida, ligada al iPad y a UNA ubicación.
 *      Viaja en la cabecera `x-kiosk-credential`. Se valida contra el hash bcrypt
 *      guardado en la base con la función `authenticate_kiosk`.
 *
 *   2. TOKEN DE ACCIÓN — vida de 90 segundos, ligado a empleado + kiosco +
 *      ubicación. Lo emite `verify-pin` tras validar el PIN y lo consume
 *      `submit-time-event`. Es lo que evita que alguien registre un fichaje
 *      ajeno conociendo solo la credencial del iPad.
 *
 * El token es un HMAC firmado, sin estado en la base: un token robado caduca en
 * 90 segundos y no hay tabla que limpiar. El secreto vive en el entorno de las
 * Edge Functions, nunca en la app (§22).
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const ACTION_TOKEN_TTL_SECONDS = 90;

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  }
  // `service_role` solo existe aquí, en el servidor. Nunca sale a la app.
  return createClient(url, key, { auth: { persistSession: false } });
}

export type KioskContext = {
  deviceId: string;
  organizationId: string;
  locationId: string;
};

/**
 * Registra un intento de fichaje rechazado, para la alerta de §19 "intento de
 * fichaje desde un kiosco revocado o incorrecto".
 *
 * POR QUÉ SE REGISTRA AQUÍ Y NO EN LA FUNCIÓN SQL
 * Porque `authenticate_kiosk` y `submit_time_event` rechazan levantando una
 * excepción, y una excepción aborta la transacción: un `insert` dentro de la misma
 * función se desharía junto con ella. Postgres no tiene transacciones autónomas,
 * así que el registro tiene que ocurrir en una petición nueva, o sea desde aquí.
 *
 * Nunca lanza. Un fallo al anotar el intento no debe cambiar la respuesta que
 * recibe el iPad: la respuesta correcta sigue siendo "este reloj no está activo".
 */
export async function recordKioskRejection(
  supabase: SupabaseClient,
  params: { devicePublicId: string; reason: 'revoked' | 'wrong_location'; employeeId?: string },
): Promise<void> {
  try {
    const { error } = await supabase.rpc('record_kiosk_rejection', {
      p_device_public_id: params.devicePublicId,
      p_reason: params.reason,
      p_employee_id: params.employeeId ?? null,
    });
    if (error) console.error('[edge] no se pudo anotar el rechazo', error.code);
  } catch {
    console.error('[edge] no se pudo anotar el rechazo');
  }
}

/**
 * Valida la credencial del dispositivo. Devuelve `null` si falta la cabecera, y
 * lanza si la credencial es inválida o el dispositivo está revocado.
 */
export async function authenticateKiosk(
  request: Request,
  supabase: SupabaseClient,
): Promise<KioskContext | null> {
  const credential = request.headers.get('x-kiosk-credential');
  const publicId = request.headers.get('x-kiosk-device');
  if (!credential || !publicId) return null;

  const { data, error } = await supabase.rpc('authenticate_kiosk', {
    p_public_id: publicId,
    p_credential: credential,
  });

  if (error) {
    // Este es el punto por el que pasan TODAS las peticiones del kiosco, así que
    // anotar aquí cubre las siete funciones de una vez: un iPad revocado que sigue
    // encendido queda registrado sin importar qué endpoint intente.
    if (error.code === '28000') {
      await recordKioskRejection(supabase, { devicePublicId: publicId, reason: 'revoked' });
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    deviceId: row.device_id,
    organizationId: row.organization_id,
    locationId: row.location_id,
  };
}

// ---------------------------------------------------------------------------
// Token de acción
// ---------------------------------------------------------------------------

type ActionTokenPayload = {
  employeeId: string;
  deviceId: string;
  locationId: string;
  exp: number;
};

function tokenSecret(): Uint8Array {
  const secret = Deno.env.get('KIOSK_TOKEN_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error('KIOSK_TOKEN_SECRET falta o tiene menos de 32 caracteres.');
  }
  return new TextEncoder().encode(secret);
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    tokenSecret(),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64Url(new Uint8Array(signature));
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodePayload(payload: ActionTokenPayload): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodePayload(encoded: string): ActionTokenPayload | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const value = JSON.parse(json) as Partial<ActionTokenPayload>;
    if (
      typeof value.employeeId !== 'string' ||
      typeof value.deviceId !== 'string' ||
      typeof value.locationId !== 'string' ||
      typeof value.exp !== 'number'
    ) {
      return null;
    }
    return value as ActionTokenPayload;
  } catch {
    return null;
  }
}

export async function issueActionToken(params: {
  employeeId: string;
  deviceId: string;
  locationId: string;
}): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + ACTION_TOKEN_TTL_SECONDS;
  const payload: ActionTokenPayload = { ...params, exp };
  const encoded = encodePayload(payload);
  const signature = await hmac(encoded);
  return {
    token: `${encoded}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/**
 * Verifica el token y devuelve su contenido. Comprueba, en este orden: que la
 * firma sea válida, que no haya caducado y que corresponda al MISMO kiosco que
 * lo pide. Un token emitido en Sede Principal no sirve en Sucursal Demo.
 */
export async function verifyActionToken(
  token: string,
  context: KioskContext,
): Promise<ActionTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;

  const expected = await hmac(encoded);
  // Comparación en tiempo constante: comparar con `!==` filtra información por
  // el tiempo de respuesta.
  if (!timingSafeEqual(signature, expected)) return null;

  const payload = decodePayload(encoded);
  if (payload === null) return null;

  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (payload.deviceId !== context.deviceId) return null;
  if (payload.locationId !== context.locationId) return null;

  return payload;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
