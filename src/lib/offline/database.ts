import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

/**
 * Base local del kiosco (especificación §17).
 *
 * Guarda lo necesario para que el iPad siga fichando sin red: el equipo, los
 * turnos, las políticas de la tienda y —lo más importante— la cola de eventos
 * pendientes de enviar.
 *
 * Reglas que impone este archivo:
 *   - el esquema está VERSIONADO con `user_version`: una app vieja no puede
 *     encontrarse una base nueva y adivinar;
 *   - la cola es append-only en la práctica: un evento nunca se borra hasta que el
 *     servidor confirmó qué hacer con él. Perder un fichaje es perder horas
 *     trabajadas de una persona;
 *   - nada de esto es la fuente de verdad: es caché y cola. La verdad está en el
 *     servidor.
 */

const DATABASE_NAME = 'krealo-shift-offline.db';
const SCHEMA_VERSION = 3;

let handle: SQLite.SQLiteDatabase | null = null;

/**
 * Apertura EN CURSO, memoizada.
 *
 * ESTO ARREGLA UNA CARRERA REAL, no es una optimización. `openOfflineDatabase`
 * comprobaba `handle !== null` y después hacía varios `await` antes de asignarlo:
 * dos llamadas concurrentes pasaban las dos la comprobación y abrían la base DOS
 * VECES. Y concurrentes lo son a diario: el layout del kiosco dispara la
 * sincronización mientras la pantalla hidrata su store, y las dos piden la base.
 *
 * En web el sintoma era ruidoso —`NoModificationAllowedError: Access Handles cannot
 * be created if there is another open Access Handle`, porque OPFS solo admite un
 * manejador por archivo— y por eso se encontró abriendo la app en un navegador. En
 * nativo era silencioso: dos conexiones al mismo archivo, que con WAL casi siempre
 * funciona, hasta que dos escrituras coinciden y una espera o falla. Un fichaje que
 * falla por eso sería carísimo de diagnosticar.
 *
 * Memoizar la PROMESA y no el resultado es lo que lo cierra: quien llegue segundo
 * espera la misma apertura en vez de empezar otra.
 */
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/** Sentencias de creación. Idempotentes: se pueden correr en cada arranque. */
const SCHEMA = `
pragma journal_mode = WAL;
pragma foreign_keys = ON;

-- Sesión del kiosco cacheada tras la activación, para poder arrancar sin red.
create table if not exists cached_session (
  id integer primary key check (id = 1),
  device_id text not null,
  device_public_id text not null,
  organization_id text not null,
  organization_name text not null,
  location_id text not null,
  location_name text not null,
  timezone text not null,
  activated_at text not null,
  updated_at text not null
);

-- Equipo mínimo de la tienda. employee_opaque_id es lo único que identifica a
-- una persona aquí: el uuid interno del empleado no baja al dispositivo.
create table if not exists cached_roster (
  employee_opaque_id text primary key,
  display_name text not null,
  job_role_name text,
  updated_at text not null
);

-- Verificador para validar el PIN sin conexión.
--
-- NO guarda el hash bcrypt. Guarda el salt y un verificador que el servidor
-- derivó con la clave de ESTE dispositivo, que vive en el Keychain y no en este
-- archivo. Quien se lleve este archivo no puede comprobar ni un intento.
--
-- Ver supabase/migrations/20260827000700_offline_verifier_device_key.sql.
create table if not exists cached_pin_verifiers (
  employee_opaque_id text primary key,
  pin_salt text not null,
  pin_verifier text not null,
  pin_length integer not null,
  pin_version integer not null,
  updated_at text not null
);

create table if not exists cached_shifts (
  id text primary key,
  employee_opaque_id text not null,
  starts_at text not null,
  ends_at text not null,
  job_role_name text,
  employee_note text,
  planned_unpaid_break_minutes integer not null default 0,
  changed_since_last_publication integer not null default 0,
  updated_at text not null
);

create table if not exists cached_policies (
  id integer primary key check (id = 1),
  pin_length integer not null,
  photo_enabled integer not null,
  early_clock_in_minutes integer not null,
  late_grace_minutes integer not null,
  allow_unscheduled_shifts integer not null,
  time_format text not null,
  required_break_minutes integer not null,
  updated_at text not null
);

-- LA COLA. Un evento entra aquí ANTES de que la interfaz diga "listo".
create table if not exists outbox_time_events (
  -- La clave de idempotencia se genera en el cliente antes de guardar, y es la
  -- misma que verá el servidor: es lo que hace que un reintento no duplique.
  idempotency_key text primary key,
  -- Secuencia monótona por instalación: el único orden fiable de eventos
  -- generados sin red.
  device_sequence integer not null,
  employee_opaque_id text not null,
  event_type text not null check (
    event_type in ('clock_in', 'break_start', 'break_end', 'clock_out')
  ),
  break_type text,
  shift_id text,
  location_id text not null,
  occurred_at_device text not null,
  device_timezone text not null,
  device_offset_minutes integer not null,
  pin_version integer not null,
  photo_local_uri text,
  -- HMAC del dispositivo sobre el contenido del evento: detecta manipulación del
  -- archivo de la base entre que se guardó y se envió.
  signature text not null,
  status text not null default 'pending' check (
    status in ('pending', 'sending', 'accepted', 'duplicate', 'needs_review', 'rejected')
  ),
  attempts integer not null default 0,
  last_attempt_at text,
  next_attempt_at text,
  server_reason text,
  created_at text not null
);

create index if not exists outbox_pending_idx
  on outbox_time_events (status, device_sequence);

-- Fotos pendientes de subir, separadas de los eventos: una foto que no sube no
-- puede impedir que el fichaje llegue.
--
-- event_id se rellena cuando el servidor acepta el fichaje: la foto se sube
-- DESPUES, apuntando a un evento que ya existe. Mientras sea null, la foto espera
-- a que su evento se sincronice. Es lo que permite fichar con foto sin red.
--
-- (Sin acentos graves en este comentario: todo el esquema vive dentro de una
-- plantilla de JavaScript y un acento grave la cortaria por la mitad.)
create table if not exists pending_media (
  local_uri text primary key,
  idempotency_key text not null,
  event_id text,
  status text not null default 'pending' check (
    status in ('pending', 'uploading', 'uploaded', 'failed')
  ),
  attempts integer not null default 0,
  created_at text not null
);

-- Ultimo estado de asistencia conocido POR EL SERVIDOR para cada empleado.
--
-- Sin esto el kiosco no puede validar transiciones sin red: si alguien fico
-- entrada estando online y despues se cae la red, derivar su estado solo desde la
-- cola local diria "fuera de turno" y le ofreceria marcar entrada otra vez.
-- Se actualiza en cada verificacion online, y offline se le aplican encima los
-- eventos que hay en la cola.
create table if not exists cached_attendance_state (
  employee_opaque_id text primary key,
  attendance_state text not null check (
    attendance_state in ('OFF_SHIFT', 'WORKING', 'ON_BREAK')
  ),
  shift_id text,
  session_started_at text,
  taken_break_minutes integer not null default 0,
  known_at text not null
);

create table if not exists sync_metadata (
  key text primary key,
  value text not null,
  updated_at text not null
);
`;

