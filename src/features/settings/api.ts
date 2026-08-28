import { z } from 'zod';

import { execute, requireClient, selectRows, toAdminError } from '@/hooks/use-admin-query';
import type { LocationSettings } from '@/hooks/use-manager-scope';
import { RPC, TABLES, VIEWS } from '@/lib/supabase/types';

/**
 * Configuración de organización, ubicación, kioscos y notificaciones (§11.6).
 *
 * La ubicación guarda sus reglas en `settings` (jsonb) y la base valida la forma
 * con una restricción: se envía el objeto completo, ya combinado, para no dejar
 * fuera una clave y romper el check.
 */

export type OrganizationPatch = {
  name: string;
  default_locale: string;
  default_timezone: string;
  week_starts_on: number;
};

export async function updateOrganization(params: {
  organizationId: string;
  patch: OrganizationPatch;
}): Promise<void> {
  await execute((db) =>
    db.from(TABLES.organizations).update(params.patch).eq('id', params.organizationId),
  );
}

export async function updateLocation(params: {
  locationId: string;
  name: string;
  address: string;
  settings: LocationSettings;
}): Promise<void> {
  await execute((db) =>
    db
      .from(TABLES.locations)
      .update({
        name: params.name.trim(),
        address: params.address.trim(),
        settings: params.settings,
      })
      .eq('id', params.locationId),
  );
}

const kioskDeviceSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  location_id: z.string().uuid(),
  location_name: z.string(),
  device_public_id: z.string(),
  status: z.enum(['active', 'revoked']),
  app_version: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  last_sync_at: z.string().nullable(),
  /**
   * Minutos desde la última sincronización, `null` si nunca sincronizó. Lo calcula
   * la vista y no el cliente, para que el panel y el trabajo de notificaciones den
   * la misma respuesta sobre el mismo kiosco.
   */
  minutes_since_sync: z.number().int().nullable(),
});

export type KioskDevice = z.infer<typeof kioskDeviceSchema>;

/**
 * Relojes vinculados (§11.6).
 *
 * SE LEE LA VISTA `kiosk_devices_admin`, NUNCA LA TABLA, y no es un detalle de
 * estilo: `kiosk_devices` está revocada para `authenticated` porque guarda dos
 * secretos del dispositivo —`credential_hash` y `offline_key`—. Con `offline_key`
 * y el archivo SQLite de un iPad se pueden probar los 10⁶ PIN posibles.
 *
 * Esto apuntaba a la tabla, así que la pantalla mostraba "permiso denegado" y el
 * botón de revocar era inalcanzable. Revocar importa: es el corte de emergencia
 * cuando un iPad se pierde, y también deja de repartirle verificadores de PIN.
 *
 * La vista filtra por `app_manages_location`, o sea que ya devuelve solo los
 * kioscos de las tiendas que administra quien consulta; el filtro por
 * organización de abajo es defensa en profundidad, no la barrera.
 */
export async function fetchKioskDevices(organizationId: string): Promise<KioskDevice[]> {
  return selectRows(z.array(kioskDeviceSchema), (db) =>
    db
      .from(VIEWS.kioskDevicesAdmin)
      .select(
        'id, display_name, location_id, location_name, device_public_id, status, ' +
          'app_version, last_seen_at, last_sync_at, minutes_since_sync',
      )
      .eq('organization_id', organizationId)
      .order('location_name', { ascending: true })
      .order('display_name', { ascending: true }),
  );
}

/** Código de activación temporal: lo devuelve en claro una sola vez (§11.6). */
export async function createActivationCode(params: {
  locationId: string;
  validMinutes: number;
}): Promise<string> {
  const db = requireClient();
  try {
    const { data, error } = await db.rpc(RPC.createKioskActivationCode, {
      p_location_id: params.locationId,
      p_valid_minutes: params.validMinutes,
    });
    if (error !== null) throw toAdminError(error);
    const parsed = z.string().min(4).safeParse(data);
    if (!parsed.success) throw toAdminError({ code: 'shape', message: 'ACTIVATION_CODE_SHAPE' });
    return parsed.data;
  } catch (error) {
    throw toAdminError(error);
  }
}

