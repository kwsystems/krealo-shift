import * as Linking from 'expo-linking';

import { getSupabase } from '@/lib/supabase/client';

/**
 * Recuperación de contraseña (§8).
 *
 * EXISTÍA COMO BOTÓN Y NO COMO FUNCIÓN: "Olvidé mi contraseña" tenía
 * `onPress={() => undefined}`. Se veía, se pulsaba, y no pasaba nada — la misma
 * clase de control muerto que el teclado del kiosco sin credencial.
 *
 * DOS DECISIONES QUE NO SON OBVIAS
 *
 * 1. Enviar SIEMPRE dice que se envió, incluso si el correo no tiene cuenta. Un
 *    "ese correo no existe" convierte la pantalla de acceso en un comprobador de
 *    quién trabaja en la empresa, para cualquiera. Supabase ya responde igual en los
 *    dos casos y aquí no se deshace.
 *
 * 2. El enlace vuelve a la app por su esquema (`krealoshift://restablecer`), no a una
 *    página web. El cliente usa `flowType: 'pkce'`, así que lo que llega es un `code`
 *    de un solo uso que se canjea por una sesión de recuperación.
 *
 * REQUIERE CONFIGURACIÓN EN EL PROYECTO DE SUPABASE, que no es código: la URL que
 * devuelve `recoveryRedirectUrl()` tiene que estar en Authentication → URL
 * Configuration → Redirect URLs. Sin eso, Supabase manda el correo pero el enlace
 * lleva al Site URL en vez de a la app. Está anotado en el README y en la tarea de
 * Andree.
 */

export type ResetErrorKind =
  /** Falta configuración de entorno: no hay backend al que pedirlo. */
  | 'notConfigured'
  /** Fallo de red. Se puede reintentar. */
  | 'offline'
  /** Demasiados intentos seguidos: Supabase limita los correos por hora. */
  | 'rateLimited'
  /** El enlace ya se usó o caducó. */
  | 'expiredLink'
  | 'generic';

export type ResetResult = { ok: true } | { ok: false; kind: ResetErrorKind };

/** Longitud mínima de la contraseña nueva. Supabase rechaza menos de 6; se pide 8. */
export const MIN_NEW_PASSWORD_LENGTH = 8;

/**
 * URL a la que vuelve el enlace del correo.
 *
 * `createURL` da `krealoshift://restablecer` en nativo y `<origen>/restablecer` en
 * web, así que la previsualización web funciona sin un caso especial.
 */
export function recoveryRedirectUrl(): string {
  return Linking.createURL('/restablecer');
}

/**
 * Traduce un fallo de Supabase Auth a algo que la pantalla sabe explicar (§20).
 *
 * No se mira el TEXTO del mensaje, que cambia con la versión y con el idioma del
 * servidor: se mira el estado HTTP, que es contrato.
 */
function kindFromAuthError(error: unknown): ResetErrorKind {
  const detalle =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const estado = typeof detalle.status === 'number' ? detalle.status : undefined;
  const nombre = typeof detalle.name === 'string' ? detalle.name : '';

  /*
   * UN FALLO DE RED NO SE RECONOCE POR EL TEXTO, SE RECONOCE POR EL ESTADO 0.
   *
   * La primera versión de esto buscaba /network|fetch/ en el mensaje y exigía que no
   * hubiera estado. Fallaba: supabase-js captura el fallo de `fetch` y lo envuelve en
   * un `AuthRetryableFetchError` con `status: 0`, así que había estado —cero— y el
   * fallo de red se reportaba como "algo salió mal", que manda a mirar al sitio
   * equivocado. Se vio en el chequeo de interacción, contra un dominio que no
   * resuelve.
   *
   * El mismo error envuelve también los 5xx, pero con el estado HTTP de verdad, así
   * que el cero es lo que distingue "no hubo respuesta" de "el servidor falló".
   */
  if (nombre === 'AuthRetryableFetchError' && (estado === 0 || estado === undefined)) {
    return 'offline';
  }

  if (estado === 429) return 'rateLimited';
  if (estado === 401 || estado === 403 || estado === 410) return 'expiredLink';
  return 'generic';
}

/** Pide el correo con el enlace de recuperación. Nunca revela si la cuenta existe. */
export async function sendPasswordReset(email: string): Promise<ResetResult> {
  const supabase = getSupabase();
  if (supabase === null) return { ok: false, kind: 'notConfigured' };

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: recoveryRedirectUrl(),
    });
    if (error !== null) return { ok: false, kind: kindFromAuthError(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, kind: kindFromAuthError(error) };
  }
}

/**
 * Canjea el `code` del enlace por una sesión de recuperación.
 *
 * En web el propio cliente ya lo canjea al arrancar (`detectSessionInUrl`), así que
 * el segundo canje falla. No es un error para la persona: si ya hay sesión, el
 * enlace funcionó. Por eso se comprueba antes de dar el fallo por bueno.
 */
export async function exchangeRecoveryCode(code: string): Promise<ResetResult> {
  const supabase = getSupabase();
  if (supabase === null) return { ok: false, kind: 'notConfigured' };

  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error === null) return { ok: true };

    const { data } = await supabase.auth.getSession();
    if (data.session !== null) return { ok: true };

    /*
     * En ESTE paso, cualquier fallo que no sea de red significa una sola cosa: el
     * código no sirve —ya se usó, caducó, o el enlace llegó cortado—. El estado HTTP
     * concreto (400, 403, 404 según el caso) no cambia nada de lo que la persona
     * puede hacer, que es pedir otro enlace.
     */
    const kind = kindFromAuthError(error);
    return { ok: false, kind: kind === 'offline' ? 'offline' : 'expiredLink' };
  } catch (error) {
    return { ok: false, kind: kindFromAuthError(error) };
  }
}

/** Guarda la contraseña nueva sobre la sesión de recuperación ya establecida. */
export async function updatePassword(password: string): Promise<ResetResult> {
  const supabase = getSupabase();
  if (supabase === null) return { ok: false, kind: 'notConfigured' };

  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error !== null) return { ok: false, kind: kindFromAuthError(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, kind: kindFromAuthError(error) };
  }
}