/**
 * Nombre de la base según la plataforma.
 *
 * EN WEB LA BASE ES EN MEMORIA, y eso hace falta decirlo con precisión porque
 * suena a atajo y no lo es.
 *
 * `expo-sqlite` en web corre SQLite compilado a WebAssembly y persiste con OPFS
 * (Origin Private File System). OPFS exige cabeceras COOP/COEP en el servidor y
 * **un solo manejador de acceso por archivo**; sin eso falla con
 * `NoModificationAllowedError: Access Handles cannot be created if there is another
 * open Access Handle`, seguido de `sqlite3_open_v2` y de un
 * `Cannot read properties of undefined (reading 'xFileControl')`.
 *
 * Eso es exactamente lo que pasaba: la previsualización web pintaba todas las
 * pantallas pero escupía tres errores por pantalla del kiosco, y cualquier lectura
 * de la cola local fallaba. Se descubrió abriendo la app en un navegador de verdad;
 * ni `tsc` ni las pruebas lo veían, porque el módulo nativo está simulado en Jest.
 *
 * Con `:memory:` no hay OPFS, así que no hay nada que pueda fallar: la app se
 * recorre entera y la lógica de la cola se puede ejercitar.
 *
 * LO QUE SE PIERDE, DICHO CLARO: en web la cola NO sobrevive a un recargado. Es
 * aceptable porque web es una herramienta de desarrollo para trabajar desde Windows
 * (§29, §33) y NO la superficie donde se ficha: el kiosco es un iPad nativo, donde
 * la base es un archivo real. Perder un fichaje de verdad sería inaceptable; perder
 * uno de una previsualización no lo es.
 *
 * Y como en `secure-storage.ts`, se niega a correr en un build de producción web:
 * si alguien despliega la web como si fuera la app, mejor que falle al arrancar que
 * en silencio con una cola que se borra sola.
 */
function databaseNameForPlatform(): string {
  if (Platform.OS !== 'web') return DATABASE_NAME;

  if (process.env.NODE_ENV === 'production' && process.env.EXPO_PUBLIC_APP_ENV === 'production') {
    throw new Error(
      'La base local no persiste en web. La previsualización web es solo para desarrollo: ' +
        'el fichaje ocurre en el iPad, no en el navegador.',
    );
  }

  if (!warnedAboutWebDatabase) {
    warnedAboutWebDatabase = true;
    console.warn(
      '[krealo-shift] Web usa una base SQLite EN MEMORIA: la cola de fichajes no ' +
        'sobrevive a un recargado. Solo para desarrollo.',
    );
  }

  return ':memory:';
}