export async function revokeKioskDevice(deviceId: string): Promise<void> {
  const db = requireClient();
  try {
    const { error } = await db.rpc(RPC.revokeKioskDevice, { p_device_id: deviceId });
    if (error !== null) throw toAdminError(error);
  } catch (error) {
    throw toAdminError(error);
  }
}

/**
 * Los interruptores de notificación (§19).
 *
 * SON SEIS Y CADA UNO APAGA UNA ALERTA QUE EXISTE. Había ocho, y dos de ellos
 * —`earlyClockIn` y `scheduleChange`— no controlaban nada: no hay ninguna alerta de
 * esos tipos ni en la base ni en las Edge Functions. Se podían encender, se
 * guardaban, y no pasaba nada nunca. Un interruptor que no hace nada es una mentira
 * que no se descubre: quien lo enciende no recibe el aviso y concluye que no ha
 * pasado nada que avisar, que es indistinguible de "todo va bien".
 *
 * La §19 lista SIETE notificaciones. La séptima, `wrongKiosk` —intento de fichaje
 * desde un kiosco revocado o de otra tienda— no tiene interruptor a propósito: con
 * uno, quien se llevó el iPad podría silenciar el aviso de que se lo llevó. La
 * pantalla lo dice en vez de dejarlo implícito.
 *
 * Dos pruebas impiden que esto vuelva a separarse: `30_manager.sql` compara los
 * interruptores de la base con los tipos de alerta que la base declara, y
 * `__tests__/notification-keys.test.ts` compara esta lista con la de la base.
 */
export const notificationKeys = [
  'late',
  'noShow',
  'nearOvertime',
  'incompleteEntry',
  'newRequest',
  'kioskNotSyncing',
] as const;

export type NotificationKey = (typeof notificationKeys)[number];
export type NotificationPreferences = Record<NotificationKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  late: true,
  noShow: true,
  nearOvertime: true,
  incompleteEntry: true,
  newRequest: true,
  kioskNotSyncing: true,
};

/**
 * Una clave ausente vale su valor por defecto, no `false`.
 *
 * Importa cuál de los dos: la base evalúa `(preferences ->> 'late')::boolean` en el
 * `where`, así que un `null` ahí significa "no avisar". Una preferencia que falta
 * NO significa que el encargado no quiera saberlo, y equivocarse en esto apaga
 * avisos en silencio.
 */
const preferencesSchema = z
  .object({
    late: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.late),
    noShow: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.noShow),
    nearOvertime: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.nearOvertime),
    incompleteEntry: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.incompleteEntry),
    newRequest: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.newRequest),
    kioskNotSyncing: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.kioskNotSyncing),
  })
  // `strip` (el modo por omisión) descarta claves desconocidas, así que una fila
  // vieja con `earlyClockIn` se lee sin arrastrarla de vuelta al guardar.
  .catch(DEFAULT_NOTIFICATION_PREFERENCES);

const preferencesRowSchema = z.object({ preferences: preferencesSchema });

export async function fetchNotificationPreferences(params: {
  userId: string;
  organizationId: string;
}): Promise<NotificationPreferences> {
  const rows = await selectRows(z.array(preferencesRowSchema), (db) =>
    db
      .from(TABLES.notificationPreferences)
      .select('preferences')
      .eq('user_id', params.userId)
      .eq('organization_id', params.organizationId)
      .limit(1),
  );
  return rows[0]?.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
}

export async function saveNotificationPreferences(params: {
  userId: string;
  organizationId: string;
  preferences: NotificationPreferences;
}): Promise<void> {
  await execute((db) =>
    db.from(TABLES.notificationPreferences).upsert(
      {
        user_id: params.userId,
        organization_id: params.organizationId,
        preferences: params.preferences,
      },
      { onConflict: 'user_id,organization_id' },
    ),
  );
}
