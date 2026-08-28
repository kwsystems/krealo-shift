import { execute } from '@/hooks/use-admin-query';
import { getSupabase } from '@/lib/supabase/client';
import { TABLES } from '@/lib/supabase/types';
import type { PushPlatform } from './push-adapter';

/**
 * Registro del token de notificaciones (§19, §22).
 *
 * `push_tokens` es una tabla del usuario: su política RLS limita cada fila a
 * `user_id = auth.uid()`, así que nadie ve los dispositivos de otra persona.
 */

/**
 * Guarda o revive el token de este dispositivo.
 *
 * `upsert` sobre `expo_token`, que es único, y no un `insert`: Expo puede devolver
 * el MISMO token a la misma instalación durante meses, y también puede reasignarlo
 * si la app se reinstala. Con un `insert` el segundo arranque fallaría por clave
 * duplicada; con el `upsert` el token queda apuntando a la sesión actual.
 *
 * Reactiva `is_active` a propósito: un token que Expo declaró muerto y que vuelve
 * a aparecer aquí es un dispositivo que volvió a la vida —una reinstalación, o el
 * permiso reconcedido— y seguir tratándolo como muerto dejaría a esa persona sin
 * avisos sin que nada lo explique.
 */
export async function savePushToken(params: {
  userId: string;
  expoToken: string;
  platform: PushPlatform;
  deviceName: string;
}): Promise<void> {
  await execute((db) =>
    db.from(TABLES.pushTokens).upsert(
      {
        user_id: params.userId,
        expo_token: params.expoToken,
        platform: params.platform,
        device_name: params.deviceName,
        last_active_at: new Date().toISOString(),
        is_active: true,
      },
      { onConflict: 'expo_token' },
    ),
  );
}

/** Desactiva un token concreto. Solo alcanza a filas propias, por la política RLS. */
async function deactivatePushToken(expoToken: string): Promise<void> {
  await execute((db) =>
    db.from(TABLES.pushTokens).update({ is_active: false }).eq('expo_token', expoToken),
  );
}

/**
 * Token de ESTE dispositivo, recordado en memoria.
 *
 * POR QUÉ EN UNA VARIABLE DE MÓDULO Y NO EN LA CACHÉ DE CONSULTAS
 * Porque quien lo necesita es el cierre de sesión, y lo necesita ANTES de cerrarla:
 * después, la política RLS de `push_tokens` ya no deja escribir nada, porque
 * `auth.uid()` es nulo. La clave de la consulta de registro lleva el `userId` y se
 * descarta justo en ese momento, así que leerla desde ahí no sirve.
 *
 * No se persiste: si la app se cierra sin cerrar sesión, el token sigue siendo
 * válido y debe seguir recibiendo. Solo importa el cierre explícito.
 */
let rememberedToken: string | null = null;

export function rememberPushToken(expoToken: string): void {
  rememberedToken = expoToken;
}

/**
 * Apaga TODOS los tokens de la persona, no solo el de este dispositivo (§8).
 *
 * Es la mitad que le faltaba a "cerrar sesión en todos los dispositivos": revocar las
 * sesiones deja a los otros dispositivos en la pantalla de acceso, pero sus tokens de
 * push siguen activos en la base, así que seguirían recibiendo las alertas de la
 * tienda hasta que alguien abriera la app en cada uno. Cerrar sesión en todas partes
 * porque un teléfono se perdió y que ese teléfono siga vibrando con los avisos del
 * negocio es exactamente el fallo que la función existe para evitar.
 *
 * Se hace ANTES de revocar, igual que el de este dispositivo: después, la política RLS
 * de `push_tokens` ya no deja escribir porque `auth.uid()` es nulo.
 *
 * Nunca lanza. Cerrar sesión tiene que funcionar aunque no haya red.
 */
export async function deactivateAllPushTokens(): Promise<void> {
  rememberedToken = null;
  try {
    const db = getSupabase();
    const userId = db === null ? null : ((await db.auth.getUser()).data.user?.id ?? null);
    if (userId === null) return;

    await execute((client) =>
      client.from(TABLES.pushTokens).update({ is_active: false }).eq('user_id', userId),
    );
  } catch {
    // Mismo costo aceptado que arriba: sin red los tokens se quedan activos hasta que
    // Expo los declare muertos, y bloquear el cierre de sesión sería peor.
  }
}

/**
 * Desactiva el token de este dispositivo al cerrar sesión.
 *
 * POR QUÉ IMPORTA: el iPhone o el iPad pueden cambiar de manos, y sin esto las
 * alertas de una tienda —tardanzas, ausencias— seguirían llegando al dispositivo de
 * quien ya no trabaja ahí. Se desactiva SOLO el de este dispositivo y no todos los
 * de la persona: cerrar sesión en el iPad no debe dejarla sin avisos en su teléfono.
 *
 * Nunca lanza. Cerrar sesión tiene que funcionar aunque no haya red.
 */
export async function deactivateRememberedPushToken(): Promise<void> {
  const token = rememberedToken;
  if (token === null) return;
  rememberedToken = null;
  try {
    await deactivatePushToken(token);
  } catch {
    // Sin red el token se queda activo y seguirá recibiendo hasta que Expo lo
    // declare muerto. Es un costo aceptado: bloquear el cierre de sesión sería peor.
  }
}
