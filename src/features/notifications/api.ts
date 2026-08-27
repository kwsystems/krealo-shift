import { z } from 'zod';

import { execute, selectRows } from '@/hooks/use-admin-query';
import { TABLES } from '@/lib/supabase/types';
import type { PushPlatform } from './push-adapter';

/**
 * Registro del token de notificaciones (§19, §22).
 *
 * `push_tokens` es una tabla del usuario: su política RLS limita cada fila a
 * `user_id = auth.uid()`, así que nadie ve los dispositivos de otra persona.
 */

const tokenRowSchema = z.object({
  expo_token: z.string(),
  is_active: z.boolean(),
});

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

/**
 * ¿Está este dispositivo registrado y activo?
 *
 * Sirve para que el panel no diga "activadas" cuando el permiso del sistema está
 * concedido pero el token nunca llegó a guardarse: son dos cosas distintas y
 * confundirlas hace que el gerente crea que va a recibir avisos que no llegan.
 */
export async function isPushTokenActive(expoToken: string): Promise<boolean> {
  const rows = await selectRows(z.array(tokenRowSchema), (db) =>
    db
      .from(TABLES.pushTokens)
      .select('expo_token, is_active')
      .eq('expo_token', expoToken)
      .limit(1),
  );
  return rows[0]?.is_active === true;
}

/**
 * Desactiva el token de este dispositivo. Lo usa el cierre de sesión: el
 * dispositivo puede quedar en manos de otra persona y las alertas de una tienda no
 * deben seguir llegando a un teléfono ajeno.
 */
export async function deactivatePushToken(expoToken: string): Promise<void> {
  await execute((db) =>
    db.from(TABLES.pushTokens).update({ is_active: false }).eq('expo_token', expoToken),
  );
}