let warnedAboutWebDatabase = false;

/**
 * Migraciones de una versión del esquema a la siguiente.
 *
 * REGLA QUE NO SE ROMPE: nunca se borra `outbox_time_events` ni `pending_media`.
 * Ahí viven fichajes que el servidor todavía no confirmó, y perder uno es perder
 * horas trabajadas de una persona. Las tablas `cached_*` sí se pueden vaciar: son
 * caché, se vuelven a bajar en el siguiente refresco, y mientras no estén el
 * dispositivo valida contra el servidor, que es el camino seguro.
 */
async function applyMigrations(
  database: SQLite.SQLiteDatabase,
  previous: number,
): Promise<void> {
  // v1 → v2: los verificadores del PIN dejan de ser el hash bcrypt y pasan a ser
  // salt + verificador ligado al dispositivo. La tabla se recrea en vez de
  // agregarle columnas: las filas viejas contienen justo el dato que ya no
  // queremos en el disco del iPad, así que se van.
  if (previous >= 1 && previous < 2) {
    await database.execAsync('drop table if exists cached_pin_verifiers');
  }

  // v2 → v3: `pending_media` gana `event_id`. Se agrega la columna en vez de
  // recrear la tabla porque ahi hay fotos de fichajes que aun no llegaron al
  // servidor, y borrarlas seria perder la evidencia de una jornada.
  if (previous >= 1 && previous < 3) {
    const columns = await database.getAllAsync<{ name: string }>(
      "pragma table_info('pending_media')",
    );
    const hasTable = columns.length > 0;
    const hasEventId = columns.some((column) => column.name === 'event_id');
    if (hasTable && !hasEventId) {
      await database.execAsync('alter table pending_media add column event_id text');
    }
  }
}

/**
 * Abre la base y aplica el esquema. Es idempotente y segura de llamar varias
 * veces: devuelve siempre la misma conexión.
 */
export async function openOfflineDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (handle !== null) return handle;
  if (opening !== null) return opening;

  opening = openAndMigrate();
  try {
    return await opening;
  } finally {
    // Se limpia siempre, tambien si fallo: un fallo transitorio no debe dejar la
    // base imposible de abrir para el resto de la vida del proceso.
    opening = null;
  }
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(databaseNameForPlatform());

  // El orden importa: primero se migra lo que ya existe, y solo después se corre
  // el esquema. `create table if not exists` no cambia una tabla que ya está, así
  // que sin este paso un iPad actualizado se quedaría con las columnas viejas y
  // cada inserción fallaría.
  const versionRow = await database.getFirstAsync<{ user_version: number }>(
    'pragma user_version',
  );
  const previous = versionRow?.user_version ?? 0;

  await applyMigrations(database, previous);
  await database.execAsync(SCHEMA);

  const row = await database.getFirstAsync<{ user_version: number }>('pragma user_version');
  const current = row?.user_version ?? 0;

  if (current === 0 || current < SCHEMA_VERSION) {
    await database.execAsync(`pragma user_version = ${SCHEMA_VERSION}`);
  } else if (current > SCHEMA_VERSION) {
    // Una base más nueva que la app significa que alguien instaló una versión
    // anterior encima. No se adivina: se avisa y se sigue en modo solo-lectura
    // conceptual, porque escribir con un esquema que no conocemos corrompería la
    // cola de fichajes.
    throw new Error(
      `La base local es de una versión más nueva (${current}) que esta app (${SCHEMA_VERSION}).`,
    );
  }

  handle = database;
  return database;
}

/** Cierra la base. Solo se usa en pruebas y al desactivar el kiosco. */
export async function closeOfflineDatabase(): Promise<void> {
  if (handle === null) return;
  await handle.closeAsync();
  handle = null;
}

/** Borra todo lo local. Se usa al salir del modo kiosco (§6.4). */
export async function resetOfflineDatabase(): Promise<void> {
  const database = await openOfflineDatabase();
  await database.execAsync(`
    delete from outbox_time_events;
    delete from pending_media;
    delete from cached_pin_verifiers;
    delete from cached_roster;
    delete from cached_shifts;
    delete from cached_policies;
    delete from cached_session;
    delete from sync_metadata;
  `);
}

export async function setSyncMetadata(key: string, value: string): Promise<void> {
  const database = await openOfflineDatabase();
  await database.runAsync(
    `insert into sync_metadata (key, value, updated_at) values (?, ?, ?)
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    new Date().toISOString(),
  );
}

export async function getSyncMetadata(key: string): Promise<string | null> {
  const database = await openOfflineDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    'select value from sync_metadata where key = ?',
    key,
  );
  return row?.value ?? null;
}

export const SYNC_KEYS = {
  lastSyncAt: 'last_sync_at',
  lastRosterRefreshAt: 'last_roster_refresh_at',
  deviceSequence: 'device_sequence',
} as const;
