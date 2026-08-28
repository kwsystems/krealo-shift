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
 * Los interruptores de notificación (§11.6 y §19).
 *
 * SON OCHO Y CADA UNO APAGA UNA ALERTA QUE EXISTE.
 *
 * LA ESPECIFICACIÓN SE CONTRADICE CONSIGO MISMA AQUÍ, y hay que saberlo antes de
 * tocar esta lista. §11.6 —la pantalla de Configuración— lista siete preferencias.
 * §19 —notificaciones— lista siete notificaciones. Solo cinco coinciden:
 *
 *   en las dos      late, noShow, incompleteEntry, nearOvertime, newRequest
 *   solo en §11.6   earlyClockIn, scheduleChange
 *   solo en §19     wrongKiosk, kioskNotSyncing
 *
 * Se implementa la UNIÓN: nueve alertas, ocho interruptores. `wrongKiosk` no lleva
 * interruptor porque §11.6 no lo lista y porque con uno, quien se llevó el iPad
 * podría silenciar el aviso de que se lo llevó; la pantalla lo dice en vez de
 * dejarlo implícito.
 *
 * HISTORIA, porque el error es fácil de repetir: durante un rato esta lista tuvo
 * SEIS claves. Quité `earlyClockIn` y `scheduleChange` porque no correspondían a
 * ninguna alerta —cierto en ese momento— y porque §19 no las lista. Pero §11.6 sí, y
 * el arreglo correcto era implementar las dos alertas que faltaban, no borrar dos
 * preferencias que el proyecto pide. Leer una sección y decidir es como se hace ese
 * error.
 *
 * Dos pruebas atan esto: `30_manager.sql` compara los interruptores con los tipos de
 * alerta que declara la base Y provoca los nueve hechos, y
 * `__tests__/notification-keys.test.ts` compara esta lista con la de la base. Ojo con
 * la primera versión de esas pruebas: comparaban dos copias entre sí y pasaban en
 * verde mientras las dos estaban mal.
 */
export const notificationKeys = [
  'late',
  'noShow',
  'earlyClockIn',
  'nearOvertime',
  'incompleteEntry',
  'newRequest',
  'scheduleChange',
  'kioskNotSyncing',
] as const;

export type NotificationKey = (typeof notificationKeys)[number];
export type NotificationPreferences = Record<NotificationKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  late: true,
  noShow: true,
  // La única apagada: no es una incidencia sino un patrón que suma en la nómina, y
  // la máquina de estados ya impide fichar antes de la tolerancia, así que toda
  // entrada temprana está dentro de lo permitido. Encendida sería un aviso por cada
  // persona que llega diez minutos antes, todos los días.
  earlyClockIn: false,
  nearOvertime: true,
  incompleteEntry: true,
  newRequest: true,
  scheduleChange: true,
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
    earlyClockIn: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.earlyClockIn),
    nearOvertime: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.nearOvertime),
    incompleteEntry: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.incompleteEntry),
    newRequest: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.newRequest),
    scheduleChange: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.scheduleChange),
    kioskNotSyncing: z.boolean().default(DEFAULT_NOTIFICATION_PREFERENCES.kioskNotSyncing),
  })
  // `strip` (el modo por omisión) descarta claves desconocidas: una fila escrita por
  // una versión con más claves se lee sin arrastrarlas de vuelta al guardar.
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
