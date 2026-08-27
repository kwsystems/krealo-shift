import { z } from 'zod';

import { execute, requireClient, selectRows, toAdminError } from '@/hooks/use-admin-query';
import type { LocationSettings } from '@/hooks/use-manager-scope';
import { RPC, TABLES } from '@/lib/supabase/types';

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
  status: z.enum(['active', 'revoked']),
  app_version: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  last_sync_at: z.string().nullable(),
});

export type KioskDevice = z.infer<typeof kioskDeviceSchema>;

/**
 * Relojes vinculados (§11.6).
 *
 * `kiosk_devices` está revocada para `authenticated` en la migración de RLS, así
 * que hoy esta consulta devuelve "acceso denegado" y la pantalla lo dice tal
 * cual: no inventamos una lista vacía que parecería "no hay kioscos".
 */
export async function fetchKioskDevices(organizationId: string): Promise<KioskDevice[]> {
  return selectRows(z.array(kioskDeviceSchema), (db) =>
    db
      .from(TABLES.kioskDevices)
      .select('id, display_name, location_id, status, app_version, last_seen_at, last_sync_at')
      .eq('organization_id', organizationId)
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
  earlyClockIn: false,
  nearOvertime: true,
  incompleteEntry: true,
  newRequest: true,
  scheduleChange: true,
  kioskNotSyncing: true,
};

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
