import { z } from 'zod';

import { docId } from '@/lib/firebase/ids';

import { execute, requireClient, selectRows, toAdminError } from '@/hooks/use-admin-query';
import type { LocationSettings } from '@/hooks/use-manager-scope';
import { RPC, TABLES, VIEWS } from '@/lib/firebase/tables';

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

/**
 * Abrir una sede nueva.
 *
 * NO HABÍA FORMA DE HACERLO DESDE LA APP, y la regla de Firestore sí lo permitía desde
 * el primer día (`allow create: if isAdmin(...)`). Lo que faltaba era la pantalla: abrir
 * una tienda exigía una máquina con credenciales de administrador del proyecto de Google
 * y correr `functions/scripts/configurar-empresa.mjs`. Para un negocio eso no es una
 * herramienta, es una llamada a quien programó la app.
 *
 * LOS AJUSTES SALEN DE `DEFAULT_LOCATION_SETTINGS`, no se piden al crear. Son once
 * valores —tolerancias, umbrales de horas extra, foto, formato de hora— y ninguno se
 * puede decidir bien antes de haber abierto la tienda. Se crean con los de fábrica y se
 * afinan en la misma sección, que es donde ya se editan los de las demás.
 *
 * La zona horaria se hereda de la organización: una cadena con sedes en husos distintos
 * es un caso que existe, pero heredar acierta casi siempre y el campo se edita después.
 */
export async function createLocation(params: {
  organizationId: string;
  name: string;
  address: string;
  timezone: string;
  settings: LocationSettings;
}): Promise<string> {
  const creada = await selectRows(z.object({ id: docId() }), (db) =>
    db
      .from(TABLES.locations)
      .insert({
        organization_id: params.organizationId,
        name: params.name.trim(),
        address: params.address.trim(),
        timezone: params.timezone,
        is_active: true,
        settings: params.settings,
      })
      .select('id')
      .single(),
  );
  return creada.id;
}

/**
 * Cerrar o reabrir una sede. NO existe borrarla, y no es un olvido.
 *
 * La regla lo prohíbe expresamente (`allow delete: if false`) porque una sede tiene
 * fichajes colgando: horas que se pagaron, turnos publicados, correcciones con su
 * auditoría. Borrar la fila dejaría todo eso apuntando a una tienda que no existe, y el
 * historial de nómina de quien trabajó ahí se volvería ilegible justo cuando hace falta
 * —una reclamación, una inspección— que es años después.
 *
 * Cerrarla hace lo que de verdad se quiere: deja de ofrecerse para fichar y para
 * programar turnos, y lo ya registrado se sigue pudiendo leer. Y se puede reabrir, que
 * borrar no permite.
 */
export async function setLocationActive(params: {
  locationId: string;
  isActive: boolean;
}): Promise<void> {
  await execute((db) =>
    db.from(TABLES.locations).update({ is_active: params.isActive }).eq('id', params.locationId),
  );
}

const kioskDeviceSchema = z.object({
  id: docId(),
  display_name: z.string(),
  location_id: docId(),
  location_name: z.string(),
  device_public_id: z.string(),
  status: z.enum(['active', 'revoked']),
  app_version: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  last_sync_at: z.string().nullable(),
  /**
   * Minutos desde el ÚLTIMO CONTACTO con el servidor. Nunca `null`.
   *
   * Es lo que mide el aviso de "reloj sin sincronizar" (§19), y sale de
   * `last_seen_at`, que el servidor actualiza en cada petición autenticada del
   * kiosco. Lo calcula la vista y no el cliente, para que el panel y el trabajo de
   * notificaciones den la misma respuesta sobre el mismo iPad.
   */
  minutes_since_seen: z.number().int(),
  /**
   * Minutos desde la última vez que este iPad VACIÓ SU COLA, `null` si nunca tuvo
   * nada que sincronizar.
   *
   * `null` es el caso NORMAL Y BUENO en una tienda con red estable, y no debe leerse
   * como un problema: antes esto era lo que medía la alerta, y como solo lo escribe
   * la función de sincronización offline, un iPad con buen wifi lo dejaba en `null`
   * para siempre y la alerta disparaba todos los días.
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
          'app_version, last_seen_at, last_sync_at, minutes_since_seen, minutes_since_sync',
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
  /**
   * SE LEE POR EL ID DEL DOCUMENTO, no con una consulta, y aquí es obligatorio.
   *
   * La regla de esta colección comprueba `prefId.split('_')[0] == request.auth.uid`:
   * se apoya en el ID, no en un campo. Una consulta de lista no puede demostrar eso
   * —Firestore no sabe qué ids va a devolver antes de ejecutarla— así que la denegaba
   * entera, y Ajustes mostraba «Falta un permiso» en la tarjeta de notificaciones.
   *
   * El id es determinista por construcción (`{usuario}_{organización}`, en
   * `COMPOSITE_IDS`), así que pedirlo directamente es además una lectura en vez de
   * una consulta.
   */
  const rows = await selectRows(z.array(preferencesRowSchema), (db) =>
    db
      .from(TABLES.notificationPreferences)
      .select('preferences')
      .eq('id', `${params.userId}_${params.organizationId}`),
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
