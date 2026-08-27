-- =============================================================================
-- Krealo Shift — instalacion completa en un proyecto nuevo de Supabase
-- =============================================================================
--
-- QUE ES ESTE ARCHIVO
-- Las 16 migraciones del proyecto, en orden, mas los datos de demostracion. Todo
-- junto para poder pegarlo de una vez en el editor SQL de Supabase, que es lo que
-- hace falta cuando no se tiene la CLI instalada.
--
-- COMO SE USA
--   1. Entra a tu proyecto en supabase.com
--   2. Menu lateral -> SQL Editor -> New query
--   3. Pega TODO este archivo y pulsa Run
--
-- Tarda unos segundos. Al final deberia decir "Success. No rows returned".
--
-- ES PARA UN PROYECTO NUEVO, donde el esquema no esta instalado todavia. Si lo
-- ejecutas sobre uno que ya lo tiene, se detiene en el primer `create type` con
-- "type app_role already exists" y no cambia nada mas: los tipos y las tablas se
-- crean una sola vez a proposito, para no poder pisar datos reales por accidente.
-- Para empezar de cero, en Supabase: Project Settings -> General -> Reset database.
--
-- NO CONTIENE NINGUN SECRETO. Las credenciales de las Edge Functions se configuran
-- aparte, en el panel de Supabase.
--
-- DESPUES DE ESTO falta crear tu usuario para poder entrar: ver
-- supabase/crear-mi-usuario.sql.
--
-- ARCHIVO GENERADO. No se edita a mano: los cambios se hacen en
-- supabase/migrations/ o en supabase/seed.sql y se regenera con
--
--     python3 scripts/generar-instalacion.py
--
-- CI comprueba que este archivo coincide con las migraciones.
-- =============================================================================



-- ==========================================================================
-- MIGRACION: 20260827000100_initial_schema.sql
-- ==========================================================================

-- Krealo Shift — esquema inicial (especificación §14)
--
-- Principios que sigue este archivo:
--   * UUID y timestamptz en todo; nunca `timestamp` sin zona, porque una tienda
--     puede estar en otra zona horaria que el servidor.
--   * `organization_id` en toda tabla de negocio, para que el aislamiento entre
--     empresas sea una condición simple y no un join de tres saltos.
--   * `time_events` es append-only: los eventos crudos no se editan ni se borran.
--     Las correcciones son filas nuevas en `time_adjustments`.
--   * `work_sessions` es una proyección recalculable, no la fuente original.

-- En Supabase las extensiones viven en el esquema `extensions`, no en `public`.
-- Lo replicamos para que las migraciones sean identicas en local y en la nube.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type app_role as enum ('owner', 'admin', 'manager', 'employee');
create type membership_status as enum ('invited', 'active', 'suspended');
create type employee_status as enum ('invited', 'active', 'inactive');
create type kiosk_status as enum ('active', 'revoked');
create type shift_status as enum ('draft', 'published', 'cancelled');
create type time_event_type as enum ('clock_in', 'break_start', 'break_end', 'clock_out');
create type break_type as enum ('paid', 'unpaid', 'meal', 'other');
create type event_source as enum ('kiosk', 'manager', 'import');
create type work_session_status as enum ('open', 'complete', 'needs_review', 'approved');
create type interval_status as enum ('open', 'complete', 'needs_review');
create type timesheet_period_status as enum ('open', 'approved', 'reopened');
create type request_status as enum ('pending', 'approved', 'rejected');
create type time_edit_request_kind as enum (
  'forgot_clock_in', 'forgot_break', 'forgot_clock_out', 'correction', 'unscheduled_shift'
);

-- ---------------------------------------------------------------------------
-- Utilidades comunes
-- ---------------------------------------------------------------------------

-- `updated_at` lo pone el servidor. Si lo pusiera el cliente, un dispositivo con
-- el reloj mal podría "adelantar" una fila y ganar comparaciones de concurrencia.
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizaciones y personas
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  logo_path text,
  default_locale text not null default 'es-PE',
  default_timezone text not null default 'America/Lima',
  -- 1 = lunes, según ISO. Por defecto la semana empieza el lunes (§2).
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_updated_at
  before update on organizations
  for each row execute function set_updated_at();

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  preferred_name text,
  avatar_path text,
  locale text not null default 'es-PE',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create table organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role app_role not null,
  status membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create trigger organization_memberships_updated_at
  before update on organization_memberships
  for each row execute function set_updated_at();

create index organization_memberships_user_idx
  on organization_memberships (user_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Ubicaciones
-- ---------------------------------------------------------------------------

create table locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  address text not null default '',
  timezone text not null default 'America/Lima',
  is_active boolean not null default true,
  -- Políticas de la ubicación. Se valida su forma en la app con Zod y aquí abajo
  -- lo esencial: la base no se convierte en un JSON gigante (§14).
  settings jsonb not null default jsonb_build_object(
    'pinLength', 6,
    'photoEnabled', false,          -- desactivada por defecto (§9.6)
    'photoRetentionDays', 30,
    'earlyClockInMinutes', 10,
    'lateGraceMinutes', 5,
    'allowUnscheduledShifts', true,
    'timeFormat', '24h',
    'requiredBreakMinutes', 0,
    'dailyOvertimeThresholdMinutes', 480,
    'weeklyOvertimeThresholdMinutes', 2880
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  constraint locations_settings_shape check (
    (settings ->> 'pinLength')::int between 4 and 6
    and (settings -> 'photoEnabled') is not null
    and (settings ->> 'earlyClockInMinutes')::int >= 0
    and (settings ->> 'lateGraceMinutes')::int >= 0
    and (settings ->> 'timeFormat') in ('12h', '24h')
  )
);

create trigger locations_updated_at
  before update on locations
  for each row execute function set_updated_at();

create index locations_org_idx on locations (organization_id) where is_active;

-- ---------------------------------------------------------------------------
-- Empleados
-- ---------------------------------------------------------------------------

-- La entidad laboral está separada de la cuenta de auth: un empleado puede
-- existir y fichar con PIN sin tener nunca una cuenta (§14, §7).
create table employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  employee_number text,
  full_name text not null check (length(btrim(full_name)) > 0),
  preferred_name text,
  email text,
  avatar_path text,
  status employee_status not null default 'active',
  hire_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger employees_updated_at
  before update on employees
  for each row execute function set_updated_at();

-- Único parcial: el email es opcional, pero si existe no se repite en la empresa.
-- Email opcional, unico por organizacion y sin distinguir mayusculas.
create unique index employees_org_email_idx
  on employees (organization_id, lower(email)) where email is not null;
create unique index employees_org_number_idx
  on employees (organization_id, employee_number) where employee_number is not null;
create index employees_org_status_idx on employees (organization_id, status);
create index employees_user_idx on employees (user_id) where user_id is not null;

create table employee_location_assignments (
  employee_id uuid not null references employees (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  -- Un gerente también puede tener turnos como empleado (§7).
  can_manage boolean not null default false,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (employee_id, location_id)
);

create index employee_location_assignments_location_idx
  on employee_location_assignments (location_id);

create table job_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  color text not null default '#7157E8' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table employee_job_roles (
  employee_id uuid not null references employees (id) on delete cascade,
  job_role_id uuid not null references job_roles (id) on delete cascade,
  is_primary boolean not null default false,
  primary key (employee_id, job_role_id)
);

-- ---------------------------------------------------------------------------
-- PIN del empleado
-- ---------------------------------------------------------------------------

-- Solo accesible mediante funciones seguras. Los clientes no tienen `select`:
-- devolver el hash al cliente permitiría atacarlo offline sin límite de intentos.
create table employee_pin_credentials (
  employee_id uuid primary key references employees (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  pin_hash text not null,
  pin_length smallint not null default 6 check (pin_length between 4 and 6),
  version integer not null default 1,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger employee_pin_credentials_updated_at
  before update on employee_pin_credentials
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Kioscos
-- ---------------------------------------------------------------------------

create table kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  -- Un kiosco pertenece a UNA ubicación. Esto es lo que impide que el iPad de
  -- Sede Principal registre eventos como si fuera Sucursal Demo (§32.3).
  location_id uuid not null references locations (id) on delete restrict,
  display_name text not null default 'iPad',
  device_public_id text not null unique,
  credential_hash text not null,
  installation_id text,
  status kiosk_status not null default 'active',
  app_version text,
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint kiosk_devices_revoked_consistency check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

create index kiosk_devices_location_idx on kiosk_devices (location_id) where status = 'active';

create table kiosk_activation_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint kiosk_activation_codes_uses check (used_count <= max_uses)
);

create index kiosk_activation_codes_lookup_idx
  on kiosk_activation_codes (code_hash) where used_count = 0;

-- ---------------------------------------------------------------------------
-- Turnos
-- ---------------------------------------------------------------------------

create table shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  job_role_id uuid references job_roles (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Lima',
  planned_unpaid_break_minutes integer not null default 0
    check (planned_unpaid_break_minutes >= 0),
  employee_note text,
  manager_note text,
  status shift_status not null default 'draft',
  -- Cada publicación incrementa la versión. Las tardanzas se miden contra el
  -- turno publicado vigente en ese momento, así que la versión importa (§13).
  publication_version integer not null default 0,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_end_after_start check (ends_at > starts_at),
  constraint shifts_published_consistency check (
    (status = 'published') <= (published_at is not null)
  )
);

create trigger shifts_updated_at
  before update on shifts
  for each row execute function set_updated_at();

create index shifts_employee_range_idx on shifts (employee_id, starts_at, ends_at);
create index shifts_location_range_idx on shifts (location_id, starts_at);
create index shifts_org_week_idx on shifts (organization_id, starts_at)
  where status <> 'cancelled';

-- Historial de publicación (§11.3): qué se publicó, cuándo y quién.
create table shift_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  week_starts_on date not null,
  publication_version integer not null,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz not null default now(),
  changed_shift_ids uuid[] not null default '{}',
  unique (location_id, week_starts_on, publication_version)
);

-- ---------------------------------------------------------------------------
-- Eventos de tiempo (append-only)
-- ---------------------------------------------------------------------------

create table time_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  location_id uuid not null references locations (id) on delete restrict,
  shift_id uuid references shifts (id) on delete set null,
  event_type time_event_type not null,
  break_type break_type,
  source event_source not null default 'kiosk',
  -- Hora oficial. Online la pone el servidor; offline es la del dispositivo,
  -- marcada con `is_offline` y con su desvío guardado en metadata (§12).
  occurred_at timestamptz not null,
  occurred_at_device timestamptz,
  -- `clock_timestamp()` y no `now()`: dentro de una misma transaccion `now()`
  -- devuelve SIEMPRE el mismo valor, y la sincronizacion offline procesa varios
  -- eventos del mismo empleado en una sola transaccion. Con `now()` todos
  -- compartirian instante y el orden quedaria indefinido.
  received_at timestamptz not null default clock_timestamp(),
  -- Desempate definitivo: el orden real de insercion. Es lo unico que garantiza
  -- un orden estable cuando dos eventos comparten `occurred_at`.
  seq bigint generated always as identity,
  timezone text not null default 'America/Lima',
  -- La clave de idempotencia se genera en el cliente ANTES de guardar, para que
  -- un doble toque o un reintento no creen dos eventos (§12, §17).
  idempotency_key uuid not null,
  device_id uuid references kiosk_devices (id) on delete set null,
  device_sequence bigint,
  is_offline boolean not null default false,
  photo_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  unique (organization_id, idempotency_key),
  constraint time_events_break_type_only_for_breaks check (
    (event_type in ('break_start', 'break_end')) or break_type is null
  )
);

create index time_events_employee_time_idx on time_events (employee_id, occurred_at desc, seq desc);
create index time_events_location_time_idx on time_events (location_id, occurred_at desc);
create index time_events_org_time_idx on time_events (organization_id, occurred_at desc);
create index time_events_shift_idx on time_events (shift_id) where shift_id is not null;

-- Append-only de verdad, no por convención: un update o delete falla en la base
-- aunque alguien tenga permisos. Los eventos crudos son la única prueba de lo que
-- pasó, y una corrección posterior es una fila nueva en `time_adjustments` (§11.4).
create or replace function reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'La tabla % es append-only: usa un ajuste auditable en lugar de modificar el evento original.',
    tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

create trigger time_events_no_update
  before update on time_events
  for each row execute function reject_mutation();

create trigger time_events_no_delete
  before delete on time_events
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------------
-- Sesiones de trabajo (proyección recalculable)
-- ---------------------------------------------------------------------------

create table work_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  location_id uuid not null references locations (id) on delete restrict,
  shift_id uuid references shifts (id) on delete set null,
  clock_in_event_id uuid not null references time_events (id) on delete restrict,
  clock_out_event_id uuid references time_events (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz,
  gross_minutes integer check (gross_minutes >= 0),
  paid_break_minutes integer not null default 0 check (paid_break_minutes >= 0),
  unpaid_break_minutes integer not null default 0 check (unpaid_break_minutes >= 0),
  net_minutes integer check (net_minutes >= 0),
  status work_session_status not null default 'open',
  flags text[] not null default '{}',
  recomputed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_sessions_end_after_start check (ends_at is null or ends_at >= starts_at),
  constraint work_sessions_open_has_no_end check (
    (status = 'open') <= (clock_out_event_id is null)
  )
);

create trigger work_sessions_updated_at
  before update on work_sessions
  for each row execute function set_updated_at();

-- No puede haber dos sesiones abiertas del mismo empleado en la organización (§12).
create unique index work_sessions_one_open_per_employee_idx
  on work_sessions (organization_id, employee_id) where status = 'open';
create index work_sessions_employee_range_idx on work_sessions (employee_id, starts_at desc);
create index work_sessions_location_range_idx on work_sessions (location_id, starts_at desc);
create index work_sessions_review_idx on work_sessions (organization_id)
  where status = 'needs_review';

create table break_intervals (
  id uuid primary key default gen_random_uuid(),
  work_session_id uuid not null references work_sessions (id) on delete cascade,
  start_event_id uuid not null references time_events (id) on delete restrict,
  end_event_id uuid references time_events (id) on delete restrict,
  break_type break_type not null default 'unpaid',
  starts_at timestamptz not null,
  ends_at timestamptz,
  duration_minutes integer check (duration_minutes >= 0),
  status interval_status not null default 'open',
  constraint break_intervals_end_after_start check (ends_at is null or ends_at >= starts_at)
);

create unique index break_intervals_one_open_per_session_idx
  on break_intervals (work_session_id) where status = 'open';
create index break_intervals_session_idx on break_intervals (work_session_id);

-- ---------------------------------------------------------------------------
-- Correcciones y periodos
-- ---------------------------------------------------------------------------

-- Append-only: un ajuste posterior corrige al anterior, no lo borra (§14).
create table time_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  work_session_id uuid references work_sessions (id) on delete set null,
  target_type text not null check (
    target_type in ('work_session', 'break_interval', 'time_event')
  ),
  target_id uuid,
  before_value jsonb not null,
  after_value jsonb not null,
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  request_id uuid,
  channel text not null default 'manager_app'
);

create trigger time_adjustments_no_update
  before update on time_adjustments
  for each row execute function reject_mutation();

create trigger time_adjustments_no_delete
  before delete on time_adjustments
  for each row execute function reject_mutation();

create index time_adjustments_session_idx on time_adjustments (work_session_id);
create index time_adjustments_org_time_idx on time_adjustments (organization_id, created_at desc);

create table timesheet_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid references locations (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  status timesheet_period_status not null default 'open',
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timesheet_periods_range check (ends_on >= starts_on),
  unique (organization_id, location_id, starts_on, ends_on)
);

create trigger timesheet_periods_updated_at
  before update on timesheet_periods
  for each row execute function set_updated_at();

create table time_edit_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  work_session_id uuid references work_sessions (id) on delete set null,
  target_date date,
  kind time_edit_request_kind not null,
  proposed_value jsonb not null default '{}'::jsonb,
  reason text not null check (length(btrim(reason)) > 0),
  status request_status not null default 'pending',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  reviewer_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger time_edit_requests_updated_at
  before update on time_edit_requests
  for each row execute function set_updated_at();

create index time_edit_requests_pending_idx
  on time_edit_requests (organization_id, location_id) where status = 'pending';
create index time_edit_requests_employee_idx on time_edit_requests (employee_id, created_at desc);

-- ---------------------------------------------------------------------------
-- P2: preparadas pero no usadas en la primera entrega (§14)
-- ---------------------------------------------------------------------------

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  day_of_week smallint check (day_of_week between 0 and 6),
  starts_at_local time,
  ends_at_local time,
  is_available boolean not null default true,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now()
);

create table time_off_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  kind text not null default 'unpaid',
  starts_on date not null,
  ends_on date not null,
  reason text,
  status request_status not null default 'pending',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint time_off_requests_range check (ends_on >= starts_on)
);

-- ---------------------------------------------------------------------------
-- Anuncios, notificaciones y auditoría
-- ---------------------------------------------------------------------------

create table announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid references locations (id) on delete cascade,
  title text not null,
  body text not null default '',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  requires_acknowledgement boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  device_name text,
  last_active_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table notification_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  preferences jsonb not null default jsonb_build_object(
    'late', true,
    'noShow', true,
    'earlyClockIn', false,
    'nearOvertime', true,
    'incompleteEntry', true,
    'newRequest', true,
    'scheduleChange', true,
    'kioskNotSyncing', true
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create trigger notification_preferences_updated_at
  before update on notification_preferences
  for each row execute function set_updated_at();

-- Nunca guarda PIN, token ni secreto (§14).
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_device_id uuid references kiosk_devices (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

create trigger audit_logs_no_update
  before update on audit_logs
  for each row execute function reject_mutation();

create trigger audit_logs_no_delete
  before delete on audit_logs
  for each row execute function reject_mutation();

create index audit_logs_org_time_idx on audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);


-- ==========================================================================
-- MIGRACION: 20260827000200_rls.sql
-- ==========================================================================

-- Krealo Shift — Row Level Security (especificación §15)
--
-- RLS es la barrera principal de datos, no la interfaz: ocultar un botón no
-- sustituye una política (§7). Todas las tablas expuestas llevan RLS activo y
-- ninguna política usa `using (true)`.
--
-- El kiosco NO usa estas políticas. Opera con una credencial de dispositivo a
-- través de funciones `security definer`, porque un iPad compartido no puede
-- tener los permisos de un usuario personal (§15).

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------
-- Van en `security definer` porque necesitan leer `organization_memberships`
-- sin quedar atrapadas en la propia política de esa tabla (recursión infinita).
-- `search_path` fijo y vacío: evita que un objeto malicioso en otro esquema
-- secuestre la resolución de nombres.

create or replace function app_is_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function app_role_in(p_organization_id uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;

/**
 * ¿El usuario administra esta ubicación?
 *
 * owner y admin ven la organización completa. El gerente ve SOLO las ubicaciones
 * que tiene asignadas con `can_manage`: es la regla que impide que el gerente de
 * Sede Principal lea Sucursal Demo (§32.7).
 */
create or replace function app_manages_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.locations l
    join public.organization_memberships m
      on m.organization_id = l.organization_id
     and m.user_id = auth.uid()
     and m.status = 'active'
    where l.id = p_location_id
      and (
        m.role in ('owner', 'admin')
        or (
          m.role = 'manager'
          and exists (
            select 1
            from public.employee_location_assignments a
            join public.employees e on e.id = a.employee_id
            where a.location_id = l.id
              and a.can_manage
              and e.user_id = auth.uid()
          )
        )
      )
  );
$$;

/** Registro laboral del usuario actual en una organización, si existe. */
create or replace function app_employee_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.organization_id = p_organization_id
    and e.user_id = auth.uid()
  limit 1;
$$;

/** ¿La fila pertenece al registro laboral del usuario actual? */
create or replace function app_is_self_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.user_id = auth.uid()
  );
$$;

revoke all on function app_is_member(uuid) from public;
revoke all on function app_role_in(uuid, public.app_role[]) from public;
revoke all on function app_manages_location(uuid) from public;
revoke all on function app_employee_id(uuid) from public;
revoke all on function app_is_self_employee(uuid) from public;
grant execute on function app_is_member(uuid) to authenticated;
grant execute on function app_role_in(uuid, public.app_role[]) to authenticated;
grant execute on function app_manages_location(uuid) to authenticated;
grant execute on function app_employee_id(uuid) to authenticated;
grant execute on function app_is_self_employee(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS activo en todo
-- ---------------------------------------------------------------------------

alter table organizations              enable row level security;
alter table profiles                   enable row level security;
alter table organization_memberships   enable row level security;
alter table locations                  enable row level security;
alter table employees                  enable row level security;
alter table employee_location_assignments enable row level security;
alter table job_roles                  enable row level security;
alter table employee_job_roles         enable row level security;
alter table employee_pin_credentials   enable row level security;
alter table kiosk_devices              enable row level security;
alter table kiosk_activation_codes     enable row level security;
alter table shifts                     enable row level security;
alter table shift_publications         enable row level security;
alter table time_events                enable row level security;
alter table work_sessions              enable row level security;
alter table break_intervals            enable row level security;
alter table time_adjustments           enable row level security;
alter table timesheet_periods          enable row level security;
alter table time_edit_requests         enable row level security;
alter table availability_rules         enable row level security;
alter table time_off_requests          enable row level security;
alter table announcements              enable row level security;
alter table push_tokens                enable row level security;
alter table notification_preferences   enable row level security;
alter table audit_logs                 enable row level security;

-- `force` para que ni el dueño de la tabla se salte las políticas por accidente
-- en una migración futura.
alter table employee_pin_credentials   force row level security;
alter table kiosk_activation_codes     force row level security;
alter table time_events                force row level security;
alter table audit_logs                 force row level security;

-- ---------------------------------------------------------------------------
-- Organizaciones y perfiles
-- ---------------------------------------------------------------------------

create policy organizations_select on organizations
  for select to authenticated
  using (app_is_member(id));

create policy organizations_update on organizations
  for update to authenticated
  using (app_role_in(id, array['owner', 'admin']::app_role[]))
  with check (app_role_in(id, array['owner', 'admin']::app_role[]));

create policy profiles_select_self on profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Membresías
-- ---------------------------------------------------------------------------

create policy memberships_select on organization_memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[])
  );

-- Protección contra escalamiento de rol (§15): un empleado no puede darse un rol
-- superior modificando su propia fila, porque no puede escribir en esta tabla.
create policy memberships_write on organization_memberships
  for all to authenticated
  using (app_role_in(organization_id, array['owner', 'admin']::app_role[]))
  with check (app_role_in(organization_id, array['owner', 'admin']::app_role[]));

-- ---------------------------------------------------------------------------
-- Ubicaciones y catálogos
-- ---------------------------------------------------------------------------

create policy locations_select on locations
  for select to authenticated
  using (app_is_member(organization_id));

create policy locations_write on locations
  for all to authenticated
  using (app_role_in(organization_id, array['owner', 'admin']::app_role[]))
  with check (app_role_in(organization_id, array['owner', 'admin']::app_role[]));

create policy job_roles_select on job_roles
  for select to authenticated
  using (app_is_member(organization_id));

create policy job_roles_write on job_roles
  for all to authenticated
  using (app_role_in(organization_id, array['owner', 'admin']::app_role[]))
  with check (app_role_in(organization_id, array['owner', 'admin']::app_role[]));

-- ---------------------------------------------------------------------------
-- Empleados
-- ---------------------------------------------------------------------------

-- El empleado ve solo su propio registro laboral. El gerente, solo la gente de
-- las ubicaciones que administra.
create policy employees_select on employees
  for select to authenticated
  using (
    user_id = auth.uid()
    or app_role_in(organization_id, array['owner', 'admin']::app_role[])
    or exists (
      select 1 from employee_location_assignments a
      where a.employee_id = employees.id
        and app_manages_location(a.location_id)
    )
  );

create policy employees_write on employees
  for all to authenticated
  using (
    app_role_in(organization_id, array['owner', 'admin']::app_role[])
    or exists (
      select 1 from employee_location_assignments a
      where a.employee_id = employees.id
        and app_manages_location(a.location_id)
    )
  )
  with check (app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[]));

create policy employee_locations_select on employee_location_assignments
  for select to authenticated
  using (app_is_self_employee(employee_id) or app_manages_location(location_id));

create policy employee_locations_write on employee_location_assignments
  for all to authenticated
  using (app_manages_location(location_id))
  with check (app_manages_location(location_id));

create policy employee_job_roles_select on employee_job_roles
  for select to authenticated
  using (
    app_is_self_employee(employee_id)
    or exists (
      select 1 from employee_location_assignments a
      where a.employee_id = employee_job_roles.employee_id
        and app_manages_location(a.location_id)
    )
  );

create policy employee_job_roles_write on employee_job_roles
  for all to authenticated
  using (
    exists (
      select 1 from employee_location_assignments a
      where a.employee_id = employee_job_roles.employee_id
        and app_manages_location(a.location_id)
    )
  )
  with check (
    exists (
      select 1 from employee_location_assignments a
      where a.employee_id = employee_job_roles.employee_id
        and app_manages_location(a.location_id)
    )
  );

-- ---------------------------------------------------------------------------
-- PIN, kioscos y códigos: sin acceso desde clientes
-- ---------------------------------------------------------------------------
-- No se crea NINGUNA política de select para estas tres tablas. Con RLS activo y
-- sin política, un cliente autenticado no lee ni una fila. Solo las funciones
-- `security definer` y la `service_role` de las Edge Functions llegan aquí.
-- Es lo que impide leer `pin_hash`, `credential_hash` o un código de activación.

revoke all on employee_pin_credentials from anon, authenticated;
revoke all on kiosk_activation_codes from anon, authenticated;

-- De los kioscos, el administrador sí necesita ver el inventario para revocarlos
-- (§11.6), pero nunca las columnas de los secretos. Eso se resuelve con la vista
-- `kiosk_devices_admin`, que se crea en
-- `20260827001000_kiosk_devices_admin.sql` y no expone `credential_hash` ni
-- `offline_key`. (Este comentario decía "de la migración de funciones", donde esa
-- vista nunca se escribió: el administrador podía generar códigos de activación
-- pero no ver la lista, así que no podía revocar ningún iPad.)
revoke all on kiosk_devices from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Turnos
-- ---------------------------------------------------------------------------

-- El empleado ve solo sus turnos PUBLICADOS: un borrador es trabajo en curso del
-- administrador y mostrarlo generaría reclamos por turnos que aún no existen.
create policy shifts_select on shifts
  for select to authenticated
  using (
    (app_is_self_employee(employee_id) and status = 'published')
    or app_manages_location(location_id)
  );

create policy shifts_write on shifts
  for all to authenticated
  using (app_manages_location(location_id))
  with check (app_manages_location(location_id));

create policy shift_publications_select on shift_publications
  for select to authenticated
  using (app_manages_location(location_id));

create policy shift_publications_insert on shift_publications
  for insert to authenticated
  with check (app_manages_location(location_id));

-- ---------------------------------------------------------------------------
-- Eventos de tiempo
-- ---------------------------------------------------------------------------

create policy time_events_select on time_events
  for select to authenticated
  using (app_is_self_employee(employee_id) or app_manages_location(location_id));

-- Sin política de insert: el empleado NO puede insertar un evento directo (§15).
-- Los eventos entran por `submit_time_event`, que valida credencial del kiosco,
-- token de acción, estado, tienda e idempotencia.
-- Sin política de update ni delete: además los triggers lo prohíben en la base.

-- ---------------------------------------------------------------------------
-- Sesiones, descansos y correcciones
-- ---------------------------------------------------------------------------

create policy work_sessions_select on work_sessions
  for select to authenticated
  using (app_is_self_employee(employee_id) or app_manages_location(location_id));

create policy work_sessions_manager_write on work_sessions
  for update to authenticated
  using (app_manages_location(location_id))
  with check (app_manages_location(location_id));

create policy break_intervals_select on break_intervals
  for select to authenticated
  using (
    exists (
      select 1 from work_sessions s
      where s.id = break_intervals.work_session_id
        and (app_is_self_employee(s.employee_id) or app_manages_location(s.location_id))
    )
  );

create policy time_adjustments_select on time_adjustments
  for select to authenticated
  using (
    exists (
      select 1 from work_sessions s
      where s.id = time_adjustments.work_session_id
        and (app_is_self_employee(s.employee_id) or app_manages_location(s.location_id))
    )
    or app_role_in(organization_id, array['owner', 'admin']::app_role[])
  );

create policy time_adjustments_insert on time_adjustments
  for insert to authenticated
  with check (
    exists (
      select 1 from work_sessions s
      where s.id = time_adjustments.work_session_id
        and app_manages_location(s.location_id)
    )
  );
-- Sin update ni delete: los triggers de la base ya lo impiden, y aquí tampoco
-- hay política que lo permita.

create policy timesheet_periods_select on timesheet_periods
  for select to authenticated
  using (
    app_is_member(organization_id)
    and (location_id is null or app_manages_location(location_id))
  );

create policy timesheet_periods_write on timesheet_periods
  for all to authenticated
  using (
    location_id is null
      and app_role_in(organization_id, array['owner', 'admin']::app_role[])
    or location_id is not null and app_manages_location(location_id)
  )
  with check (
    location_id is null
      and app_role_in(organization_id, array['owner', 'admin']::app_role[])
    or location_id is not null and app_manages_location(location_id)
  );

-- ---------------------------------------------------------------------------
-- Solicitudes
-- ---------------------------------------------------------------------------

create policy time_edit_requests_select on time_edit_requests
  for select to authenticated
  using (app_is_self_employee(employee_id) or app_manages_location(location_id));

create policy time_edit_requests_insert on time_edit_requests
  for insert to authenticated
  with check (app_is_self_employee(employee_id) or app_manages_location(location_id));

-- Solo un gerente resuelve una solicitud. El empleado no puede aprobarse la suya:
-- eso convertiría "Olvidé marcar" en una edición directa de la hoja de tiempo.
create policy time_edit_requests_review on time_edit_requests
  for update to authenticated
  using (app_manages_location(location_id))
  with check (app_manages_location(location_id));

create policy availability_rules_select on availability_rules
  for select to authenticated
  using (
    app_is_self_employee(employee_id)
    or app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[])
  );

create policy time_off_requests_select on time_off_requests
  for select to authenticated
  using (
    app_is_self_employee(employee_id)
    or app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[])
  );

-- ---------------------------------------------------------------------------
-- Anuncios y notificaciones
-- ---------------------------------------------------------------------------

create policy announcements_select on announcements
  for select to authenticated
  using (
    app_is_member(organization_id)
    and (location_id is null or app_is_member(organization_id))
  );

create policy announcements_write on announcements
  for all to authenticated
  using (app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[]))
  with check (app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[]));

create policy push_tokens_own on push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notification_preferences_own on notification_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------

-- Solo lectura, y solo para propietarios y administradores (§14).
create policy audit_logs_select on audit_logs
  for select to authenticated
  using (app_role_in(organization_id, array['owner', 'admin']::app_role[]));
-- Sin insert desde cliente: la escriben las funciones seguras.

-- ---------------------------------------------------------------------------
-- Permisos de tabla
-- ---------------------------------------------------------------------------
-- RLS filtra filas, pero el `grant` decide si la tabla se puede tocar. Los dos
-- niveles tienen que estar bien: RLS sin `revoke` deja pasar un `delete` masivo
-- sobre las filas que el usuario sí ve.

grant usage on schema public to anon, authenticated;

grant select on organizations, locations, job_roles, employees,
  employee_location_assignments, employee_job_roles, shifts, shift_publications,
  time_events, work_sessions, break_intervals, time_adjustments,
  timesheet_periods, time_edit_requests, availability_rules, time_off_requests,
  announcements, audit_logs, organization_memberships
  to authenticated;

grant insert, update on shifts, shift_publications, timesheet_periods,
  time_edit_requests, employees, employee_location_assignments,
  employee_job_roles, locations, job_roles, announcements,
  organization_memberships
  to authenticated;

grant insert on time_adjustments to authenticated;
grant update on work_sessions to authenticated;
grant all on push_tokens, notification_preferences to authenticated;
grant update on organizations to authenticated;
grant select, update on profiles to authenticated;

-- Borrar turnos en borrador es parte normal del trabajo del administrador; el
-- resto de las tablas no se borra desde el cliente.
grant delete on shifts, employee_location_assignments, employee_job_roles to authenticated;

-- Nada para `anon`: la app siempre actúa autenticada o a través de una función
-- del kiosco con credencial de dispositivo.
revoke all on all tables in schema public from anon;


-- ==========================================================================
-- MIGRACION: 20260827000300_functions.sql
-- ==========================================================================

-- Krealo Shift — funciones seguras y vistas (especificación §14, §16)
--
-- Estas funciones son la única vía por la que entra un evento de tiempo. El
-- cliente nunca inserta en `time_events`: aquí se valida credencial del kiosco,
-- estado, turno elegible, tienda vinculada e idempotencia (§14).
--
-- Todas son `security definer` con `search_path` fijo y sin permisos para
-- `anon`/`authenticated` salvo donde se indica: las llama la Edge Function con
-- la `service_role`, que nunca sale del servidor (§22).
--
-- NOTA SOBRE EL HASH DEL PIN
-- La especificación pide Argon2id "o un mecanismo robusto disponible en la
-- función segura" (§8). Argon2 no está disponible en Postgres ni en pgcrypto, así
-- que se usa bcrypt con coste 12 vía `crypt()`. Es el mecanismo más fuerte
-- disponible dentro de la base, y mantener el hash en un solo lugar vale más que
-- ganar un algoritmo y partir la lógica entre la base y una Edge Function.

-- ---------------------------------------------------------------------------
-- Estado de asistencia
-- ---------------------------------------------------------------------------

/**
 * Estado actual de un empleado, derivado de sus eventos crudos.
 *
 * Se deriva, no se guarda: `work_sessions` es una proyección recalculable y los
 * eventos son la única fuente (§14). Refleja la misma máquina de estados que el
 * cliente en src/domain/attendance-state-machine.ts (§12).
 */
create or replace function current_attendance_state(p_employee_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last public.time_event_type;
begin
  select event_type into v_last
  from public.time_events
  where employee_id = p_employee_id
  -- El desempate por `seq` es lo que hace determinista el estado cuando varios
  -- eventos comparten instante, como pasa al sincronizar un lote offline.
  order by occurred_at desc, received_at desc, seq desc
  limit 1;

  if v_last is null then return 'OFF_SHIFT'; end if;

  return case v_last
    when 'clock_in'    then 'WORKING'
    when 'break_end'   then 'WORKING'
    when 'break_start' then 'ON_BREAK'
    when 'clock_out'   then 'OFF_SHIFT'
  end;
end;
$$;

/** Transición permitida por la máquina de estados (§12). */
create or replace function attendance_transition_allowed(
  p_state text,
  p_event public.time_event_type
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_state
    when 'OFF_SHIFT' then p_event = 'clock_in'
    when 'WORKING'   then p_event in ('break_start', 'clock_out')
    when 'ON_BREAK'  then p_event in ('break_end', 'clock_out')
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- PIN del empleado
-- ---------------------------------------------------------------------------

/**
 * Fija o rota el PIN de un empleado. Devuelve nada: el PIN en claro no vuelve al
 * cliente ni se registra en auditoría (§22). Quien lo genera es el gerente, y la
 * app lo muestra una sola vez (§11.2).
 */
create or replace function set_employee_pin(p_employee_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_len smallint := length(p_pin);
begin
  if v_len < 4 or v_len > 6 or p_pin !~ '^[0-9]+$' then
    raise exception 'El PIN debe tener entre 4 y 6 dígitos numéricos.'
      using errcode = 'check_violation';
  end if;

  select organization_id into v_org from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception 'Empleado inexistente.' using errcode = 'no_data_found';
  end if;

  insert into public.employee_pin_credentials as c
    (employee_id, organization_id, pin_hash, pin_length, version, rotated_at)
  values
    (p_employee_id, v_org, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), v_len, 1, now())
  on conflict (employee_id) do update
    set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
        pin_length = v_len,
        version = c.version + 1,
        failed_attempts = 0,
        locked_until = null,
        rotated_at = now();
end;
$$;

/**
 * Verifica un PIN dentro de una ubicación y devuelve a quién corresponde.
 *
 * Reglas que aplica (§8):
 *   - limita intentos y aplica bloqueo progresivo;
 *   - tras 5 fallos bloquea ese PIN en esa ubicación por 15 minutos;
 *   - no revela nunca a quién pertenece un PIN fallido ni bloqueado;
 *   - solo considera empleados activos asignados a esa ubicación.
 *
 * Devuelve `employee_id` o null. El intento se registra en auditoría sin decir
 * qué empleado era, porque un PIN fallido no identifica a nadie con certeza.
 */
create or replace function verify_employee_pin(
  p_location_id uuid,
  p_pin text
)
returns table (employee_id uuid, locked_until timestamptz, remaining_attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_candidate record;
  v_max_attempts constant integer := 5;
  v_lock_minutes constant integer := 15;
begin
  select organization_id into v_org from public.locations where id = p_location_id;
  if v_org is null then
    raise exception 'Ubicación inexistente.' using errcode = 'no_data_found';
  end if;

  -- Recorremos solo a los empleados activos de esa ubicación. El PIN es único por
  -- persona pero no globalmente, así que la ubicación acota el espacio.
  for v_candidate in
    select c.employee_id, c.pin_hash, c.failed_attempts, c.locked_until
    from public.employee_pin_credentials c
    join public.employees e on e.id = c.employee_id
    join public.employee_location_assignments a on a.employee_id = e.id
    where a.location_id = p_location_id
      and e.status = 'active'
      and c.organization_id = v_org
  loop
    if v_candidate.pin_hash = extensions.crypt(p_pin, v_candidate.pin_hash) then
      -- PIN correcto, pero puede estar bloqueado por intentos previos.
      if v_candidate.locked_until is not null and v_candidate.locked_until > now() then
        return query select null::uuid, v_candidate.locked_until, 0;
        return;
      end if;

      update public.employee_pin_credentials
        set failed_attempts = 0, locked_until = null
        where employee_pin_credentials.employee_id = v_candidate.employee_id;

      return query select v_candidate.employee_id, null::timestamptz, v_max_attempts;
      return;
    end if;
  end loop;

  -- Ningún PIN coincidió. Se incrementa el contador de la ubicación completa para
  -- que un atacante no pueda probar 10.000 combinaciones sin coste, y se registra
  -- el incidente sin revelar identidad (§8).
  update public.employee_pin_credentials c
    set failed_attempts = c.failed_attempts + 1,
        locked_until = case
          when c.failed_attempts + 1 >= v_max_attempts
            then now() + make_interval(mins => v_lock_minutes)
          else c.locked_until
        end
  where c.employee_id in (
    select a.employee_id from public.employee_location_assignments a
    where a.location_id = p_location_id
  );

  insert into public.audit_logs (organization_id, action, entity_type, entity_id, after_data)
  values (v_org, 'pin_verification_failed', 'location', p_location_id,
          jsonb_build_object('at', now()));

  return query select null::uuid, null::timestamptz, null::integer;
end;
$$;

-- ---------------------------------------------------------------------------
-- Kioscos
-- ---------------------------------------------------------------------------

/**
 * Genera un código de activación temporal para vincular un iPad a UNA ubicación.
 * Devuelve el código en claro una sola vez: en la base solo queda su hash (§8).
 */
create or replace function create_kiosk_activation_code(
  p_location_id uuid,
  p_valid_minutes integer default 30
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_code text;
begin
  select organization_id into v_org from public.locations where id = p_location_id;
  if v_org is null then
    raise exception 'Ubicación inexistente.' using errcode = 'no_data_found';
  end if;

  if not public.app_role_in(v_org, array['owner', 'admin']::public.app_role[]) then
    raise exception 'Solo un propietario o administrador genera códigos de activación.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 8 caracteres sin vocales ni caracteres ambiguos: se dicta por teléfono sin
  -- confundir O con 0 ni I con 1.
  v_code := upper(
    translate(
      substring(encode(extensions.gen_random_bytes(8), 'base64') from 1 for 8),
      '+/=OoIl01', 'XYZWKMNPQ'
    )
  );

  insert into public.kiosk_activation_codes
    (organization_id, location_id, code_hash, expires_at, created_by)
  values
    (v_org, p_location_id, extensions.crypt(v_code, extensions.gen_salt('bf', 10)),
     now() + make_interval(mins => greatest(p_valid_minutes, 1)), auth.uid());

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id)
  values (v_org, auth.uid(), 'kiosk_activation_code_created', 'location', p_location_id);

  return v_code;
end;
$$;

/**
 * Canjea un código y vincula el dispositivo. Devuelve la credencial limitada del
 * kiosco en claro una sola vez; en la base queda su hash.
 *
 * Nunca se reutiliza una sesión de administrador como credencial del kiosco (§8).
 */
create or replace function activate_kiosk_device(
  p_code text,
  p_installation_id text,
  p_display_name text,
  p_app_version text
)
returns table (
  device_id uuid,
  device_public_id text,
  credential text,
  organization_id uuid,
  location_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_credential text;
  v_public_id text;
  v_device_id uuid;
begin
  select * into v_row
  from public.kiosk_activation_codes c
  where c.expires_at > now()
    and c.used_count < c.max_uses
    and c.code_hash = extensions.crypt(p_code, c.code_hash)
  limit 1;

  if v_row is null then
    raise exception 'Código de activación inválido o vencido.'
      using errcode = 'invalid_authorization_specification';
  end if;

  v_credential := encode(extensions.gen_random_bytes(32), 'hex');
  v_public_id := encode(extensions.gen_random_bytes(9), 'hex');

  insert into public.kiosk_devices
    (organization_id, location_id, display_name, device_public_id, credential_hash,
     installation_id, app_version, last_seen_at, created_by)
  values
    (v_row.organization_id, v_row.location_id, coalesce(nullif(btrim(p_display_name), ''), 'iPad'),
     v_public_id, extensions.crypt(v_credential, extensions.gen_salt('bf', 10)),
     p_installation_id, p_app_version, now(), v_row.created_by)
  returning id into v_device_id;

  update public.kiosk_activation_codes
    set used_count = used_count + 1
    where id = v_row.id;

  insert into public.audit_logs
    (organization_id, actor_device_id, action, entity_type, entity_id, after_data)
  values
    (v_row.organization_id, v_device_id, 'kiosk_activated', 'kiosk_device', v_device_id,
     jsonb_build_object('locationId', v_row.location_id, 'appVersion', p_app_version));

  return query select v_device_id, v_public_id, v_credential,
                      v_row.organization_id, v_row.location_id;
end;
$$;

/** Valida la credencial de un kiosco y devuelve su vinculación si sigue activo. */
create or replace function authenticate_kiosk(p_public_id text, p_credential text)
returns table (device_id uuid, organization_id uuid, location_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select d.id, d.organization_id, d.location_id, d.credential_hash, d.status
  into v_row
  from public.kiosk_devices d
  where d.device_public_id = p_public_id;

  if v_row is null then
    raise exception 'Dispositivo desconocido.' using errcode = 'invalid_authorization_specification';
  end if;

  -- Un kiosco revocado no puede sincronizar ni enviar nada más (§32.4).
  if v_row.status <> 'active' then
    raise exception 'Este reloj fue desactivado.' using errcode = 'invalid_authorization_specification';
  end if;

  if v_row.credential_hash <> extensions.crypt(p_credential, v_row.credential_hash) then
    raise exception 'Credencial de dispositivo inválida.'
      using errcode = 'invalid_authorization_specification';
  end if;

  update public.kiosk_devices set last_seen_at = now() where id = v_row.id;

  return query select v_row.id, v_row.organization_id, v_row.location_id;
end;
$$;

create or replace function revoke_kiosk_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.kiosk_devices where id = p_device_id;
  if v_org is null then
    raise exception 'Dispositivo inexistente.' using errcode = 'no_data_found';
  end if;
  if not public.app_role_in(v_org, array['owner', 'admin']::public.app_role[]) then
    raise exception 'Solo un propietario o administrador revoca un reloj.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.kiosk_devices
    set status = 'revoked', revoked_at = now()
    where id = p_device_id and status = 'active';

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id)
  values (v_org, auth.uid(), 'kiosk_revoked', 'kiosk_device', p_device_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Registro de eventos
-- ---------------------------------------------------------------------------

/**
 * Única puerta de entrada de un evento de tiempo (§14, §16).
 *
 * Valida, en este orden:
 *   1. que el dispositivo esté activo y vinculado a la MISMA tienda del evento;
 *   2. idempotencia: un reintento con la misma clave devuelve el resultado
 *      original en lugar de crear un segundo evento;
 *   3. que la transición sea posible según la máquina de estados;
 *   4. que el turno, si viene, pertenezca al empleado y a esa ubicación;
 *   5. la regla de entrada temprana de la ubicación.
 *
 * Después actualiza la proyección `work_sessions` / `break_intervals`.
 */
create or replace function submit_time_event(
  p_device_id uuid,
  p_employee_id uuid,
  p_event_type public.time_event_type,
  p_idempotency_key uuid,
  p_shift_id uuid default null,
  p_break_type public.break_type default null,
  p_occurred_at_device timestamptz default null,
  p_device_sequence bigint default null,
  p_is_offline boolean default false,
  p_photo_path text default null,
  p_source public.event_source default 'kiosk'
)
returns table (
  status text,
  event_id uuid,
  attendance_state text,
  flags text[],
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_employee record;
  v_location record;
  v_existing record;
  v_state text;
  v_occurred timestamptz;
  v_flags text[] := '{}';
  v_event_id uuid;
  v_shift record;
  v_settings jsonb;
  v_drift_seconds integer;
begin
  -- 1. Dispositivo
  select d.id, d.organization_id, d.location_id, d.status
  into v_device
  from public.kiosk_devices d where d.id = p_device_id;

  if v_device is null or v_device.status <> 'active' then
    raise exception 'Este reloj fue desactivado.'
      using errcode = 'invalid_authorization_specification';
  end if;

  select e.id, e.organization_id, e.status into v_employee
  from public.employees e where e.id = p_employee_id;

  if v_employee is null or v_employee.status <> 'active' then
    raise exception 'Empleado inactivo o inexistente.' using errcode = 'no_data_found';
  end if;

  if v_employee.organization_id <> v_device.organization_id then
    raise exception 'El empleado no pertenece a la organización de este reloj.'
      using errcode = 'insufficient_privilege';
  end if;

  -- El iPad de Sede Principal no puede registrar como si fuera Sucursal Demo.
  if not exists (
    select 1 from public.employee_location_assignments a
    where a.employee_id = p_employee_id and a.location_id = v_device.location_id
  ) then
    raise exception 'El empleado no está asignado a la tienda de este reloj.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 2. Idempotencia: mismo resultado, no un segundo evento (§12).
  select te.id, te.event_type into v_existing
  from public.time_events te
  where te.organization_id = v_device.organization_id
    and te.idempotency_key = p_idempotency_key;

  if v_existing is not null then
    return query select 'duplicate'::text, v_existing.id,
                        public.current_attendance_state(p_employee_id),
                        array['duplicate']::text[],
                        (select te.occurred_at from public.time_events te where te.id = v_existing.id);
    return;
  end if;

  select l.*, l.settings into v_location
  from public.locations l where l.id = v_device.location_id;
  v_settings := v_location.settings;

  -- 3. Transición
  v_state := public.current_attendance_state(p_employee_id);
  if not public.attendance_transition_allowed(v_state, p_event_type) then
    raise exception 'Transición no válida: % desde %', p_event_type, v_state
      using errcode = 'check_violation';
  end if;

  -- Hora oficial: del servidor si hay conexión; del dispositivo si fue offline,
  -- marcada como tal y con su desvío guardado para que el gerente lo vea (§12).
  if p_is_offline and p_occurred_at_device is not null then
    v_occurred := p_occurred_at_device;
    v_drift_seconds := abs(extract(epoch from (now() - p_occurred_at_device)))::integer;
    if v_drift_seconds > 120 then
      v_flags := array_append(v_flags, 'clock_drift');
    end if;
  else
    v_occurred := now();
    if p_occurred_at_device is not null then
      v_drift_seconds := abs(extract(epoch from (p_occurred_at_device - now())))::integer;
      if v_drift_seconds > 120 then
        v_flags := array_append(v_flags, 'clock_drift');
      end if;
    end if;
  end if;

  -- 4. Turno
  if p_shift_id is not null then
    select s.* into v_shift from public.shifts s where s.id = p_shift_id;
    if v_shift is null
       or v_shift.employee_id <> p_employee_id
       or v_shift.location_id <> v_device.location_id then
      raise exception 'El turno no corresponde a este empleado o tienda.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- 5. Entrada temprana y tardanza
  if p_event_type = 'clock_in' then
    -- Se comprueba el parametro, no la variable: si el fichaje no lleva turno,
    -- `v_shift` nunca se asigno y leer un campo suyo aborta la funcion en plena
    -- jornada. Lo encontro la prueba de jornada completa sin turno programado.
    if p_shift_id is not null then
      if v_occurred < v_shift.starts_at
                      - make_interval(mins => (v_settings ->> 'earlyClockInMinutes')::int) then
        raise exception 'Todavía es temprano para marcar entrada.' using errcode = 'check_violation';
      end if;
      if v_occurred > v_shift.starts_at
                      + make_interval(mins => (v_settings ->> 'lateGraceMinutes')::int) then
        v_flags := array_append(v_flags, 'late_arrival');
      end if;
    elsif not (v_settings ->> 'allowUnscheduledShifts')::boolean then
      raise exception 'Esta tienda no permite turnos no programados.'
        using errcode = 'check_violation';
    else
      v_flags := array_append(v_flags, 'unscheduled');
    end if;
  end if;

  insert into public.time_events (
    organization_id, employee_id, location_id, shift_id, event_type, break_type,
    source, occurred_at, occurred_at_device, timezone, idempotency_key,
    device_id, device_sequence, is_offline, photo_path, metadata
  ) values (
    v_device.organization_id, p_employee_id, v_device.location_id, p_shift_id,
    p_event_type,
    case when p_event_type in ('break_start', 'break_end')
         then coalesce(p_break_type, 'unpaid') else null end,
    p_source, v_occurred, p_occurred_at_device, v_location.timezone, p_idempotency_key,
    p_device_id, p_device_sequence, p_is_offline, p_photo_path,
    jsonb_build_object('driftSeconds', v_drift_seconds)
  )
  returning id into v_event_id;

  perform public.apply_event_to_projection(v_event_id);

  return query select 'accepted'::text, v_event_id,
                      public.current_attendance_state(p_employee_id),
                      v_flags, v_occurred;
end;
$$;

/**
 * Lleva un evento a la proyección `work_sessions` / `break_intervals`.
 *
 * La proyección es un caché para consultar rápido; si se corrompe se puede
 * reconstruir desde los eventos con `rebuild_work_session` (§14).
 */
create or replace function apply_event_to_projection(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev record;
  v_session record;
  v_break record;
  v_minutes integer;
begin
  select * into v_ev from public.time_events where id = p_event_id;
  if v_ev is null then return; end if;

  select * into v_session
  from public.work_sessions
  where employee_id = v_ev.employee_id and status = 'open'
  limit 1;

  if v_ev.event_type = 'clock_in' then
    insert into public.work_sessions (
      organization_id, employee_id, location_id, shift_id,
      clock_in_event_id, starts_at, status
    ) values (
      v_ev.organization_id, v_ev.employee_id, v_ev.location_id, v_ev.shift_id,
      v_ev.id, v_ev.occurred_at, 'open'
    );
    return;
  end if;

  if v_session is null then
    -- Un descanso o una salida sin sesión abierta es una anomalía real, no algo
    -- que se pueda arreglar inventando una entrada. Se deja constancia.
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, after_data)
    values (v_ev.organization_id, 'event_without_open_session', 'time_event', v_ev.id,
            jsonb_build_object('eventType', v_ev.event_type));
    return;
  end if;

  if v_ev.event_type = 'break_start' then
    insert into public.break_intervals
      (work_session_id, start_event_id, break_type, starts_at, status)
    values (v_session.id, v_ev.id, coalesce(v_ev.break_type, 'unpaid'), v_ev.occurred_at, 'open');

  elsif v_ev.event_type = 'break_end' then
    select * into v_break
    from public.break_intervals
    where work_session_id = v_session.id and status = 'open'
    limit 1;

    if v_break.id is null then return; end if;

    v_minutes := greatest(0, (extract(epoch from (v_ev.occurred_at - v_break.starts_at)) / 60)::int);

    update public.break_intervals
      set end_event_id = v_ev.id, ends_at = v_ev.occurred_at,
          duration_minutes = v_minutes, status = 'complete'
      where id = v_break.id;

    if v_break.break_type = 'paid' then
      update public.work_sessions
        set paid_break_minutes = paid_break_minutes + v_minutes
        where id = v_session.id;
    else
      update public.work_sessions
        set unpaid_break_minutes = unpaid_break_minutes + v_minutes
        where id = v_session.id;
    end if;

  elsif v_ev.event_type = 'clock_out' then
    -- Si quedó un descanso abierto se cierra con la hora de la salida y se marca
    -- para revisión: no se descarta ni se inventa una duración (§12).
    select * into v_break
    from public.break_intervals
    where work_session_id = v_session.id and status = 'open'
    limit 1;

    -- `v_break is not null` NO sirve aqui: en plpgsql un record es "no nulo" solo
    -- si TODOS sus campos lo son, y un descanso abierto tiene ends_at nulo. Se
    -- comprueba la clave primaria, que si distingue "encontrado" de "no habia".
    if v_break.id is not null then
      v_minutes := greatest(0, (extract(epoch from (v_ev.occurred_at - v_break.starts_at)) / 60)::int);
      update public.break_intervals
        set end_event_id = v_ev.id, ends_at = v_ev.occurred_at,
            duration_minutes = v_minutes, status = 'needs_review'
        where id = v_break.id;
      if v_break.break_type = 'paid' then
        update public.work_sessions set paid_break_minutes = paid_break_minutes + v_minutes
          where id = v_session.id;
      else
        update public.work_sessions set unpaid_break_minutes = unpaid_break_minutes + v_minutes
          where id = v_session.id;
      end if;
    end if;

    update public.work_sessions s
      set clock_out_event_id = v_ev.id,
          ends_at = v_ev.occurred_at,
          gross_minutes = greatest(0, (extract(epoch from (v_ev.occurred_at - s.starts_at)) / 60)::int),
          net_minutes = greatest(
            0,
            (extract(epoch from (v_ev.occurred_at - s.starts_at)) / 60)::int
              - s.unpaid_break_minutes
          ),
          status = (case when v_break.id is not null then 'needs_review' else 'complete' end)::public.work_session_status,
          flags = case when v_break.id is not null
                       then array_append(s.flags, 'break_closed_on_clock_out')
                       else s.flags end,
          recomputed_at = now()
      where s.id = v_session.id;
  end if;
end;
$$;

/**
 * Reconstruye una sesión desde los eventos crudos. Es la red de seguridad de la
 * proyección: si un cálculo quedó mal, se recalcula sin tocar los eventos (§14).
 */
create or replace function rebuild_work_session(p_work_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_paid integer := 0;
  v_unpaid integer := 0;
  v_gross integer;
begin
  select * into v_session from public.work_sessions where id = p_work_session_id;
  if v_session is null then return; end if;

  select
    coalesce(sum(case when break_type = 'paid' then duration_minutes else 0 end), 0),
    coalesce(sum(case when break_type <> 'paid' then duration_minutes else 0 end), 0)
  into v_paid, v_unpaid
  from public.break_intervals
  where work_session_id = p_work_session_id and duration_minutes is not null;

  v_gross := case
    when v_session.ends_at is null then null
    else greatest(0, (extract(epoch from (v_session.ends_at - v_session.starts_at)) / 60)::int)
  end;

  update public.work_sessions
    set paid_break_minutes = v_paid,
        unpaid_break_minutes = v_unpaid,
        gross_minutes = v_gross,
        net_minutes = case when v_gross is null then null else greatest(0, v_gross - v_unpaid) end,
        recomputed_at = now()
    where id = p_work_session_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Correcciones del gerente
-- ---------------------------------------------------------------------------

/**
 * Corrige una sesión dejando auditoría completa (§11.4).
 *
 * Nunca sobrescribe el evento original: guarda el valor anterior y el nuevo en
 * `time_adjustments`, que es append-only. Detecta edición concurrente comparando
 * contra el valor que el gerente tenía en pantalla.
 */
create or replace function manager_adjust_time(
  p_work_session_id uuid,
  p_expected_updated_at timestamptz,
  p_new_starts_at timestamptz,
  p_new_ends_at timestamptz,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_before jsonb;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'La corrección necesita un motivo.' using errcode = 'check_violation';
  end if;

  select * into v_session from public.work_sessions where id = p_work_session_id;
  if v_session is null then
    raise exception 'Sesión inexistente.' using errcode = 'no_data_found';
  end if;

  if not public.app_manages_location(v_session.location_id) then
    raise exception 'No administras esta ubicación.' using errcode = 'insufficient_privilege';
  end if;

  -- Edición concurrente: si alguien más la cambió, se pide recargar en lugar de
  -- pisar su trabajo en silencio (§16).
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_session.updated_at)
         <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'Alguien más cambió este dato. Vuelve a cargarlo.'
      using errcode = 'serialization_failure';
  end if;

  v_before := jsonb_build_object(
    'startsAt', v_session.starts_at,
    'endsAt', v_session.ends_at,
    'netMinutes', v_session.net_minutes
  );

  update public.work_sessions
    set starts_at = coalesce(p_new_starts_at, starts_at),
        ends_at = coalesce(p_new_ends_at, ends_at),
        status = (case when coalesce(p_new_ends_at, ends_at) is null then 'open' else 'complete' end)::public.work_session_status
    where id = p_work_session_id;

  perform public.rebuild_work_session(p_work_session_id);

  insert into public.time_adjustments
    (organization_id, work_session_id, target_type, target_id,
     before_value, after_value, reason, created_by)
  select v_session.organization_id, p_work_session_id, 'work_session', p_work_session_id,
         v_before,
         jsonb_build_object('startsAt', s.starts_at, 'endsAt', s.ends_at,
                            'netMinutes', s.net_minutes),
         p_reason, auth.uid()
  from public.work_sessions s where s.id = p_work_session_id;

  insert into public.audit_logs
    (organization_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (v_session.organization_id, auth.uid(), 'time_adjusted', 'work_session',
          p_work_session_id, v_before,
          jsonb_build_object('startsAt', p_new_starts_at, 'endsAt', p_new_ends_at,
                             'reason', p_reason));
end;
$$;

create or replace function approve_timesheet_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period record;
begin
  select * into v_period from public.timesheet_periods where id = p_period_id;
  if v_period is null then
    raise exception 'Periodo inexistente.' using errcode = 'no_data_found';
  end if;

  if not public.app_role_in(v_period.organization_id,
                            array['owner', 'admin']::public.app_role[]) then
    raise exception 'Solo un propietario o administrador aprueba un periodo.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Un periodo con sesiones que necesitan revisión no se aprueba: aprobarlo sería
  -- declarar correctas horas que nadie revisó.
  if exists (
    select 1 from public.work_sessions s
    where s.organization_id = v_period.organization_id
      and s.status = 'needs_review'
      and s.starts_at::date between v_period.starts_on and v_period.ends_on
      and (v_period.location_id is null or s.location_id = v_period.location_id)
  ) then
    raise exception 'Hay sesiones que necesitan revisión en este periodo.'
      using errcode = 'check_violation';
  end if;

  update public.timesheet_periods
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_period_id;

  update public.work_sessions
    set status = 'approved'
    where organization_id = v_period.organization_id
      and status = 'complete'
      and starts_at::date between v_period.starts_on and v_period.ends_on
      and (v_period.location_id is null or location_id = v_period.location_id);

  insert into public.audit_logs
    (organization_id, actor_user_id, action, entity_type, entity_id)
  values (v_period.organization_id, auth.uid(), 'timesheet_period_approved',
          'timesheet_period', p_period_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Vistas de consulta
-- ---------------------------------------------------------------------------
-- `security_invoker` hace que la vista respete las políticas RLS del usuario que
-- consulta, en lugar de las del dueño de la vista. Sin esto, una vista sería un
-- agujero por el que ver datos de otra organización.

create or replace view employees_working_now
with (security_invoker = true)
as
select
  s.id as work_session_id,
  s.organization_id,
  s.location_id,
  s.employee_id,
  e.full_name,
  e.preferred_name,
  s.starts_at,
  s.shift_id,
  (select bi.starts_at from break_intervals bi
   where bi.work_session_id = s.id and bi.status = 'open' limit 1) as break_started_at,
  case
    when exists (select 1 from break_intervals bi
                 where bi.work_session_id = s.id and bi.status = 'open')
    then 'ON_BREAK' else 'WORKING'
  end as attendance_state
from work_sessions s
join employees e on e.id = s.employee_id
where s.status = 'open';

create or replace view daily_time_summary
with (security_invoker = true)
as
select
  s.organization_id,
  s.location_id,
  s.employee_id,
  (s.starts_at at time zone l.timezone)::date as work_date,
  count(*) as sessions,
  coalesce(sum(s.gross_minutes), 0) as gross_minutes,
  coalesce(sum(s.paid_break_minutes), 0) as paid_break_minutes,
  coalesce(sum(s.unpaid_break_minutes), 0) as unpaid_break_minutes,
  coalesce(sum(s.net_minutes), 0) as net_minutes,
  bool_or(s.status = 'needs_review') as needs_review,
  array_remove(array_agg(distinct f), null) as flags
from work_sessions s
join locations l on l.id = s.location_id
left join unnest(s.flags) as f on true
group by s.organization_id, s.location_id, s.employee_id,
         (s.starts_at at time zone l.timezone)::date;

/** Filas de exportación de la hoja de tiempo, filtradas por rol (§16). */
create or replace function export_timesheet_rows(
  p_location_id uuid,
  p_from date,
  p_to date
)
returns table (
  employee_name text,
  work_date date,
  clock_in timestamptz,
  clock_out timestamptz,
  gross_minutes integer,
  paid_break_minutes integer,
  unpaid_break_minutes integer,
  net_minutes integer,
  net_hours_decimal numeric,
  status text,
  flags text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.app_manages_location(p_location_id) then
    raise exception 'No administras esta ubicación.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    e.full_name,
    (s.starts_at at time zone l.timezone)::date,
    s.starts_at,
    s.ends_at,
    s.gross_minutes,
    s.paid_break_minutes,
    s.unpaid_break_minutes,
    s.net_minutes,
    -- Decimal correcto: 90 minutos son 1.50 horas, no 1.30 (§13).
    round(coalesce(s.net_minutes, 0)::numeric / 60, 2),
    s.status::text,
    s.flags
  from public.work_sessions s
  join public.employees e on e.id = s.employee_id
  join public.locations l on l.id = s.location_id
  where s.location_id = p_location_id
    and (s.starts_at at time zone l.timezone)::date between p_from and p_to
  order by e.full_name, s.starts_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de las funciones
-- ---------------------------------------------------------------------------
-- Por defecto Postgres da `execute` a `public`. Se revoca en todas y se concede
-- solo donde corresponde: las funciones del kiosco NO son invocables por un
-- usuario autenticado, únicamente por la Edge Function con `service_role`.

revoke all on function set_employee_pin(uuid, text) from public;
revoke all on function verify_employee_pin(uuid, text) from public;
revoke all on function activate_kiosk_device(text, text, text, text) from public;
revoke all on function authenticate_kiosk(text, text) from public;
revoke all on function submit_time_event(uuid, uuid, public.time_event_type, uuid, uuid,
  public.break_type, timestamptz, bigint, boolean, text, public.event_source) from public;
revoke all on function apply_event_to_projection(uuid) from public;
revoke all on function rebuild_work_session(uuid) from public;
revoke all on function create_kiosk_activation_code(uuid, integer) from public;
revoke all on function revoke_kiosk_device(uuid) from public;
revoke all on function manager_adjust_time(uuid, timestamptz, timestamptz, timestamptz, text) from public;
revoke all on function approve_timesheet_period(uuid) from public;
revoke all on function export_timesheet_rows(uuid, date, date) from public;
revoke all on function current_attendance_state(uuid) from public;

-- El administrador sí llama a estas desde la app, y cada una valida el rol dentro.
grant execute on function create_kiosk_activation_code(uuid, integer) to authenticated;
grant execute on function revoke_kiosk_device(uuid) to authenticated;
grant execute on function set_employee_pin(uuid, text) to authenticated;
grant execute on function manager_adjust_time(uuid, timestamptz, timestamptz, timestamptz, text) to authenticated;
grant execute on function approve_timesheet_period(uuid) to authenticated;
grant execute on function export_timesheet_rows(uuid, date, date) to authenticated;
grant execute on function current_attendance_state(uuid) to authenticated;
grant execute on function rebuild_work_session(uuid) to authenticated;

grant select on employees_working_now, daily_time_summary to authenticated;


-- ==========================================================================
-- MIGRACION: 20260827000400_guards.sql
-- ==========================================================================

-- Krealo Shift — reglas de integridad que no se pueden dejar solo a la interfaz
--
-- Estas son reglas de la especificación que RLS por sí solo no puede expresar,
-- porque no dependen de QUIÉN consulta sino de en qué estado queda la tabla
-- después de escribir.

-- ---------------------------------------------------------------------------
-- Una organización nunca se queda sin propietario (§7)
-- ---------------------------------------------------------------------------
-- El administrador tiene casi todos los permisos operativos del propietario,
-- pero no puede eliminar al último propietario ni transferir la propiedad. Si
-- esto viviera solo en la app, un `delete` desde cualquier cliente dejaría la
-- organización sin nadie que pueda administrarla, sin vuelta atrás.

create or replace function guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_remaining integer;
begin
  v_org := coalesce(old.organization_id, new.organization_id);

  -- Solo importa cuando la fila afectada era de un propietario activo y deja de
  -- serlo: por borrado, por cambio de rol o por suspensión.
  if old.role <> 'owner' or old.status <> 'active' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active' then
    return new;
  end if;

  select count(*) into v_remaining
  from public.organization_memberships m
  where m.organization_id = v_org
    and m.role = 'owner'
    and m.status = 'active'
    and m.id <> old.id;

  if v_remaining = 0 then
    raise exception
      'Una organización no puede quedarse sin propietario activo. Asigna otro propietario antes de cambiar este.'
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger organization_memberships_guard_owner_update
  before update on organization_memberships
  for each row execute function guard_last_owner();

create trigger organization_memberships_guard_owner_delete
  before delete on organization_memberships
  for each row execute function guard_last_owner();

-- ---------------------------------------------------------------------------
-- Solapamiento de turnos (§11.3)
-- ---------------------------------------------------------------------------
-- El editor advierte los solapamientos antes de publicar, pero la advertencia no
-- puede ser la única defensa: dos administradores editando la misma semana en
-- paralelo pueden crear un solapamiento que ninguna pantalla vio.
--
-- Se aplica solo a turnos publicados. Los borradores pueden solaparse mientras el
-- administrador reorganiza la semana; es al publicar cuando debe estar limpio.

create or replace function guard_shift_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_conflict record;
begin
  if new.status <> 'published' then
    return new;
  end if;

  select s.id, s.starts_at, s.ends_at into v_conflict
  from public.shifts s
  where s.employee_id = new.employee_id
    and s.id <> new.id
    and s.status = 'published'
    and tstzrange(s.starts_at, s.ends_at, '[)')
        && tstzrange(new.starts_at, new.ends_at, '[)')
  limit 1;

  if v_conflict is not null then
    raise exception
      'El turno se solapa con otro turno publicado del mismo empleado (% a %).',
      v_conflict.starts_at, v_conflict.ends_at
      using errcode = 'exclusion_violation';
  end if;

  return new;
end;
$$;

create trigger shifts_guard_overlap
  before insert or update on shifts
  for each row execute function guard_shift_overlap();

-- ---------------------------------------------------------------------------
-- Publicar un turno registra su versión (§11.3)
-- ---------------------------------------------------------------------------
-- Las tardanzas se miden contra el turno publicado vigente en el momento del
-- fichaje, así que la versión no puede quedar a criterio del cliente.

create or replace function stamp_shift_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published'
     and (old.status is distinct from 'published'
          or old.starts_at is distinct from new.starts_at
          or old.ends_at is distinct from new.ends_at) then
    new.published_at := now();
    new.publication_version := coalesce(old.publication_version, 0) + 1;
  end if;
  return new;
end;
$$;

create trigger shifts_stamp_publication
  before update on shifts
  for each row execute function stamp_shift_publication();

-- ---------------------------------------------------------------------------
-- Un turno publicado no se borra: se cancela (§11.3)
-- ---------------------------------------------------------------------------
-- Cambiar un horario nunca debe alterar por sí solo los fichajes que ya
-- ocurrieron. Si un turno publicado desapareciera, los eventos que lo referencian
-- perderían su contexto y las tardanzas ya calculadas dejarían de ser explicables.

create or replace function guard_published_shift_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'published' then
    raise exception
      'Un turno publicado no se elimina: cámbialo a cancelado para conservar el historial.'
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

create trigger shifts_guard_published_delete
  before delete on shifts
  for each row execute function guard_published_shift_delete();


-- ==========================================================================
-- MIGRACION: 20260827000500_kiosk_context.sql
-- ==========================================================================

-- Krealo Shift — contexto del kiosco tras validar un PIN (§9.2, §16)
--
-- La Edge Function `verify-pin` necesita devolver todo lo que la pantalla del
-- empleado muestra: nombre, estado, turnos elegibles y acciones permitidas. Si
-- eso se armara con cinco consultas desde la función, cada cambio de reglas
-- viviría en dos sitios y podrían desincronizarse.
--
-- Aquí se arma en una sola llamada, con las mismas reglas que ya aplica
-- `submit_time_event`. Devuelve SOLO lo necesario para operar: sin email, sin
-- teléfono, sin datos de otros empleados (§16 `refresh-kiosk-roster`).

create or replace function kiosk_employee_context(
  p_employee_id uuid,
  p_location_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emp record;
  v_settings jsonb;
  v_state text;
  v_session record;
  v_break record;
  v_shifts jsonb;
  v_allowed text[];
  v_earliest timestamptz;
  v_next_shift record;
begin
  select e.id, e.full_name, e.preferred_name, e.organization_id
  into v_emp
  from public.employees e
  where e.id = p_employee_id and e.status = 'active';

  if v_emp.id is null then
    return null;
  end if;

  select l.settings into v_settings from public.locations l where l.id = p_location_id;

  v_state := public.current_attendance_state(p_employee_id);

  -- Acciones permitidas, derivadas de la máquina de estados y no escritas a mano.
  v_allowed := array(
    select t::text
    from unnest(enum_range(null::public.time_event_type)) as t
    where public.attendance_transition_allowed(v_state, t)
  );

  -- Sesión abierta y descanso en curso, si hay.
  select s.starts_at, s.shift_id, s.paid_break_minutes, s.unpaid_break_minutes
  into v_session
  from public.work_sessions s
  where s.employee_id = p_employee_id and s.status = 'open'
  limit 1;

  if v_session.starts_at is not null then
    select bi.starts_at, bi.break_type into v_break
    from public.break_intervals bi
    join public.work_sessions s on s.id = bi.work_session_id
    where s.employee_id = p_employee_id and s.status = 'open' and bi.status = 'open'
    limit 1;
  end if;

  -- Turnos elegibles de hoy en ESTA tienda: publicados, no cancelados, y dentro
  -- de una ventana razonable alrededor de ahora. Un turno de la semana que viene
  -- no es elegible para fichar hoy.
  select coalesce(jsonb_agg(shift_row order by shift_row ->> 'startsAt'), '[]'::jsonb)
  into v_shifts
  from (
    select jsonb_build_object(
      'id', s.id,
      'startsAt', s.starts_at,
      'endsAt', s.ends_at,
      'jobRoleName', jr.name,
      'employeeNote', s.employee_note,
      'plannedUnpaidBreakMinutes', s.planned_unpaid_break_minutes,
      -- Se le muestra al empleado si su turno cambió desde la publicación
      -- anterior, que es justo lo que reclama cuando no se le avisa (§11.3).
      'changedSinceLastPublication', s.publication_version > 1
    ) as shift_row
    from public.shifts s
    left join public.job_roles jr on jr.id = s.job_role_id
    where s.employee_id = p_employee_id
      and s.location_id = p_location_id
      and s.status = 'published'
      and s.starts_at between now() - interval '12 hours' and now() + interval '12 hours'
  ) shifts;

  -- Hora más temprana a la que puede marcar entrada, para poder explicarle
  -- "podrás hacerlo a las 09:50" en lugar de un rechazo sin motivo (§9.3).
  select s.starts_at into v_next_shift
  from public.shifts s
  where s.employee_id = p_employee_id
    and s.location_id = p_location_id
    and s.status = 'published'
    and s.starts_at > now()
  order by s.starts_at
  limit 1;

  if v_next_shift.starts_at is not null then
    v_earliest := v_next_shift.starts_at
      - make_interval(mins => coalesce((v_settings ->> 'earlyClockInMinutes')::int, 10));
  end if;

  return jsonb_build_object(
    'employee', jsonb_build_object(
      -- Identificador opaco: no se expone el uuid interno del empleado al iPad.
      'opaqueId', encode(extensions.digest(p_employee_id::text, 'sha256'), 'hex'),
      'displayName', coalesce(nullif(btrim(v_emp.preferred_name), ''), v_emp.full_name),
      'initials', upper(
        substring(coalesce(nullif(btrim(v_emp.preferred_name), ''), v_emp.full_name) from 1 for 1)
        || coalesce(
             substring(split_part(v_emp.full_name, ' ', 2) from 1 for 1),
             ''
           )
      ),
      'jobRoleName', (
        select jr.name from public.employee_job_roles ejr
        join public.job_roles jr on jr.id = ejr.job_role_id
        where ejr.employee_id = p_employee_id
        order by ejr.is_primary desc
        limit 1
      ),
      -- Si esta persona puede administrar ESTA tienda. Es lo que habilita la
      -- excepcion de entrada temprana: el cliente no puede deducirlo por su
      -- cuenta, y dejarselo adivinar convertiria cualquier PIN en un PIN de
      -- gerente (§9.3, §13).
      'canManageLocation', exists (
        select 1 from public.employee_location_assignments a
        where a.employee_id = p_employee_id
          and a.location_id = p_location_id
          and a.can_manage
      )
    ),
    'attendanceState', v_state,
    'allowedActions', to_jsonb(v_allowed),
    'eligibleShifts', v_shifts,
    'openSession', case
      when v_session.starts_at is null then null
      else jsonb_build_object(
        'startedAt', v_session.starts_at,
        'shiftEndsAt', (
          select s.ends_at from public.shifts s where s.id = v_session.shift_id
        ),
        -- Minutos de descanso ya tomados en esta sesion. El kiosco los necesita
        -- para saber si al marcar salida falta el descanso obligatorio, y para
        -- no preguntar por un descanso que la persona si tomo (§12).
        'takenBreakMinutes',
          coalesce(v_session.paid_break_minutes, 0) + coalesce(v_session.unpaid_break_minutes, 0),
        'requiredBreakMinutes', coalesce((v_settings ->> 'requiredBreakMinutes')::int, 0),
        'openBreak', case
          when v_break.starts_at is null then null
          else jsonb_build_object('startedAt', v_break.starts_at,
                                  'breakType', v_break.break_type)
        end
      )
    end,
    'earliestClockInAt', v_earliest
  );
end;
$$;

revoke all on function kiosk_employee_context(uuid, uuid) from public;

-- `digest` viene de pgcrypto, que está en el esquema `extensions`.
-- Se comprueba aquí para que la migración falle temprano si falta, en lugar de
-- fallar en producción la primera vez que alguien ficha.
do $$
begin
  perform extensions.digest('prueba', 'sha256');
end
$$;


-- ==========================================================================
-- MIGRACION: 20260827000600_offline_pin.sql
-- ==========================================================================

-- Krealo Shift — validación del PIN sin conexión (especificación §8, §9.7)
--
-- ATENCIÓN: LA DECISIÓN QUE DESCRIBE ESTE ARCHIVO QUEDÓ SUPERADA.
-- La migración 20260827000700_offline_verifier_device_key.sql cambia
-- `kiosk_offline_verifiers` para que entregue el SALT y un VERIFICADOR ligado a
-- la clave del dispositivo, en vez del hash bcrypt. El motivo: el hash acababa en
-- el archivo SQLite del iPad, que se exfiltra mucho más fácil que el Keychain.
-- Este archivo se conserva porque las migraciones no se reescriben —crea la
-- columna `pin_offline_hash` y la tabla, que se siguen usando— pero el
-- razonamiento vigente está en la 700 y en SECURITY.md.
--
-- EL PROBLEMA
-- El kiosco debe poder validar un PIN sin red (§9.7), pero el servidor guarda el
-- PIN con bcrypt, o sea de forma irreversible: no puede derivar
-- `HMAC(clave_del_dispositivo, PIN)` sin conocer el PIN en claro. Había tres
-- salidas posibles, documentadas en supabase/functions/README.md.
--
-- LA DECISIÓN, Y POR QUÉ
-- Se elige la opción 3: el dispositivo recibe un hash bcrypt con su salt y
-- compara localmente el PIN que la persona teclea. Motivos:
--
--   * NO introduce almacenamiento reversible del PIN, que era el costo de la
--     opción 1 y el más grave de los tres.
--   * Funciona para cualquier iPad, incluido uno activado después de que los
--     empleados ya tenían PIN. La opción 2 dejaba esos iPad sin offline hasta
--     que cada empleado rotara su PIN, lo que en una tienda real significa
--     "nunca".
--
-- LO QUE CUESTA, DICHO CLARO
-- Quien extraiga el blob de SecureStore de un iPad —lo que exige acceso físico
-- y jailbreak— puede probar sin límite los 10⁶ PIN posibles contra ese hash. Con
-- bcrypt de coste 10 eso son unas 28 horas de un solo núcleo por empleado; días
-- con hardware realista, no minutos. Se mitiga con revocación del dispositivo,
-- que invalida su credencial de inmediato.
--
-- POR QUÉ COSTE 10 Y NO 12
-- El hash del servidor sigue en coste 12. El de offline usa 10 porque lo compara
-- bcryptjs en JavaScript sobre el dispositivo: con coste 12 son varios segundos
-- por intento, inaceptable con una cola de gente esperando para fichar. Coste 10
-- ronda las décimas de segundo. Es un hash distinto y de un solo propósito.

-- ---------------------------------------------------------------------------
-- Hash específico para offline
-- ---------------------------------------------------------------------------

alter table employee_pin_credentials
  add column if not exists pin_offline_hash text;

comment on column employee_pin_credentials.pin_offline_hash is
  'Hash bcrypt coste 10 del PIN, solo para validacion sin conexion en el kiosco. '
  'Se entrega al dispositivo activado y se compara localmente. Nunca se expone a '
  'un cliente autenticado normal.';

-- `set_employee_pin` pasa a generar los dos hashes a la vez: el del servidor y
-- el de offline. Así no hay forma de que queden desincronizados.
create or replace function set_employee_pin(p_employee_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_len smallint := length(p_pin);
begin
  if v_len < 4 or v_len > 6 or p_pin !~ '^[0-9]+$' then
    raise exception 'El PIN debe tener entre 4 y 6 dígitos numéricos.'
      using errcode = 'check_violation';
  end if;

  select organization_id into v_org from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception 'Empleado inexistente.' using errcode = 'no_data_found';
  end if;

  insert into public.employee_pin_credentials as c
    (employee_id, organization_id, pin_hash, pin_offline_hash, pin_length, version, rotated_at)
  values
    (p_employee_id, v_org,
     extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
     extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
     v_len, 1, now())
  on conflict (employee_id) do update
    set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
        pin_offline_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
        pin_length = v_len,
        version = c.version + 1,
        failed_attempts = 0,
        locked_until = null,
        rotated_at = now();
end;
$$;

revoke all on function set_employee_pin(uuid, text) from public;
grant execute on function set_employee_pin(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Entrega de verificadores a un dispositivo concreto
-- ---------------------------------------------------------------------------

/**
 * Verificadores offline para UN dispositivo activo.
 *
 * Solo devuelve empleados activos asignados a la ubicación de ese kiosco: el iPad
 * de Sede Principal nunca recibe los verificadores de Sucursal Demo.
 *
 * Un dispositivo revocado no recibe nada. Es lo que hace que revocar sirva de
 * algo: el iPad se queda sin poder validar PIN nuevos, online ni offline.
 *
 * El identificador que viaja es opaco, igual que en el resto del contrato del
 * kiosco: el uuid interno del empleado no sale de la base.
 */
create or replace function kiosk_offline_verifiers(p_device_id uuid)
returns table (
  employee_opaque_id text,
  pin_offline_hash text,
  pin_length smallint,
  pin_version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device record;
begin
  select d.id, d.location_id, d.organization_id, d.status
  into v_device
  from public.kiosk_devices d
  where d.id = p_device_id;

  if v_device.id is null or v_device.status <> 'active' then
    raise exception 'Este reloj fue desactivado.'
      using errcode = 'invalid_authorization_specification';
  end if;

  return query
  select
    encode(extensions.digest(e.id::text, 'sha256'), 'hex'),
    c.pin_offline_hash,
    c.pin_length,
    c.version
  from public.employee_pin_credentials c
  join public.employees e on e.id = c.employee_id
  join public.employee_location_assignments a on a.employee_id = e.id
  where a.location_id = v_device.location_id
    and e.status = 'active'
    and c.organization_id = v_device.organization_id
    and c.pin_offline_hash is not null;
end;
$$;

revoke all on function kiosk_offline_verifiers(uuid) from public;
-- Sin `grant`: solo la `service_role` de las Edge Functions puede llamarla. Un
-- usuario autenticado, ni siquiera el propietario, obtiene hashes de PIN.

-- ---------------------------------------------------------------------------
-- Aceptar eventos offline cuyo token de acción ya caducó
-- ---------------------------------------------------------------------------

/**
 * Registra un evento validado OFFLINE por el propio dispositivo.
 *
 * Existe porque el token de acción vive 90 segundos y un iPad puede pasar horas
 * sin red. Descartar esos eventos seria perder jornadas de trabajo reales.
 *
 * A cambio, el evento entra marcado: `is_offline`, la versión del PIN con la que
 * se validó, y una bandera `offline_pin_verified` para que el gerente sepa que la
 * autorización la hizo el dispositivo y no el servidor. Nunca se presenta como si
 * lo hubiera validado el servidor.
 */
create or replace function submit_offline_time_event(
  p_device_id uuid,
  p_employee_opaque_id text,
  p_event_type public.time_event_type,
  p_idempotency_key uuid,
  p_occurred_at_device timestamptz,
  p_device_sequence bigint,
  p_pin_version integer,
  p_shift_id uuid default null,
  p_break_type public.break_type default null,
  p_photo_path text default null
)
returns table (
  status text,
  event_id uuid,
  attendance_state text,
  flags text[],
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_employee_id uuid;
  v_current_version integer;
begin
  select d.id, d.location_id, d.organization_id, d.status
  into v_device
  from public.kiosk_devices d where d.id = p_device_id;

  if v_device.id is null or v_device.status <> 'active' then
    raise exception 'Este reloj fue desactivado.'
      using errcode = 'invalid_authorization_specification';
  end if;

  -- Se resuelve el identificador opaco de vuelta al empleado, restringido a la
  -- tienda de este kiosco.
  select e.id into v_employee_id
  from public.employees e
  join public.employee_location_assignments a on a.employee_id = e.id
  where a.location_id = v_device.location_id
    and e.organization_id = v_device.organization_id
    and encode(extensions.digest(e.id::text, 'sha256'), 'hex') = p_employee_opaque_id
  limit 1;

  if v_employee_id is null then
    raise exception 'El empleado no está asignado a la tienda de este reloj.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Si el PIN se rotó después de que el dispositivo guardara su verificador, el
  -- evento se acepta igual —el fichaje ocurrió— pero queda señalado.
  select c.version into v_current_version
  from public.employee_pin_credentials c where c.employee_id = v_employee_id;

  return query
  select * from public.submit_time_event(
    p_device_id => p_device_id,
    p_employee_id => v_employee_id,
    p_event_type => p_event_type,
    p_idempotency_key => p_idempotency_key,
    p_shift_id => p_shift_id,
    p_break_type => p_break_type,
    p_occurred_at_device => p_occurred_at_device,
    p_device_sequence => p_device_sequence,
    p_is_offline => true,
    p_photo_path => p_photo_path,
    p_source => 'kiosk'
  );

  if v_current_version is distinct from p_pin_version then
    insert into public.audit_logs
      (organization_id, actor_device_id, action, entity_type, entity_id, after_data)
    values
      (v_device.organization_id, p_device_id, 'offline_event_with_stale_pin_version',
       'employee', v_employee_id,
       jsonb_build_object('devicePinVersion', p_pin_version,
                          'currentPinVersion', v_current_version));
  end if;
end;
$$;

revoke all on function submit_offline_time_event(uuid, text, public.time_event_type, uuid,
  timestamptz, bigint, integer, uuid, public.break_type, text) from public;

-- Los eventos validados offline se distinguen en la metadata del evento, para que
-- el panel pueda mostrarlo y el gerente decida si revisa.
comment on column time_events.is_offline is
  'El evento se registro sin conexion: la hora es la del dispositivo y el PIN lo '
  'valido el propio kiosco con su verificador local, no el servidor.';


-- ==========================================================================
-- MIGRACION: 20260827000700_offline_verifier_device_key.sql
-- ==========================================================================

-- Krealo Shift — verificador offline ligado a la clave del dispositivo (§8)
--
-- QUÉ CAMBIA Y POR QUÉ
-- La versión anterior entregaba al iPad el hash bcrypt del PIN, que quedaba en su
-- SQLite. Eso tenía un agujero concreto: un archivo SQLite se exfiltra mucho más
-- fácil que el Keychain —un backup sin cifrar, un bug de compartición de
-- archivos— y con el hash en mano se prueban los 10⁶ PIN posibles sin límite.
--
-- Ahora el servidor NO manda el hash. Manda dos cosas:
--   * el `salt` de bcrypt, que por sí solo no permite verificar nada;
--   * un verificador derivado con una clave propia del dispositivo.
--
-- El iPad calcula `bcrypt(PIN_tecleado, salt)` y lo vuelve a derivar con su clave,
-- que vive en el Keychain de iOS. Robar el archivo SQLite deja de servir: sin la
-- clave, no se puede comprobar ni un intento.
--
-- Esto es lo que pide la especificación §8: "un verificador derivado y ligado al
-- dispositivo, emitido por servidor, con clave del dispositivo en SecureStore".
--
-- SOBRE LA CONSTRUCCIÓN DEL VERIFICADOR
-- Es un digest con clave —`sha256(clave || ':' || hash)`— y no un HMAC formal. El
-- motivo es práctico y se dice claro: `expo-crypto` solo expone digest sobre
-- cadenas UTF-8, así que un HMAC real (con su relleno de bloques sobre bytes
-- crudos) no se puede calcular igual en los dos lados sin agregar otra
-- dependencia de criptografía al dispositivo. La debilidad conocida de un digest
-- con clave frente a HMAC es la extensión de longitud, que aquí no aplica: no hay
-- ningún escenario en que un atacante quiera extender el mensaje, porque el
-- mensaje es un hash bcrypt de formato fijo y la comparación es de igualdad. Si
-- más adelante se agrega una librería con HMAC, cambiar las dos líneas de las dos
-- puntas es directo.
--
-- LO QUE SIGUE COSTANDO, DICHO SIN ADORNOS
-- Quien logre extraer TAMBIÉN la clave del Keychain —lo que exige acceso físico y
-- jailbreak, no solo un backup— vuelve al escenario anterior: fuerza bruta de
-- 10⁶ PIN a bcrypt coste 10, o sea horas por empleado. Revocar el dispositivo lo
-- corta de inmediato, porque un kiosco revocado deja de recibir verificadores.

-- ---------------------------------------------------------------------------
-- Clave de derivación por dispositivo
-- ---------------------------------------------------------------------------

alter table kiosk_devices
  add column if not exists offline_key text;

comment on column kiosk_devices.offline_key is
  'Clave aleatoria por dispositivo para derivar los verificadores offline del PIN. '
  'Se entrega al iPad una sola vez al activarse y alli vive en el Keychain. '
  'Guardarla aqui no agrega exposicion: quien tenga esta base ya tiene los hashes.';

-- Los dispositivos ya activados no tienen clave. Se les genera una: en su
-- siguiente refresco recibirán verificadores nuevos, y hasta entonces validan
-- online, que es el comportamiento que ya tenían.
update kiosk_devices
  set offline_key = encode(extensions.gen_random_bytes(32), 'hex')
  where offline_key is null;

-- ---------------------------------------------------------------------------
-- Activación: la clave se emite una sola vez
-- ---------------------------------------------------------------------------

-- `create or replace` no puede cambiar el tipo de fila que definen los parametros
-- OUT, y aqui se agrega `offline_key` al resultado. Hay que soltarla primero.
-- Es seguro: no tiene ningun `grant`, solo el `revoke all from public` que se
-- vuelve a aplicar abajo.
drop function if exists activate_kiosk_device(text, text, text, text);

create function activate_kiosk_device(
  p_code text,
  p_installation_id text,
  p_display_name text,
  p_app_version text
)
returns table (
  device_id uuid,
  device_public_id text,
  credential text,
  offline_key text,
  organization_id uuid,
  location_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_credential text;
  v_offline_key text;
  v_public_id text;
  v_device_id uuid;
begin
  select * into v_row
  from public.kiosk_activation_codes c
  where c.expires_at > now()
    and c.used_count < c.max_uses
    and c.code_hash = extensions.crypt(p_code, c.code_hash)
  limit 1;

  if v_row is null then
    raise exception 'Código de activación inválido o vencido.'
      using errcode = 'invalid_authorization_specification';
  end if;

  v_credential := encode(extensions.gen_random_bytes(32), 'hex');
  -- Clave SEPARADA de la credencial. Antes se reutilizaba la credencial como
  -- clave de derivación; separarlas significa que rotar una no invalida la otra,
  -- y que la credencial que viaja en cada petición no es la que protege los
  -- verificadores guardados.
  v_offline_key := encode(extensions.gen_random_bytes(32), 'hex');
  v_public_id := encode(extensions.gen_random_bytes(9), 'hex');

  insert into public.kiosk_devices
    (organization_id, location_id, display_name, device_public_id, credential_hash,
     offline_key, installation_id, app_version, last_seen_at, created_by)
  values
    (v_row.organization_id, v_row.location_id, coalesce(nullif(btrim(p_display_name), ''), 'iPad'),
     v_public_id, extensions.crypt(v_credential, extensions.gen_salt('bf', 10)),
     v_offline_key, p_installation_id, p_app_version, now(), v_row.created_by)
  returning id into v_device_id;

  update public.kiosk_activation_codes
    set used_count = used_count + 1
    where id = v_row.id;

  insert into public.audit_logs
    (organization_id, actor_device_id, action, entity_type, entity_id, after_data)
  values
    (v_row.organization_id, v_device_id, 'kiosk_activated', 'kiosk_device', v_device_id,
     jsonb_build_object('locationId', v_row.location_id, 'appVersion', p_app_version));

  return query select v_device_id, v_public_id, v_credential, v_offline_key,
                      v_row.organization_id, v_row.location_id;
end;
$$;

revoke all on function activate_kiosk_device(text, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- Verificadores: salt + valor derivado, nunca el hash
-- ---------------------------------------------------------------------------

/**
 * Verificadores offline para UN dispositivo activo.
 *
 * Devuelve el salt de bcrypt y el verificador derivado con la clave del
 * dispositivo. NO devuelve el hash: es la diferencia entre que robar el archivo
 * SQLite del iPad sirva de algo o no sirva de nada.
 *
 * Un dispositivo revocado no recibe nada, igual que antes.
 */
-- Mismo motivo que arriba: la tabla de retorno cambia de `pin_offline_hash` a
-- `pin_salt` + `pin_verifier`.
drop function if exists kiosk_offline_verifiers(uuid);

create function kiosk_offline_verifiers(p_device_id uuid)
returns table (
  employee_opaque_id text,
  pin_salt text,
  pin_verifier text,
  pin_length smallint,
  pin_version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device record;
begin
  select d.id, d.location_id, d.organization_id, d.status, d.offline_key
  into v_device
  from public.kiosk_devices d
  where d.id = p_device_id;

  if v_device.id is null or v_device.status <> 'active' then
    raise exception 'Este reloj fue desactivado.'
      using errcode = 'invalid_authorization_specification';
  end if;

  if v_device.offline_key is null then
    raise exception 'Este reloj no tiene clave de derivación. Vuelve a activarlo.'
      using errcode = 'invalid_authorization_specification';
  end if;

  return query
  select
    encode(extensions.digest(e.id::text, 'sha256'), 'hex'),
    -- El salt de bcrypt son los primeros 29 caracteres del hash: $2a$10$ + 22 de
    -- salt. Por si solo no permite verificar nada.
    substring(c.pin_offline_hash from 1 for 29),
    -- Digest con clave del dispositivo. Las dos puntas calculan exactamente esto:
    -- sha256(clave || ':' || hash_bcrypt_completo).
    encode(
      extensions.digest(v_device.offline_key || ':' || c.pin_offline_hash, 'sha256'),
      'hex'
    ),
    c.pin_length,
    c.version
  from public.employee_pin_credentials c
  join public.employees e on e.id = c.employee_id
  join public.employee_location_assignments a on a.employee_id = e.id
  where a.location_id = v_device.location_id
    and e.status = 'active'
    and c.organization_id = v_device.organization_id
    and c.pin_offline_hash is not null;
end;
$$;

revoke all on function kiosk_offline_verifiers(uuid) from public;
-- Sin `grant`: solo la `service_role` de las Edge Functions la llama.


-- ==========================================================================
-- MIGRACION: 20260827000800_attendance_photos.sql
-- ==========================================================================

-- Krealo Shift — almacenamiento de las fotos de fichaje (§9.6, §22)
--
-- QUÉ FALTABA
-- El esquema ya tenía `time_events.photo_path` y las políticas para leerlo, pero
-- no existía el bucket donde guardar la imagen, ni reglas de acceso a los
-- archivos, ni purga por retención. O sea: la columna apuntaba a un sitio que no
-- existía. Activar `photoEnabled` en una tienda real habría fallado al subir.
--
-- LAS DECISIONES, Y POR QUÉ
--
-- 1. BUCKET PRIVADO, SIN EXCEPCIÓN. Es una foto del rostro de una persona
--    trabajando. Un bucket público serviría esas imágenes a cualquiera con la URL,
--    y las URL de Storage son adivinables si se conoce el patrón. Se lee siempre
--    con URL firmada de vida corta.
--
-- 2. LA RUTA LLEVA LA ORGANIZACIÓN AL PRINCIPIO:
--       {organization_id}/{location_id}/{yyyy}/{mm}/{event_id}.jpg
--    Así el aislamiento entre empresas se puede comprobar con un prefijo, que es
--    lo único que las políticas de `storage.objects` saben mirar sin consultar
--    otra tabla. Sin eso, cada política tendría que resolver el evento para saber
--    de quién es el archivo.
--
-- 3. NADIE ESCRIBE DIRECTO. El iPad no tiene sesión de usuario, solo su credencial
--    de kiosco, así que no puede subir con la anon key. Sube con una URL firmada
--    que emite una Edge Function tras autenticarlo. Por eso aquí NO hay política
--    de insert para `anon` ni `authenticated`: la escritura pasa por
--    `service_role`, que no las evalúa.
--
-- 4. SE PUEDE MIRAR, NO SE PUEDE CAMBIAR NI BORRAR A MANO. Un gerente de la
--    ubicación lee; nadie actualiza. El borrado lo hace solo la purga por
--    retención, que corre como `service_role`. Una foto que un gerente pueda
--    borrar cuando le convenga no sirve como evidencia de nada.
--
-- LÍMITE CONOCIDO: `storage.buckets` y `storage.objects` los crea la extensión de
-- Storage de Supabase, que no existe en un Postgres pelado. Todo lo que toca esas
-- tablas va condicionado a que existan, para que esta migración se aplique igual
-- en el entorno de pruebas local. Lo que sí se puede probar sin Storage —la
-- función de purga y la de rutas— no está condicionado.

-- ---------------------------------------------------------------------------
-- Excepción append-only, del tamaño exacto de la purga y ni un milímetro más
-- ---------------------------------------------------------------------------
--
-- `time_events` es append-only con un disparador que rechaza TODO update, y eso
-- incluye poner `photo_path` a null. O sea: sin esta excepción, la purga por
-- retención no puede correr, y la app se queda guardando fotos de personas para
-- siempre. Es un conflicto real entre dos reglas correctas.
--
-- Se resuelve permitiendo que cambie UNA columna, `photo_path`, y ninguna otra.
-- Cualquier otra diferencia —una hora, un tipo de evento, un empleado— se sigue
-- rechazando, igual que antes.
--
-- POR QUÉ `photo_path` Y NO OTRA: no es un dato del fichaje, es un puntero a un
-- archivo cuyo ciclo de vida es inherentemente mutable. La imagen se sube después
-- del evento (la subida puede tardar o reintentarse, y con red mala eso es lo
-- normal) y se borra antes que el evento (retención). Las horas trabajadas, que
-- son lo que la regla append-only protege, no se tocan.
--
-- Se permite en las DOS direcciones a propósito. Solo hacia null bastaría para la
-- purga, pero entonces la foto tendría que escribirse al crear el evento, o sea
-- ANTES de que exista el archivo, y `photo_path` apuntaría a un objeto inexistente
-- cada vez que una subida fallara. Permitir null → ruta deja poner el puntero
-- solo cuando el archivo ya está arriba, que es la única forma de que la columna
-- no mienta.
--
-- Quién puede hacerlo sigue siendo estrecho: la ruta la deriva el servidor con
-- `attendance_photo_path`, y la escritura pasa por una Edge Function con
-- `service_role`. Ninguna sesión de la app actualiza `time_events`.
--
-- La comparación se hace convirtiendo las dos filas a jsonb y anulando
-- `photo_path` en ambas. Es a propósito: así una columna que se agregue mañana a
-- `time_events` queda protegida sin que nadie tenga que acordarse de añadirla a
-- una lista.

create or replace function reject_time_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'La tabla % es append-only: usa un ajuste auditable en lugar de borrar el evento original.',
      tg_table_name
      using errcode = 'restrict_violation';
  end if;

  -- El único update permitido: mover el puntero de la foto, en cualquier
  -- dirección, sin tocar nada más.
  if (to_jsonb(old) - 'photo_path') = (to_jsonb(new) - 'photo_path') then
    return new;
  end if;

  raise exception
    'La tabla % es append-only: solo se puede cambiar la ruta de la foto.',
    tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists time_events_no_update on time_events;
create trigger time_events_no_update
  before update on time_events
  for each row execute function reject_time_event_mutation();

-- El disparador de borrado sigue igual de cerrado; se reapunta a la misma función
-- para que los dos mensajes salgan del mismo sitio.
drop trigger if exists time_events_no_delete on time_events;
create trigger time_events_no_delete
  before delete on time_events
  for each row execute function reject_time_event_mutation();

-- ---------------------------------------------------------------------------
-- Ruta del archivo: una sola definición, usada por servidor y por la app
-- ---------------------------------------------------------------------------

/**
 * Construye la ruta de la foto de un evento.
 *
 * Existe como función y no como cadena armada en tres sitios porque la ruta es un
 * contrato: las políticas de Storage dependen de que el primer segmento sea la
 * organización. Si un día cambia, cambia aquí y las políticas siguen valiendo.
 */
create or replace function attendance_photo_path(p_event_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.organization_id::text || '/' ||
         e.location_id::text || '/' ||
         to_char(e.occurred_at, 'YYYY') || '/' ||
         to_char(e.occurred_at, 'MM') || '/' ||
         e.id::text || '.jpg'
  from public.time_events e
  where e.id = p_event_id;
$$;

revoke all on function attendance_photo_path(uuid) from public;
grant execute on function attendance_photo_path(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Purga por retención (§22)
-- ---------------------------------------------------------------------------

/**
 * Borra las fotos que pasaron el plazo de retención de SU ubicación.
 *
 * Cada ubicación tiene su propio `photoRetentionDays`, así que el plazo se lee por
 * ubicación y no como una constante global: una tienda puede guardar 15 días y
 * otra 30.
 *
 * Devuelve cuántas borró. No es un detalle cosmético: un trabajo programado que
 * siempre devuelve 0 es indistinguible de uno que no corre, y así se puede
 * vigilar.
 *
 * DOS PASOS, EN ESTE ORDEN: primero se borra el archivo, después se limpia la
 * columna. Al revés quedarían archivos huérfanos que nada volvería a mirar —o sea
 * fotos de personas guardadas para siempre sin que nadie sepa que están ahí—.
 * Si el borrado del archivo falla, `photo_path` sigue puesto y el siguiente pase
 * lo reintenta.
 *
 * El evento en sí NO se toca: `time_events` es append-only y las horas trabajadas
 * no caducan. Lo que caduca es la imagen.
 */
create or replace function purge_expired_attendance_photos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_deleted integer := 0;
  v_has_storage boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) into v_has_storage;

  for v_row in
    select e.id, e.photo_path
    from public.time_events e
    join public.locations l on l.id = e.location_id
    where e.photo_path is not null
      and e.occurred_at < now() - make_interval(
        days => coalesce((l.settings ->> 'photoRetentionDays')::int, 30))
  loop
    if v_has_storage then
      execute 'delete from storage.objects where bucket_id = $1 and name = $2'
        using 'attendance-photos', v_row.photo_path;
    end if;

    -- `photo_path` es la única columna de `time_events` que se puede modificar
    -- después de creada, y el disparador append-only lo permite justamente por
    -- esto. Ver la excepción en `reject_mutation()`.
    update public.time_events set photo_path = null where id = v_row.id;
    v_deleted := v_deleted + 1;
  end loop;

  if v_deleted > 0 then
    insert into public.audit_logs
      (organization_id, action, entity_type, after_data)
    select distinct e.organization_id, 'photos_purged', 'time_event',
           jsonb_build_object('deleted', v_deleted)
    from public.time_events e
    limit 1;
  end if;

  return v_deleted;
end;
$$;

revoke all on function purge_expired_attendance_photos() from public;
-- Sin `grant`: la ejecuta un trabajo programado con la `service_role`.

-- ---------------------------------------------------------------------------
-- Bucket y políticas — solo si la extensión de Storage está presente
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'Storage de Supabase no presente: se omiten el bucket y sus politicas. '
      'Normal en el Postgres local de pruebas; en la nube se aplican.';
    return;
  end if;

  -- `public => false` es lo que importa de esta línea. El límite de tamaño evita
  -- que un fallo de la app llene el bucket con una imagen sin comprimir.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('attendance-photos', 'attendance-photos', false, 2097152,
          array['image/jpeg', 'image/webp'])
  on conflict (id) do update
    set public = false,
        file_size_limit = 2097152,
        allowed_mime_types = array['image/jpeg', 'image/webp'];

  -- LECTURA: solo quien administra la ubicación del primer y segundo segmento de
  -- la ruta. `storage.foldername(name)` devuelve los segmentos; el 1 es la
  -- organización y el 2 la ubicación.
  drop policy if exists "attendance photos legibles por gerentes" on storage.objects;
  create policy "attendance photos legibles por gerentes"
    on storage.objects for select
    to authenticated
    using (
      bucket_id = 'attendance-photos'
      and public.app_manages_location(((storage.foldername(name))[2])::uuid)
    );

  -- Sin políticas de insert, update ni delete a propósito. Subir pasa por una URL
  -- firmada que emite una Edge Function; borrar, solo la purga por retención.
  -- Las dos corren con `service_role`, que no evalúa políticas.
  drop policy if exists "attendance photos sin escritura directa" on storage.objects;
end
$$;


-- ==========================================================================
-- MIGRACION: 20260827000900_scheduled_jobs.sql
-- ==========================================================================

-- Krealo Shift — trabajos recurrentes (§22)
--
-- QUÉ FALTABA
-- `purge_expired_attendance_photos()` estaba escrita y probada, pero nada la
-- llamaba. Una purga que nadie ejecuta es exactamente igual que no tener purga:
-- las fotos del personal se quedan para siempre.
--
-- POR QUÉ ESTO ES UNA MIGRACIÓN Y NO UNA NOTA EN EL README
-- Porque una nota en el README se olvida en el despliegue, y lo que se olvida aquí
-- son fotos de las caras de las personas guardadas indefinidamente. Si `pg_cron`
-- está disponible, esta migración lo programa sola.
--
-- SI `pg_cron` NO ESTÁ (no todos los planes de Supabase lo traen), la migración no
-- falla: avisa y deja escrito qué hay que hacer a mano. Que se aplique igual
-- importa, porque si no, ninguna migración posterior corre.

do $$
declare
  v_has_cron boolean;
begin
  select exists (
    select 1 from pg_available_extensions where name = 'pg_cron'
  ) into v_has_cron;

  if not v_has_cron then
    raise notice
      'pg_cron no disponible: la purga de fotos NO queda programada. '
      'Hay que llamar a purge_expired_attendance_photos() a diario desde fuera '
      '(un Scheduled Function de Supabase, o cron propio con la service_role). '
      'Sin eso las fotos del personal se guardan indefinidamente.';
    return;
  end if;

  create extension if not exists pg_cron;

  -- Se borra antes de crear para que aplicar la migración dos veces no deje dos
  -- trabajos haciendo lo mismo.
  perform cron.unschedule('krealo-shift-purgar-fotos')
    where exists (
      select 1 from cron.job where jobname = 'krealo-shift-purgar-fotos'
    );

  -- A las 03:15 UTC, o sea las 22:15 en Lima: fuera del horario de cualquier
  -- tienda. Borrar archivos mientras alguien ficha no rompe nada, pero no hay
  -- ninguna razón para hacerlo en hora punta.
  --
  -- Diario y no cada hora: el plazo se mide en días, así que correr más seguido
  -- solo gasta. Y si un día falla, al siguiente recoge lo que quedó, porque la
  -- función busca por fecha y no lleva marcador de progreso.
  perform cron.schedule(
    'krealo-shift-purgar-fotos',
    '15 3 * * *',
    $job$ select public.purge_expired_attendance_photos(); $job$
  );

  raise notice 'Purga de fotos programada a diario (03:15 UTC).';
end
$$;


-- ==========================================================================
-- MIGRACION: 20260827001000_kiosk_devices_admin.sql
-- ==========================================================================

-- Krealo Shift — inventario de kioscos para el administrador (§11.6)
--
-- QUÉ FALTABA
-- `20260827000200_rls.sql` revoca todo acceso a `kiosk_devices` para `anon` y
-- `authenticated`, y su propio comentario decía que el inventario se resolvería
-- "con la vista `kiosk_devices_admin` de la migración de funciones". Esa vista
-- nunca se escribió. Resultado: el administrador podía GENERAR un código de
-- activación pero no ver la lista de kioscos, así que **no podía revocar
-- ninguno**. La pantalla de configuración mostraba un "permiso denegado" honesto
-- y el botón de revocar era inalcanzable.
--
-- Poder revocar importa más de lo que parece: es el corte de emergencia cuando un
-- iPad se pierde o se lo llevan. Y ahora también corta la validación de PIN sin
-- conexión, porque un dispositivo revocado deja de recibir verificadores.
--
-- POR QUÉ UNA VISTA Y NO LEVANTAR EL REVOKE
-- Porque `kiosk_devices` tiene dos columnas que nadie con una sesión de la app
-- debe leer nunca:
--   * `credential_hash`, el hash bcrypt de la credencial del dispositivo;
--   * `offline_key`, la clave con la que se derivan los verificadores del PIN.
-- Con `offline_key` en la mano, más el archivo SQLite de un iPad, se pueden
-- probar los 10⁶ PIN posibles. La vista no las incluye, y así el revoke de la
-- tabla sigue en pie: no hay ninguna consulta desde la app que pueda alcanzarlas.

-- OJO CON ESTA VISTA: NO lleva `security_invoker`, a diferencia de las otras del
-- proyecto, y es deliberado.
--
-- `kiosk_devices` tiene RLS activada y CERO políticas, más un `revoke all` para
-- `anon` y `authenticated`. Con `security_invoker = true` la vista se evaluaría con
-- los permisos de quien consulta y devolvería "permission denied" siempre: sería
-- una vista que no se puede leer. Al no ponerlo, se evalúa con los permisos de su
-- dueño, que sí puede leer la tabla.
--
-- CONSECUENCIA QUE HAY QUE TENER PRESENTE: eso salta la RLS de la tabla base, así
-- que el `where` de abajo NO es un filtro de conveniencia, es la única barrera de
-- autorización de esta vista. Si alguien lo quita o lo debilita, el inventario de
-- kioscos de todas las empresas queda legible por cualquier sesión. Hay pruebas
-- que lo fijan desde las dos puntas: la gerenta ve los suyos, la dueña de otra
-- empresa ve cero.
--
-- `app_manages_location` es `security definer` y resuelve contra `auth.uid()`, o
-- sea el usuario que llama, no el dueño de la vista. Por eso el filtro sigue
-- siendo correcto por persona.
create or replace view kiosk_devices_admin as
select
  d.id,
  d.organization_id,
  d.location_id,
  l.name as location_name,
  d.display_name,
  d.device_public_id,
  d.status,
  d.app_version,
  d.last_seen_at,
  d.last_sync_at,
  d.created_at,
  d.revoked_at,
  -- Cuánto lleva sin sincronizar, para el aviso de "kiosco sin sincronizar" de
  -- §19. Se calcula aquí y no en el cliente para que la respuesta sea la misma
  -- desde el panel y desde el trabajo de notificaciones.
  case
    when d.last_sync_at is null then null
    else extract(epoch from (now() - d.last_sync_at))::bigint / 60
  end as minutes_since_sync
from kiosk_devices d
join locations l on l.id = d.location_id
-- LA BARRERA. Ver la nota de arriba: no hay RLS detrás de esto.
where app_manages_location(d.location_id);

comment on view kiosk_devices_admin is
  'Inventario de kioscos para el panel (§11.6). Excluye credential_hash y '
  'offline_key: son los dos secretos del dispositivo y ninguna sesion de la app '
  'debe poder leerlos. El where de app_manages_location es la UNICA barrera de '
  'autorizacion: la vista corre con los permisos de su dueño y salta la RLS de la '
  'tabla base, que no tiene politicas.';

-- La tabla sigue revocada; solo se abre la vista.
grant select on kiosk_devices_admin to authenticated;


-- ==========================================================================
-- MIGRACION: 20260827001100_manager_alerts.sql
-- ==========================================================================

-- Krealo Shift — alertas del gerente (§19)
--
-- QUÉ FALTABA
-- `push_tokens` y `notification_preferences` existían desde la primera migración y
-- el panel ya escribía las ocho preferencias, pero nada calculaba una alerta y
-- nada las enviaba. Ocho interruptores que no encendían nada.
--
-- QUÉ HACE ESTE ARCHIVO
--   1. `pending_manager_alerts()` — qué hechos merecen aviso AHORA, por
--      destinatario, ya filtrados por rol y por preferencia.
--   2. `manager_alert_deliveries` — la tabla de deduplicación. Es la pieza más
--      importante del diseño; la justificación larga está sobre la tabla.
--   3. `claim_manager_alerts()` — reserva y devuelve SOLO lo que no se avisó
--      todavía, en una sola sentencia. La Edge Function `send-manager-alerts`
--      envía lo que esta función le entrega.
--   4. `kiosk_rejected_attempts` + `record_kiosk_rejection()` — el hecho
--      "intento de fichaje desde un kiosco revocado o incorrecto" no existía en
--      ninguna tabla, así que no había nada que avisar. Ver la nota de esa tabla.
--
-- LO QUE NUNCA SALE DE AQUÍ
-- Ninguna función de este archivo devuelve el nombre, el número de empleado, el
-- correo, el teléfono ni la ruta de la foto de una persona. El razonamiento está
-- entero sobre `pending_manager_alerts`.

-- ---------------------------------------------------------------------------
-- Ajuste nuevo: cuánto puede pasar un reloj sin sincronizar
-- ---------------------------------------------------------------------------
-- §19 pide avisar de un "kiosco sin sincronizar durante un periodo
-- configurable". No existía ese ajuste, así que se define aquí.
--
-- POR QUÉ 120 MINUTOS
-- Es el único valor de este archivo elegido a mano, así que conviene decir por
-- qué. Con 15 o 30 minutos el aviso salta con cualquier corte de wifi de una
-- tienda, y un aviso que salta por ruido es un aviso que el gerente silencia. Con
-- 8 o 12 horas el iPad puede pasar un turno entero desconectado y el gerente lo
-- descubre al día siguiente, cuando ya hay horas sin registrar. Dos horas es
-- suficiente para que un corte normal se cure solo y sigue avisando dentro del
-- mismo turno.
--
-- Es por ubicación, no global: una tienda con internet malo puede subirlo sin
-- obligar a las demás a aguantar el mismo ruido.
alter table locations alter column settings set default jsonb_build_object(
  'pinLength', 6,
  'photoEnabled', false,
  'photoRetentionDays', 30,
  'earlyClockInMinutes', 10,
  'lateGraceMinutes', 5,
  'allowUnscheduledShifts', true,
  'timeFormat', '24h',
  'requiredBreakMinutes', 0,
  'dailyOvertimeThresholdMinutes', 480,
  'weeklyOvertimeThresholdMinutes', 2880,
  'kioskSyncStaleMinutes', 120
);

-- Las ubicaciones que ya existen no tienen la clave. Las funciones de abajo usan
-- `coalesce` de todas formas —una fila con `settings` incompleto no debe romper el
-- cálculo— pero se rellena igual para que el panel muestre el valor real y no un
-- campo vacío que al guardar parecería un cambio.
update locations
  set settings = jsonb_set(settings, '{kioskSyncStaleMinutes}', '120'::jsonb)
  where not (settings ? 'kioskSyncStaleMinutes');

-- ---------------------------------------------------------------------------
-- Índice que faltaba en `push_tokens`
-- ---------------------------------------------------------------------------
-- La tabla solo tenía la clave primaria y el único de `expo_token`, porque hasta
-- ahora nadie la consultaba. Las dos consultas que introduce este archivo la leen
-- por usuario: `pending_manager_alerts` pregunta "¿tiene algún dispositivo
-- activo?" una vez por destinatario y por ubicación, y el envío lee los tokens de
-- todos los destinatarios de la ronda.
create index if not exists push_tokens_user_active_idx
  on push_tokens (user_id) where is_active;

-- ---------------------------------------------------------------------------
-- ¿Quién administra esta ubicación? Ahora también sin sesión
-- ---------------------------------------------------------------------------
-- `app_manages_location(location)` resuelve contra `auth.uid()`, y eso es lo
-- correcto para RLS. Pero el trabajo de alertas corre con `service_role` desde un
-- cron: no hay `auth.uid()`, y la pregunta que hay que hacer es "¿ESTA persona
-- administra esta ubicación?", con la persona como parámetro.
--
-- Se extrae la regla a una función con el usuario explícito y `app_manages_location`
-- pasa a ser una envoltura de una línea. Es a propósito: dos copias de la regla de
-- autorización se separan con el primer cambio que alguien haga en una sola, y esa
-- regla es la que impide que la gerenta de Sede Principal lea Sucursal Demo.
create or replace function app_user_manages_location(p_user_id uuid, p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.locations l
    join public.organization_memberships m
      on m.organization_id = l.organization_id
     and m.user_id = p_user_id
     and m.status = 'active'
    where l.id = p_location_id
      and (
        m.role in ('owner', 'admin')
        or (
          m.role = 'manager'
          and exists (
            select 1
            from public.employee_location_assignments a
            join public.employees e on e.id = a.employee_id
            where a.location_id = l.id
              and a.can_manage
              and e.user_id = p_user_id
          )
        )
      )
  );
$$;

-- Misma firma y mismo comportamiento que antes: las políticas RLS y la vista
-- `kiosk_devices_admin` que dependen de ella siguen funcionando sin cambios.
create or replace function app_manages_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_user_manages_location(auth.uid(), p_location_id);
$$;

-- OJO CON LOS PERMISOS DE FUNCIÓN EN SUPABASE, aquí y en todo lo que sigue.
--
-- Supabase deja puesto `alter default privileges ... grant all on functions to
-- postgres, anon, authenticated, service_role` sobre el esquema `public`. O sea que
-- CADA función nueva nace con `execute` concedido explícitamente a esos cuatro
-- roles, y un `revoke ... from public` NO se los quita: revoca el permiso de
-- PUBLIC, que es otra cosa.
--
-- Por eso este archivo revoca a `anon` y `authenticated` por su nombre y concede a
-- `service_role` donde hace falta, en vez de confiar en `from public`. En el
-- Postgres local de pruebas da lo mismo —no hay `default privileges`, así que
-- `public` sí es la vía— y precisamente por eso el error no se vería en las
-- pruebas.
revoke all on function app_user_manages_location(uuid, uuid) from public, anon;
grant execute on function app_user_manages_location(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Inicio de semana según la organización
-- ---------------------------------------------------------------------------
-- `date_trunc('week', ...)` siempre corta en lunes. `organizations.week_starts_on`
-- existe justamente porque no toda empresa empieza el lunes, y el umbral SEMANAL
-- de horas extra se mide sobre esa semana, no sobre la de Postgres.
create or replace function week_start_for(p_date date, p_week_starts_on smallint)
returns date
language sql
immutable
set search_path = ''
as $$
  -- `isodow` es 1..7 con lunes = 1; `week_starts_on` es 0..6 con domingo = 0.
  -- Se normalizan al mismo eje antes de restar.
  select p_date - (
    (extract(isodow from p_date)::int
      - (case when p_week_starts_on = 0 then 7 else p_week_starts_on::int end)
      + 7) % 7
  );
$$;

revoke all on function week_start_for(date, smallint) from public, anon;
grant execute on function week_start_for(date, smallint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Intentos de fichaje rechazados
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTA TABLA EXISTE
-- §19 pide avisar al gerente de un "intento de fichaje desde un kiosco revocado o
-- incorrecto". Ese hecho no quedaba registrado en ningún sitio: `authenticate_kiosk`
-- y `submit_time_event` levantan una excepción, y una excepción aborta la
-- transacción, así que un `insert` en la misma función se desharía con ella.
-- Postgres no tiene transacciones autónomas.
--
-- Por eso lo registra la Edge Function, DESPUÉS de recibir el fallo, en una
-- petición nueva: `_shared/kiosk-auth.ts` para el dispositivo revocado o
-- desconocido, y `submit-time-event` para el empleado que no pertenece a la tienda
-- de ese iPad.
--
-- LÍMITE CONOCIDO: si el `device_public_id` no existe en la base, no hay ninguna
-- organización a la que atribuir el intento y no se registra nada. Es coherente
-- —no hay gerente a quien avisar— pero significa que un escaneo con
-- identificadores inventados no deja rastro aquí. Eso pertenece a un límite de
-- peticiones en el borde, no a esta tabla.
create table kiosk_rejected_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  device_id uuid not null references kiosk_devices (id) on delete cascade,
  -- 'revoked' = el iPad está desactivado o su credencial no vale.
  -- 'wrong_location' = el iPad es válido pero el empleado no trabaja en su tienda.
  reason text not null check (reason in ('revoked', 'wrong_location')),
  employee_id uuid references employees (id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index kiosk_rejected_attempts_recent_idx
  on kiosk_rejected_attempts (location_id, occurred_at desc);

alter table kiosk_rejected_attempts enable row level security;
-- Sin políticas: nadie con una sesión de la app lee esta tabla directamente. El
-- gerente se entera por la notificación y por el inventario de kioscos.
revoke all on kiosk_rejected_attempts from anon, authenticated;

comment on table kiosk_rejected_attempts is
  'Intentos de fichaje rechazados por dispositivo revocado o por tienda '
  'equivocada (§19). Lo escribe la Edge Function tras recibir el fallo, porque '
  'una excepcion en la funcion SQL desharia el insert con la transaccion.';

/**
 * Registra un intento rechazado. La llama la Edge Function con `service_role`.
 *
 * Colapsa las repeticiones: un iPad revocado que se quedó encendido reintenta en
 * bucle, y sin esto la tabla crecería sin aportar información nueva. Un minuto es
 * suficiente para que el aviso salga y para no guardar mil filas idénticas.
 *
 * Devuelve el id de la fila, o `null` si el dispositivo no existe o si el intento
 * se colapsó contra uno reciente.
 */
create or replace function record_kiosk_rejection(
  p_device_public_id text,
  p_reason text,
  p_employee_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_id uuid;
begin
  if p_reason not in ('revoked', 'wrong_location') then
    raise exception 'Motivo de rechazo desconocido: %', p_reason
      using errcode = 'check_violation';
  end if;

  -- Se busca también entre los revocados: son justamente los que interesan.
  select d.id, d.organization_id, d.location_id into v_device
  from public.kiosk_devices d
  where d.device_public_id = p_device_public_id;

  if v_device is null then
    return null;
  end if;

  if exists (
    select 1 from public.kiosk_rejected_attempts a
    where a.device_id = v_device.id
      and a.reason = p_reason
      and a.occurred_at > now() - interval '1 minute'
  ) then
    return null;
  end if;

  insert into public.kiosk_rejected_attempts
    (organization_id, location_id, device_id, reason, employee_id)
  values
    (v_device.organization_id, v_device.location_id, v_device.id, p_reason, p_employee_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- Solo `service_role`. Con acceso desde la app, cualquiera con sesión podría
-- inventar intentos rechazados y provocar avisos falsos a un gerente.
revoke all on function record_kiosk_rejection(text, text, uuid) from public, anon, authenticated;
grant execute on function record_kiosk_rejection(text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- LA TABLA DE DEDUPLICACIÓN
-- ---------------------------------------------------------------------------
-- POR QUÉ ES LA PIEZA MÁS IMPORTANTE
-- El trabajo corre cada 15 minutos y las alertas se derivan del estado actual, no
-- de un evento. Sin esta tabla, la misma tardanza de las 09:06 se avisaría a las
-- 09:15, 09:30, 09:45 y así hasta que el turno acabe: 30 notificaciones por una
-- persona que llegó tarde. El gerente apaga las notificaciones el primer día y
-- entonces el sistema entero deja de servir. La deduplicación no es una
-- optimización: es lo que hace utilizable la función.
--
-- LA CLAVE, Y POR QUÉ ES ESA
--   (recipient_user_id, alert_type, subject_id, occurrence_key)
--
--   * `recipient_user_id` va en la clave y no fuera. Dos personas pueden
--     administrar la misma tienda y las dos tienen que enterarse. Si la clave
--     fuera del hecho y no del par hecho+persona, el primer envío se tragaría el
--     aviso de todos los demás. Efecto secundario deseado: a un gerente nuevo le
--     llegan una vez las alertas que ya están abiertas.
--
--   * `subject_id` es el identificador del HECHO, no del empleado: el turno para
--     la tardanza y la ausencia, la sesión de trabajo para el fichaje sin salida,
--     la solicitud para la solicitud pendiente, el dispositivo para el reloj sin
--     sincronizar. Con el empleado como sujeto, dos turnos distintos del mismo día
--     compartirían clave y el segundo no se avisaría nunca.
--
--   * `occurrence_key` es lo que decide si una alerta se repite y cada cuánto, y
--     es la parte que no se puede omitir:
--
--       - Los hechos que ocurren UNA vez llevan 'once'. Un turno se empieza tarde
--         una sola vez; una solicitud se crea una sola vez. Aviso único.
--
--       - Los hechos que son una CONDICIÓN que dura llevan un cubo de tiempo. Un
--         reloj sin sincronizar sigue sin sincronizar mañana: con 'once' se
--         avisaría una vez y nunca más, y si el gerente no vio esa notificación el
--         iPad se queda roto en silencio. Lleva el día de la ubicación, así que el
--         aviso vuelve cada día mientras el problema siga. Cerca del umbral de
--         horas extra es por persona y por día (o por semana, para el umbral
--         semanal), porque mañana es un caso nuevo. Los intentos rechazados llevan
--         la hora del intento: un iPad robado en bucle da un aviso por hora, no
--         uno por intento.
--
-- LO QUE SE DESCARTÓ, Y POR QUÉ
--   * Solo `(alert_type, subject_id)`: se traga el aviso de los demás gerentes.
--   * Una ventana de tiempo ("nada dos veces en 30 minutos"): eso es un límite de
--     ritmo, no deduplicación. Silencia alertas DISTINTAS y sigue reenviando la
--     misma tardanza indefinidamente, solo más despacio.
--   * El texto de la notificación como clave: el texto es traducido y cambia con
--     cualquier corrección de estilo. Un cambio de copy reenviaría todo el
--     historial.
create table manager_alert_deliveries (
  -- Clave sustituta para poder marcar el envío por id. La clave de negocio es el
  -- `unique` de abajo.
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  alert_type text not null check (alert_type in (
    'late', 'noShow', 'incompleteEntry', 'nearOvertime',
    'newRequest', 'kioskNotSyncing', 'wrongKiosk'
  )),
  subject_id uuid not null,
  occurrence_key text not null,
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  -- Idioma con el que se compuso el texto. Se guarda para poder explicar por qué
  -- una notificación salió en un idioma, no para volver a enviarla.
  recipient_locale text not null default 'es-PE',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  failure_reason text,
  -- La restricción lleva nombre a propósito: `claim_manager_alerts` la referencia
  -- con `on conflict on constraint`. Escribir ahí la lista de columnas hace que
  -- Postgres las confunda con los parámetros de salida de la función, y el error
  -- que da —"column reference is ambiguous"— no señala la causa.
  constraint manager_alert_deliveries_key
    unique (recipient_user_id, alert_type, subject_id, occurrence_key)
);

create index manager_alert_deliveries_queued_idx
  on manager_alert_deliveries (queued_at) where status = 'queued';

alter table manager_alert_deliveries enable row level security;
-- Sin políticas y sin permisos: la escriben las funciones `security definer` y la
-- lee la Edge Function con `service_role`. Nada de esto es dato de negocio que la
-- app deba consultar.
revoke all on manager_alert_deliveries from anon, authenticated;

comment on table manager_alert_deliveries is
  'Deduplicacion de notificaciones al gerente (§19). La clave unica '
  '(destinatario, tipo, sujeto, ocurrencia) es lo que evita repetir la misma '
  'tardanza cada 15 minutos. Ver el comentario largo de la migracion.';

-- ---------------------------------------------------------------------------
-- Alertas pendientes
-- ---------------------------------------------------------------------------
/**
 * Hechos que merecen aviso ahora mismo, ya filtrados por rol y por preferencia.
 *
 * `p_organization_id` nulo significa TODAS las organizaciones: es como la llama el
 * trabajo programado. Con un valor concreto sirve para depurar una sola empresa.
 *
 * QUÉ CUENTA COMO DATO SENSIBLE AQUÍ, Y POR QUÉ
 * §19 dice "no enviar datos sensibles en el texto de notificación" y §9.6 prohíbe
 * la fotografía. La línea que traza esta función:
 *
 *   NO SALE: el nombre propio o preferido, el número de empleado, el correo, el
 *   teléfono, la ruta o la URL de la foto, el PIN o cualquier parte de él, la
 *   credencial del dispositivo, la dirección de la tienda.
 *
 *   SÍ SALE: el tipo de alerta, la cantidad de hechos, y el nombre de la
 *   ubicación.
 *
 * Un nombre propio en la pantalla de bloqueo de un teléfono NO es un detalle de
 * estilo: es información laboral de un tercero —"esta persona llegó tarde hoy"—
 * legible por cualquiera que pase cerca del teléfono, sin desbloquearlo, y también
 * por quien esté mirando la pantalla compartida en una reunión. El gerente ve el
 * nombre un toque después, dentro de la app, detrás del código del dispositivo.
 * El costo es real y se asume: la notificación dice "2 personas" y no quién, así
 * que hay que abrir la app para actuar.
 *
 * El nombre de la ubicación sí viaja porque un gerente de dos tiendas necesita
 * saber a cuál ir, y es un rótulo comercial que él mismo eligió, no un dato de una
 * persona.
 *
 * `payload` lleva solo `locationName`. Cualquier columna nueva con un nombre de
 * persona rompe la prueba de `supabase/tests/20_functions.sql`, que fija tanto el
 * conjunto de columnas como la ausencia de nombres del seed.
 */
create or replace function pending_manager_alerts(p_organization_id uuid default null)
returns table (
  alert_type text,
  recipient_user_id uuid,
  recipient_locale text,
  organization_id uuid,
  location_id uuid,
  subject_id uuid,
  occurrence_key text,
  payload jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with recipients as (
    select
      m.user_id,
      l.organization_id,
      l.id                as location_id,
      l.timezone,
      l.settings,
      o.week_starts_on,
      coalesce(nullif(pr.locale, ''), o.default_locale, 'es-PE') as locale,
      -- Una fila ausente en `notification_preferences` significa "los valores por
      -- defecto", no "no quiere nada": la primera migración los define y el panel
      -- solo escribe cuando el usuario toca algo.
      coalesce(np.preferences, jsonb_build_object(
        'late', true, 'noShow', true, 'earlyClockIn', false, 'nearOvertime', true,
        'incompleteEntry', true, 'newRequest', true, 'scheduleChange', true,
        'kioskNotSyncing', true
      )) as preferences,
      jsonb_build_object('locationName', l.name) as payload
    from public.locations l
    join public.organizations o on o.id = l.organization_id
    join public.organization_memberships m
      on m.organization_id = l.organization_id
     and m.status = 'active'
    left join public.profiles pr on pr.id = m.user_id
    left join public.notification_preferences np
      on np.user_id = m.user_id and np.organization_id = l.organization_id
    where l.is_active
      and (p_organization_id is null or l.organization_id = p_organization_id)
      -- LA BARRERA DE ROL. La misma regla que usa RLS, con la persona como
      -- parámetro porque aquí no hay sesión.
      and public.app_user_manages_location(m.user_id, l.id)
      -- Sin ningún dispositivo activo no hay a dónde enviar. Importa que sea un
      -- filtro y no un descarte posterior: si se encolara igual, la fila de
      -- deduplicación quedaría escrita y la alerta se perdería para siempre en
      -- cuanto la persona registrara su primer dispositivo.
      and exists (
        select 1 from public.push_tokens t
        where t.user_id = m.user_id and t.is_active
      )
  ),

  -- Minutos trabajados por persona y día local, contando la sesión abierta hasta
  -- ahora. `net_minutes` es nulo mientras la sesión está abierta, así que el
  -- tiempo en curso se estima restando los descansos ya cerrados.
  worked as (
    select
      ws.employee_id,
      ws.location_id,
      (ws.starts_at at time zone l.timezone)::date as work_date,
      sum(
        coalesce(
          ws.net_minutes,
          greatest(
            0,
            (extract(epoch from (now() - ws.starts_at)) / 60)::int
              - ws.paid_break_minutes - ws.unpaid_break_minutes
          )
        )
      )::int as minutes
    from public.work_sessions ws
    join public.locations l on l.id = ws.location_id
    where ws.starts_at > now() - interval '14 days'
    group by ws.employee_id, ws.location_id, (ws.starts_at at time zone l.timezone)::date
  )

  -- Tardanza: el turno ya empezó pasada la tolerancia, todavía no ha terminado, y
  -- no hay ninguna sesión de trabajo que le corresponda.
  select
    'late'::text,
    r.user_id,
    r.locale,
    r.organization_id,
    r.location_id,
    s.id,
    'once'::text,
    r.payload
  from recipients r
  join public.shifts s
    on s.location_id = r.location_id
   and s.status = 'published'
  where (r.preferences ->> 'late')::boolean
    and now() > s.starts_at
                + make_interval(mins => coalesce((r.settings ->> 'lateGraceMinutes')::int, 5))
    and now() < s.ends_at
    and not exists (
      select 1 from public.work_sessions ws
      where ws.employee_id = s.employee_id
        and ws.starts_at >= s.starts_at
                           - make_interval(mins => coalesce((r.settings ->> 'earlyClockInMinutes')::int, 10))
        and ws.starts_at <= s.ends_at
    )

  union all

  -- Sin presentarse: el turno terminó y no hubo ni un fichaje. Se mira solo el
  -- último día; más atrás no es una alerta, es un informe.
  select
    'noShow'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    s.id, 'once'::text, r.payload
  from recipients r
  join public.shifts s
    on s.location_id = r.location_id
   and s.status = 'published'
  where (r.preferences ->> 'noShow')::boolean
    and s.ends_at < now()
    and s.ends_at > now() - interval '24 hours'
    and not exists (
      select 1 from public.work_sessions ws
      where ws.employee_id = s.employee_id
        and ws.starts_at >= s.starts_at - interval '1 hour'
        and ws.starts_at <= s.ends_at
    )

  union all

  -- Turno sin salida: la sesión sigue abierta mucho después de lo razonable, o el
  -- servidor ya la marcó para revisión por falta de salida.
  select
    'incompleteEntry'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    ws.id, 'once'::text, r.payload
  from recipients r
  join public.work_sessions ws on ws.location_id = r.location_id
  where (r.preferences ->> 'incompleteEntry')::boolean
    and ws.starts_at > now() - interval '7 days'
    and (
      (ws.status = 'open' and now() > ws.starts_at + interval '16 hours')
      or (ws.status = 'needs_review' and 'missing_clock_out' = any (ws.flags))
    )

  union all

  -- Cerca del umbral DIARIO de horas extra. El margen de 30 minutos es fijo a
  -- propósito: es tiempo de reacción, no una política de la tienda. Un umbral
  -- configurable más sería un interruptor que nadie va a tocar.
  --
  -- SOLO EL DÍA EN CURSO. Sin este filtro la primera ejecución avisaría de cada
  -- día pasado de la ventana: catorce notificaciones sobre jornadas ya cerradas
  -- que el gerente no puede cambiar. "Cercanía a un umbral" solo es accionable
  -- mientras la persona todavía está trabajando.
  select
    'nearOvertime'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    w.employee_id, 'daily:' || w.work_date::text, r.payload
  from recipients r
  join worked w on w.location_id = r.location_id
  where (r.preferences ->> 'nearOvertime')::boolean
    and w.work_date = (now() at time zone r.timezone)::date
    and w.minutes >= coalesce((r.settings ->> 'dailyOvertimeThresholdMinutes')::int, 480) - 30

  union all

  -- Cerca del umbral SEMANAL, sobre la semana de la organización y no la de
  -- Postgres, y solo sobre la semana en curso por la misma razón que arriba.
  select
    'nearOvertime'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    w.employee_id,
    'weekly:' || public.week_start_for(w.work_date, r.week_starts_on)::text,
    r.payload
  from recipients r
  join worked w on w.location_id = r.location_id
  where (r.preferences ->> 'nearOvertime')::boolean
    and public.week_start_for(w.work_date, r.week_starts_on)
        = public.week_start_for((now() at time zone r.timezone)::date, r.week_starts_on)
  group by
    r.user_id, r.locale, r.organization_id, r.location_id, w.employee_id,
    public.week_start_for(w.work_date, r.week_starts_on), r.payload,
    r.settings
  having sum(w.minutes) >= coalesce((r.settings ->> 'weeklyOvertimeThresholdMinutes')::int, 2880) - 30

  union all

  -- Solicitud pendiente. Sin ventana de tiempo: una solicitud sin revisar sigue
  -- siendo un pendiente el mes que viene.
  select
    'newRequest'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    q.id, 'once'::text, r.payload
  from recipients r
  join public.time_edit_requests q on q.location_id = r.location_id
  where (r.preferences ->> 'newRequest')::boolean
    and q.status = 'pending'

  union all

  -- Reloj sin sincronizar. El cubo diario es lo que hace que el aviso vuelva
  -- mañana si el iPad sigue caído, en lugar de avisar una vez y callarse.
  select
    'kioskNotSyncing'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    d.id,
    'day:' || (now() at time zone r.timezone)::date::text,
    r.payload
  from recipients r
  join public.kiosk_devices d on d.location_id = r.location_id and d.status = 'active'
  where (r.preferences ->> 'kioskNotSyncing')::boolean
    and now() > coalesce(d.last_sync_at, d.created_at)
                + make_interval(mins => coalesce((r.settings ->> 'kioskSyncStaleMinutes')::int, 120))

  union all

  -- Intento de fichaje desde un kiosco revocado o de otra tienda.
  --
  -- NO TIENE INTERRUPTOR, y es deliberado. Las ocho preferencias de la
  -- especificación no incluyen esta alerta, y no se inventa una novena: es el
  -- aviso de que un iPad perdido o robado sigue intentando fichar. Un interruptor
  -- aquí permitiría que quien se llevó el dispositivo sea también quien silencie
  -- el aviso, y a diferencia de una tardanza este hecho no aparece hoy en ninguna
  -- pantalla. Costo asumido: no se puede callar; un iPad revocado olvidado
  -- encendido da un aviso por hora hasta que lo apaguen.
  select
    'wrongKiosk'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    a.device_id,
    -- El cubo se calcula en UTC y no en la zona de la sesión: si dependiera del
    -- `TimeZone` de quien ejecuta, dos pases del trabajo podrían agrupar el mismo
    -- intento en horas distintas y avisar dos veces.
    'hour:' || to_char(date_trunc('hour', a.occurred_at at time zone 'UTC'), 'YYYY-MM-DD HH24'),
    r.payload
  from recipients r
  join public.kiosk_rejected_attempts a on a.location_id = r.location_id
  where a.occurred_at > now() - interval '2 hours'
$$;

-- Solo `service_role`. Devuelve qué alertas tiene pendiente CADA persona de CADA
-- organización: es la única función de este archivo que cruza empresas, así que
-- desde la app no debe alcanzarse por ninguna vía.
revoke all on function pending_manager_alerts(uuid) from public, anon, authenticated;
grant execute on function pending_manager_alerts(uuid) to service_role;

/**
 * Reserva las alertas que todavía no se avisaron y las devuelve para enviar.
 *
 * TODO ocurre en UNA sentencia. La deduplicación no es "consulto, comparo y
 * escribo": es el propio `insert ... on conflict`, que en Postgres es atómico. Con
 * dos pasos, dos ejecuciones solapadas del trabajo —o un reintento del cron— leen
 * la misma alerta pendiente y las dos la envían.
 *
 * El `on conflict do update` con `where` es lo que permite reintentar sin
 * duplicar: si la fila ya está `sent`, la condición falla y no se devuelve nada;
 * si quedó `queued` porque el envío murió a medias, se vuelve a entregar pasado
 * `p_retry_after` y hasta `p_max_attempts` veces. Después se abandona: reintentar
 * indefinidamente una notificación de hace horas no ayuda a nadie.
 */
create or replace function claim_manager_alerts(
  p_organization_id uuid default null,
  p_max_attempts integer default 3,
  p_retry_after interval default interval '10 minutes'
)
returns table (
  delivery_id uuid,
  alert_type text,
  recipient_user_id uuid,
  recipient_locale text,
  organization_id uuid,
  location_id uuid,
  payload jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    -- `distinct on` la clave completa: una misma persona puede administrar dos
    -- tiendas y un empleado puede tener sesiones en las dos, así que la alerta de
    -- horas extra —cuyo sujeto es el empleado y no la tienda— puede aparecer dos
    -- veces con la misma clave. Postgres rechaza un `on conflict do update` que
    -- toque la misma fila dos veces en una sentencia, con un error que no explica
    -- nada. Se resuelve aquí, no en el llamador.
    select distinct on (a.recipient_user_id, a.alert_type, a.subject_id, a.occurrence_key)
      a.recipient_user_id, a.alert_type, a.subject_id, a.occurrence_key,
      a.organization_id, a.location_id, a.recipient_locale, a.payload
    from public.pending_manager_alerts(p_organization_id) a
    order by a.recipient_user_id, a.alert_type, a.subject_id, a.occurrence_key, a.location_id
  ),
  claimed as (
    insert into public.manager_alert_deliveries as d (
      recipient_user_id, alert_type, subject_id, occurrence_key,
      organization_id, location_id, recipient_locale, payload
    )
    select
      c.recipient_user_id, c.alert_type, c.subject_id, c.occurrence_key,
      c.organization_id, c.location_id, c.recipient_locale, c.payload
    from candidates c
    on conflict on constraint manager_alert_deliveries_key do update
      set attempts = d.attempts + 1,
          queued_at = now()
      where d.status = 'queued'
        and d.attempts < p_max_attempts
        and d.queued_at < now() - p_retry_after
    returning
      d.id, d.alert_type, d.recipient_user_id, d.recipient_locale,
      d.organization_id, d.location_id, d.payload
  )
  select * from claimed;
end;
$$;

revoke all on function claim_manager_alerts(uuid, integer, interval)
  from public, anon, authenticated;
grant execute on function claim_manager_alerts(uuid, integer, interval) to service_role;

/** Marca enviado lo que Expo aceptó. */
create or replace function mark_manager_alerts_sent(p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.manager_alert_deliveries
    set status = 'sent', sent_at = now(), failure_reason = null
    where id = any (p_ids) and status = 'queued';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * Marca fallido lo que Expo rechazó de forma definitiva.
 *
 * `p_reason` se guarda para poder diagnosticar, y por eso NO puede llevar el texto
 * de la notificación ni el token: es un motivo corto de la API de Expo.
 */
create or replace function mark_manager_alerts_failed(p_ids uuid[], p_reason text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.manager_alert_deliveries
    set status = 'failed', failure_reason = left(coalesce(p_reason, ''), 200)
    where id = any (p_ids) and status = 'queued';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** Desactiva un token que Expo declaró inexistente (`DeviceNotRegistered`). */
create or replace function deactivate_push_token(p_expo_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.push_tokens
    set is_active = false
    where expo_token = p_expo_token and is_active;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function mark_manager_alerts_sent(uuid[]) from public, anon, authenticated;
revoke all on function mark_manager_alerts_failed(uuid[], text) from public, anon, authenticated;
-- `deactivate_push_token` NO comprueba de quién es el token, y no le hace falta
-- porque solo la llama el envío con `service_role`. Si algún día se abriera a la
-- app, habría que añadir la comprobación de dueño: sin ella, conocer un token
-- ajeno bastaría para dejar a esa persona sin notificaciones.
revoke all on function deactivate_push_token(text) from public, anon, authenticated;
grant execute on function mark_manager_alerts_sent(uuid[]) to service_role;
grant execute on function mark_manager_alerts_failed(uuid[], text) to service_role;
grant execute on function deactivate_push_token(text) to service_role;

/**
 * Purga el historial de deduplicación.
 *
 * Sin purga la tabla crece para siempre. Con purga a ciegas reaparecen avisos
 * viejos, porque borrar la fila de deduplicación es exactamente lo mismo que decir
 * "esto no se ha avisado". 180 días es holgado: la ventana más larga de
 * `pending_manager_alerts` es de 7 días.
 *
 * LA EXCEPCIÓN QUE HAY QUE TENER PRESENTE: una solicitud pendiente no caduca. Es
 * el único hecho de vida ilimitada, así que su fila se conserva mientras la
 * solicitud siga pendiente; si no, a los 180 días el gerente recibiría otra vez el
 * aviso de una solicitud que ya conoce.
 */
create or replace function purge_manager_alert_deliveries(p_keep_days integer default 180)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.manager_alert_deliveries d
  where d.queued_at < now() - make_interval(days => greatest(p_keep_days, 1))
    and not exists (
      select 1 from public.time_edit_requests q
      where d.alert_type = 'newRequest'
        and q.id = d.subject_id
        and q.status = 'pending'
    );
  get diagnostics v_count = row_count;

  -- Los intentos rechazados son bitácora, no dato de negocio: se guardan lo
  -- suficiente para investigar un iPad perdido y no más.
  delete from public.kiosk_rejected_attempts
    where occurred_at < now() - interval '90 days';

  return v_count;
end;
$$;

revoke all on function purge_manager_alert_deliveries(integer)
  from public, anon, authenticated;
grant execute on function purge_manager_alert_deliveries(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Programación
-- ---------------------------------------------------------------------------
-- Mismo patrón que `20260827000900_scheduled_jobs.sql`: si `pg_cron` no está, la
-- migración avisa y sigue. Que se aplique importa, porque si falla aquí no corre
-- ninguna migración posterior.
--
-- QUÉ SE PROGRAMA Y QUÉ NO, Y POR QUÉ
-- `pg_cron` ejecuta SQL dentro de la base. La purga es SQL, así que se programa.
-- El ENVÍO no lo es: hay que hablar HTTP con la API de Expo Push, y eso vive en la
-- Edge Function `send-manager-alerts`. Para que `pg_cron` la llamara habría que
-- instalar `pg_net` y guardar un token de servicio en un ajuste de la base, o sea
-- mover un secreto desde el entorno de las Edge Functions —donde está hoy— a la
-- propia base de datos, donde lo puede leer cualquiera con acceso de lectura a la
-- configuración. No se hace: el disparador del envío es un programador externo con
-- la `service_role` (un Scheduled Function de Supabase o un cron propio), cada 15
-- minutos, y está documentado en `supabase/functions/README.md`.
--
-- Si nadie configura ese disparador, la consecuencia es concreta: las alertas se
-- calculan y no se envían. No se pierden —`pending_manager_alerts` las vuelve a
-- devolver mientras el hecho siga vigente— pero nadie se entera.
do $$
declare
  v_has_cron boolean;
begin
  select exists (
    select 1 from pg_available_extensions where name = 'pg_cron'
  ) into v_has_cron;

  if not v_has_cron then
    raise notice
      'pg_cron no disponible: la purga del historial de alertas NO queda '
      'programada. Hay que llamar a purge_manager_alert_deliveries() a diario '
      'desde fuera. Y en cualquier caso el ENVIO lo dispara un programador '
      'externo sobre la Edge Function send-manager-alerts cada 15 minutos.';
    return;
  end if;

  create extension if not exists pg_cron;

  perform cron.unschedule('krealo-shift-purgar-alertas')
    where exists (
      select 1 from cron.job where jobname = 'krealo-shift-purgar-alertas'
    );

  -- 03:30 UTC, o 22:30 en Lima: quince minutos después de la purga de fotos, para
  -- no arrancar dos borrados a la vez sobre la misma base.
  perform cron.schedule(
    'krealo-shift-purgar-alertas',
    '30 3 * * *',
    $job$ select public.purge_manager_alert_deliveries(); $job$
  );

  raise notice
    'Purga del historial de alertas programada a diario (03:30 UTC). El ENVIO lo '
    'dispara un programador externo sobre send-manager-alerts cada 15 minutos.';
end
$$;


-- ==========================================================================
-- MIGRACION: 20260827001200_organization_logo.sql
-- ==========================================================================

-- Krealo Shift — logotipo de la organización (§11.6)
--
-- QUÉ FALTABA
-- `organizations.logo_path` existía desde el esquema inicial, pero sin bucket
-- donde guardar la imagen. Igual que pasaba con las fotos de fichaje: una columna
-- que apunta a un sitio que no existe.
--
-- POR QUÉ ESTE BUCKET SÍ ES PÚBLICO, A DIFERENCIA DEL DE LAS FOTOS
-- Es la única decisión que hay que pensar aquí, y va en la dirección contraria.
-- Un logotipo de empresa es material de marca: se pone en la pantalla del kiosco,
-- que está a la vista de cualquiera que entre a la tienda, y a veces en un correo
-- o un PDF exportado. Tratarlo como secreto obligaría a firmar una URL cada vez
-- que el kiosco pinta su pantalla de reposo —incluido un kiosco sin sesión de
-- usuario— y no protegería nada: la imagen ya es pública de hecho.
--
-- La comparación es útil: la foto de fichaje es la cara de una persona trabajando
-- y va en bucket privado con URL firmada. El logotipo es el letrero de la puerta.
-- Los dos casos existen en la misma app y merecen tratos opuestos; confundirlos en
-- cualquiera de las dos direcciones sería el error.
--
-- ESCRIBIR SÍ ESTÁ RESTRINGIDO. Público es la lectura, no la subida: solo quien
-- es owner o admin de la organización del primer segmento de la ruta puede
-- escribir o borrar. Si no, cualquier sesión podría reemplazar el logotipo de
-- cualquier empresa, que es una forma barata de suplantación.
--
-- RUTA: {organization_id}/logo.{ext}. Sin fecha ni identificador aleatorio, porque
-- hay UN logotipo por organización y sustituirlo debe sustituirlo, no acumular
-- versiones que nadie va a limpiar.

-- ---------------------------------------------------------------------------
-- Quién puede administrar una organización
-- ---------------------------------------------------------------------------

/**
 * Cierto si quien llama es owner o admin de la organización.
 *
 * Existe aparte de `app_role_in` porque las políticas de `storage.objects` tienen
 * que resolver esto desde un segmento del nombre del archivo, sin más contexto, y
 * repetir el `array[...]::public.app_role[]` en cada política es cómo se
 * introducen diferencias silenciosas entre ellas.
 */
create or replace function app_administers_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_role_in(p_organization_id, array['owner', 'admin']::public.app_role[]);
$$;

revoke all on function app_administers_organization(uuid) from public;
grant execute on function app_administers_organization(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bucket y políticas — solo si la extensión de Storage está presente
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'Storage de Supabase no presente: se omiten el bucket de logotipos y '
      'sus politicas. Normal en el Postgres local de pruebas; en la nube se aplican.';
    return;
  end if;

  -- 1 MB basta de sobra para un logotipo y evita que alguien suba una imagen de
  -- imprenta que el kiosco tendría que descargar en cada arranque.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('organization-logos', 'organization-logos', true, 1048576,
          array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
  on conflict (id) do update
    set public = true,
        file_size_limit = 1048576,
        allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

  -- LECTURA: pública. Ver la nota de arriba sobre por qué.
  drop policy if exists "logos legibles por cualquiera" on storage.objects;
  create policy "logos legibles por cualquiera"
    on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'organization-logos');

  -- ESCRITURA: solo owner o admin de LA organización del primer segmento.
  drop policy if exists "logos los sube un administrador" on storage.objects;
  create policy "logos los sube un administrador"
    on storage.objects for insert
    to authenticated
    with check (
      bucket_id = 'organization-logos'
      and public.app_administers_organization(((storage.foldername(name))[1])::uuid)
    );

  drop policy if exists "logos los reemplaza un administrador" on storage.objects;
  create policy "logos los reemplaza un administrador"
    on storage.objects for update
    to authenticated
    using (
      bucket_id = 'organization-logos'
      and public.app_administers_organization(((storage.foldername(name))[1])::uuid)
    );

  drop policy if exists "logos los borra un administrador" on storage.objects;
  create policy "logos los borra un administrador"
    on storage.objects for delete
    to authenticated
    using (
      bucket_id = 'organization-logos'
      and public.app_administers_organization(((storage.foldername(name))[1])::uuid)
    );
end
$$;


-- ==========================================================================
-- MIGRACION: 20260827001300_manager_add_time_event.sql
-- ==========================================================================

-- Krealo Shift — fichaje manual del gerente (§11.4)
--
-- QUÉ FALTABA
-- §11.4 pide "agregar fichaje manual con motivo" y no existía forma de hacerlo. El
-- panel lo suplía creando una SOLICITUD de corrección, que es auditable y honesta
-- pero no es lo mismo: una solicitud la tiene que aprobar alguien, y aquí quien
-- actúa YA es el gerente. El caso real es cotidiano: a alguien se le olvidó marcar
-- la salida, se fue a casa, y el gerente tiene que dejar la jornada cuadrada hoy.
--
-- LO QUE ESTA FUNCIÓN NO ROMPE
-- `time_events` sigue siendo append-only. Esto no edita ningún evento: CREA uno
-- nuevo, marcado `source = 'manager'`, así que en el detalle diario se distingue a
-- simple vista de lo que marcó la persona en el iPad. La regla de la
-- especificación —"nunca sobrescribir silenciosamente un evento original"— se
-- respeta porque no se sobrescribe nada.
--
-- EL MOTIVO ES OBLIGATORIO Y NO ES UN CAMPO DECORATIVO. Un fichaje que el gerente
-- se inventa sin explicación es indistinguible de un fraude en una auditoría
-- laboral. Se guarda en `time_adjustments` con el valor anterior (que aquí es
-- "no había evento"), el nuevo, el autor, la fecha del servidor y el canal, que es
-- lo que §11.4 exige conservar de toda corrección.
--
-- POR QUÉ VALIDA LA TRANSICIÓN Y NO ACEPTA CUALQUIER COSA
-- Podría insertar el evento a ciegas y dejar que la proyección se arregle sola,
-- pero entonces un gerente podría crear dos entradas seguidas sin salida y las
-- horas de esa persona quedarían mal sin que nadie lo note hasta el pago. Se
-- comprueba la transición contra el estado del empleado EN ESE INSTANTE —no en el
-- actual— porque un fichaje manual casi siempre se agrega en el pasado.

-- ---------------------------------------------------------------------------
-- Estado del empleado EN UN INSTANTE DADO
-- ---------------------------------------------------------------------------

/**
 * Igual que `current_attendance_state`, pero "a fecha de".
 *
 * Existe porque un fichaje manual casi siempre se agrega en el pasado —a alguien
 * se le olvidó marcar la salida ayer— y validar la transición contra el estado de
 * AHORA rechazaría correcciones perfectamente válidas: si la persona ya volvió a
 * fichar hoy, su estado actual no dice nada de lo que pasaba ayer a las 18:00.
 *
 * El desempate por `seq` es el mismo que en la versión de ahora, y por el mismo
 * motivo: sin él el estado es indeterminado cuando dos eventos comparten instante.
 */
create or replace function attendance_state_at(
  p_employee_id uuid,
  p_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last public.time_event_type;
begin
  select event_type into v_last
  from public.time_events
  where employee_id = p_employee_id
    and occurred_at <= p_at
  order by occurred_at desc, received_at desc, seq desc
  limit 1;

  if v_last is null then return 'OFF_SHIFT'; end if;

  return case v_last
    when 'clock_in'    then 'WORKING'
    when 'break_end'   then 'WORKING'
    when 'break_start' then 'ON_BREAK'
    when 'clock_out'   then 'OFF_SHIFT'
  end;
end;
$$;

revoke all on function attendance_state_at(uuid, timestamptz) from public;
grant execute on function attendance_state_at(uuid, timestamptz) to authenticated;

create or replace function manager_add_time_event(
  p_employee_id uuid,
  p_location_id uuid,
  p_event_type public.time_event_type,
  p_occurred_at timestamptz,
  p_reason text,
  p_break_type public.break_type default null,
  p_shift_id uuid default null,
  p_idempotency_key uuid default null
)
returns table (event_id uuid, work_session_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_employee record;
  v_state text;
  v_event_id uuid;
  v_session_id uuid;
  v_key uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'El fichaje manual necesita un motivo.' using errcode = 'check_violation';
  end if;

  if p_occurred_at is null then
    raise exception 'Falta la hora del fichaje.' using errcode = 'check_violation';
  end if;

  -- Un fichaje en el futuro no es una corrección, es una invención. Se rechaza:
  -- las horas trabajadas se registran cuando ocurren.
  if p_occurred_at > now() + interval '1 minute' then
    raise exception 'No se puede registrar un fichaje en el futuro.'
      using errcode = 'check_violation';
  end if;

  if not public.app_manages_location(p_location_id) then
    raise exception 'No administras esta ubicación.' using errcode = 'insufficient_privilege';
  end if;

  select e.id, e.organization_id, e.status into v_employee
  from public.employees e where e.id = p_employee_id;

  if v_employee.id is null then
    raise exception 'Empleado inexistente.' using errcode = 'no_data_found';
  end if;

  -- La ubicación y el empleado tienen que ser de la MISMA organización. Sin esto,
  -- quien administre una tienda podría crear fichajes para personal de otra
  -- empresa pasando el par de identificadores a mano.
  select l.organization_id into v_org
  from public.locations l where l.id = p_location_id;

  if v_org is null or v_org <> v_employee.organization_id then
    raise exception 'Ese empleado no pertenece a esta ubicación.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.employee_location_assignments a
    where a.employee_id = p_employee_id and a.location_id = p_location_id
  ) then
    raise exception 'Ese empleado no está asignado a esta ubicación.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Sin clave del cliente se genera una: la idempotencia protege del doble envío
  -- del formulario igual que en el kiosco.
  v_key := coalesce(p_idempotency_key, extensions.gen_random_uuid());

  -- LA IDEMPOTENCIA SE COMPRUEBA ANTES DE LA TRANSICIÓN, y el orden no es un
  -- detalle: al revés, el reenvío del formulario se rechaza a sí mismo. El primer
  -- envío crea el fichaje, y en el segundo la validación ve el estado que acaba de
  -- dejar ese mismo evento —una entrada ya registrada— y responde "la persona ya
  -- estaba trabajando". El usuario vería un error donde en realidad su acción sí
  -- funcionó. `submit_time_event` resuelve esto igual, por el mismo motivo.
  select id into v_event_id from public.time_events
  where organization_id = v_employee.organization_id and idempotency_key = v_key;

  if v_event_id is not null then
    return query
    select v_event_id,
           (select ws.id from public.work_sessions ws
            where ws.clock_in_event_id = v_event_id
               or ws.clock_out_event_id = v_event_id
            limit 1);
    return;
  end if;

  -- Estado EN EL INSTANTE del fichaje que se agrega, no el de ahora: un fichaje
  -- manual se pone casi siempre en el pasado, y validar contra el estado actual
  -- rechazaría correcciones perfectamente válidas.
  select public.attendance_state_at(p_employee_id, p_occurred_at) into v_state;

  if not public.attendance_transition_allowed(v_state, p_event_type) then
    raise exception
      'Ese fichaje no encaja: a esa hora la persona estaba en estado %.', v_state
      using errcode = 'check_violation';
  end if;

  insert into public.time_events
    (organization_id, employee_id, location_id, shift_id, event_type, break_type,
     source, occurred_at, idempotency_key, created_by, metadata)
  values
    (v_employee.organization_id, p_employee_id, p_location_id, p_shift_id,
     p_event_type, p_break_type, 'manager', p_occurred_at, v_key, auth.uid(),
     jsonb_build_object('reason', p_reason, 'manualEntry', true))
  -- `on conflict` sigue aquí aunque ya se comprobó arriba: dos envíos
  -- simultáneos con la misma clave pueden pasar los dos por la comprobación antes
  -- de que ninguno inserte. La restricción única es la que de verdad lo impide.
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    -- Carrera perdida: el otro envío lo insertó entre la comprobación y este
    -- insert. Se devuelve el evento que gano, no un error.
    select id into v_event_id from public.time_events
    where organization_id = v_employee.organization_id and idempotency_key = v_key;

    return query
    select v_event_id,
           (select ws.id from public.work_sessions ws
            where ws.clock_in_event_id = v_event_id
               or ws.clock_out_event_id = v_event_id
            limit 1);
    return;
  end if;

  perform public.apply_event_to_projection(v_event_id);

  select ws.id into v_session_id from public.work_sessions ws
  where ws.clock_in_event_id = v_event_id or ws.clock_out_event_id = v_event_id
  limit 1;

  if v_session_id is null then
    -- Un descanso no abre ni cierra sesión: se busca la que lo contiene.
    select ws.id into v_session_id from public.work_sessions ws
    where ws.employee_id = p_employee_id
      and ws.starts_at <= p_occurred_at
      and (ws.ends_at is null or ws.ends_at >= p_occurred_at)
    order by ws.starts_at desc
    limit 1;
  end if;

  -- Rastro auditable. `before_value` dice que no había nada: es la diferencia
  -- entre "se corrigió una hora" y "se agregó un fichaje que no existía", y en una
  -- auditoría laboral esa distinción importa.
  insert into public.time_adjustments
    (organization_id, work_session_id, target_type, target_id,
     before_value, after_value, reason, created_by)
  values
    (v_employee.organization_id, v_session_id, 'time_event', v_event_id,
     jsonb_build_object('existed', false),
     jsonb_build_object(
       'eventType', p_event_type,
       'occurredAt', p_occurred_at,
       'breakType', p_break_type,
       'source', 'manager'),
     p_reason, auth.uid());

  insert into public.audit_logs
    (organization_id, actor_user_id, action, entity_type, entity_id, after_data)
  values
    (v_employee.organization_id, auth.uid(), 'time_event_added_manually', 'time_event',
     v_event_id,
     jsonb_build_object(
       'employeeId', p_employee_id,
       'locationId', p_location_id,
       'eventType', p_event_type,
       'occurredAt', p_occurred_at,
       'reason', p_reason));

  return query select v_event_id, v_session_id;
end;
$$;

revoke all on function manager_add_time_event(
  uuid, uuid, public.time_event_type, timestamptz, text, public.break_type, uuid, uuid
) from public;

grant execute on function manager_add_time_event(
  uuid, uuid, public.time_event_type, timestamptz, text, public.break_type, uuid, uuid
) to authenticated;


-- ==========================================================================
-- MIGRACION: 20260827001400_function_privileges.sql
-- ==========================================================================

-- Krealo Shift — permisos de ejecución de las funciones (§15, §22)
--
-- EL AGUJERO, Y POR QUÉ NO SE VIO ANTES
-- Todas las migraciones anteriores protegen sus funciones con
-- `revoke all on function ... from public`. Eso NO alcanza en Supabase, y la
-- diferencia es sutil:
--
--   * En PostgreSQL a secas, una función nueva nace con `execute` concedido al
--     pseudo-rol `PUBLIC`. Revocar de `PUBLIC` la cierra. Eso es lo que pasaba en
--     el Postgres local de pruebas, y por eso las pruebas daban verde.
--   * Supabase, además, deja configurado
--     `alter default privileges in schema public grant all on functions to
--      postgres, anon, authenticated, service_role`. Con eso cada función nueva
--     nace con `execute` concedido EXPLÍCITAMENTE a esos cuatro roles, y revocar
--     de `PUBLIC` no toca esas concesiones: son otra cosa.
--
-- Consecuencia real, comprobada añadiendo esos privilegios por defecto al shim de
-- pruebas: 34 funciones quedaban invocables por RPC desde `anon`, o sea **sin
-- ninguna sesión**. Entre ellas:
--
--   * `set_employee_pin` — cualquiera podía fijar el PIN de cualquier empleado y
--     después fichar en su nombre. Es la peor de todas.
--   * `kiosk_offline_verifiers` — entregaba los salt y verificadores de PIN de
--     cualquier dispositivo con solo conocer su uuid.
--   * `submit_time_event` y `submit_offline_time_event` — fichajes forjados.
--   * `verify_employee_pin` — fuerza bruta de PIN sin la credencial del kiosco.
--   * `authenticate_kiosk`, `activate_kiosk_device`, `apply_event_to_projection`.
--
-- EL ARREGLO: NEGAR POR DEFECTO Y CONCEDER POR LISTA
-- Se revoca `execute` de `anon` y `authenticated` en TODAS las funciones de
-- `public`, y después se concede solo a las que la app tiene que poder llamar. Es
-- al revés de como estaba —cerrar lo conocido— y esa inversión es el punto: una
-- función nueva que nadie recuerde revocar queda cerrada, no abierta.
--
-- LO QUE DE VERDAD LO SOSTIENE es la prueba de `supabase/tests/40_privilegios.sql`,
-- que enumera las funciones y falla si alguna fuera de la lista blanca es
-- ejecutable. Los privilegios por defecto de abajo ayudan pero no bastan: solo
-- aplican a objetos creados por el rol que los configura, y no se puede dar por
-- hecho qué rol corre cada migración en la nube.

-- ---------------------------------------------------------------------------
-- 1. Cambiar el defecto para las funciones futuras
-- ---------------------------------------------------------------------------

alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cerrar todas las existentes
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    -- `public` va en la lista y no es redundante: TODO rol hereda lo concedido a
    -- `PUBLIC`, asi que revocar solo de `anon` y `authenticated` deja la funcion
    -- abierta si `PUBLIC` conserva su `execute` por defecto. Es justo lo que
    -- pasaba con las funciones de disparador, que ninguna migracion habia
    -- revocado, y lo detecto la prueba de 40_privilegios.sql.
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.sig);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Conceder lo que la app necesita, y solo eso
-- ---------------------------------------------------------------------------

-- Se concede POR NOMBRE y no por firma completa, dentro de un bloque que EXIGE que
-- cada nombre exista. Dos razones, y la segunda importa mas:
--
--   * cambiar un parametro de una funcion no deja este archivo desactualizado en
--     silencio (paso al escribirlo: tres firmas no coincidian);
--   * si alguien renombra o borra una funcion de la lista, la migracion FALLA en
--     vez de seguir adelante dejandola sin permisos. En una lista blanca de
--     seguridad, fallar ruidosamente es la unica opcion aceptable.
do $$
declare
  v_nombre text;
  v_sig text;
  v_n integer;
  -- Ayudantes de RLS. Van a `authenticated` porque las POLITICAS los llaman: una
  -- politica que invoca una funcion se evalua con los permisos de quien consulta,
  -- asi que sin esto ninguna lectura de la app funcionaria. No van a `anon`: no hay
  -- ninguna politica `to anon` en el proyecto.
  --
  -- Funciones puras de apoyo que la app usa para pintar; no leen nada sensible.
  --
  -- Y los RPC del panel: cada uno comprueba el rol POR DENTRO. Conceder `execute`
  -- no es conceder permiso, solo la posibilidad de preguntar. Sin esa comprobacion
  -- interna, estos `grant` serian el agujero.
  v_permitidas text[] := array[
    'app_is_member', 'app_role_in', 'app_manages_location', 'app_is_self_employee',
    'app_employee_id', 'app_administers_organization', 'app_user_manages_location',
    'attendance_transition_allowed', 'week_start_for',
    'create_kiosk_activation_code', 'revoke_kiosk_device', 'set_employee_pin',
    'manager_adjust_time', 'manager_add_time_event', 'approve_timesheet_period',
    'export_timesheet_rows', 'rebuild_work_session', 'current_attendance_state',
    'attendance_state_at', 'deactivate_push_token'
  ];
begin
  foreach v_nombre in array v_permitidas loop
    v_n := 0;
    for v_sig in
      select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.proname = v_nombre
    loop
      execute format('grant execute on function %s to authenticated', v_sig);
      v_n := v_n + 1;
    end loop;

    if v_n = 0 then
      raise exception
        'La lista blanca de permisos nombra %, que no existe. Si se renombro o se '
        'borro, hay que actualizar 20260827001400_function_privileges.sql.', v_nombre
        using errcode = 'undefined_function';
    end if;
  end loop;
end
$$;

-- 3.d NADA para el camino del kiosco ni para los trabajos programados. Esas las
-- llaman las Edge Functions con la `service_role`, que no evalúa privilegios de
-- tabla ni de función. Dejarlas sin `grant` es lo que cierra el agujero:
--   authenticate_kiosk, verify_employee_pin, submit_time_event,
--   submit_offline_time_event, activate_kiosk_device, kiosk_offline_verifiers,
--   kiosk_employee_context, apply_event_to_projection, attendance_photo_path,
--   purge_expired_attendance_photos, pending_manager_alerts,
--   claim_manager_alerts, mark_manager_alerts_sent, mark_manager_alerts_failed,
--   purge_manager_alert_deliveries, record_kiosk_rejection.
--
-- Las funciones de disparador (`reject_mutation`, `set_updated_at`,
-- `guard_*`, `stamp_shift_publication`) tampoco reciben nada: un disparador se
-- ejecuta con los permisos del dueño de la tabla, no de quien escribe, así que no
-- hace falta ningún `grant` para que funcionen.


-- ==========================================================================
-- MIGRACION: 20260827001500_authorize_rpc.sql
-- ==========================================================================

-- Krealo Shift — comprobación de rol dentro de los RPC que le faltaba (§15, §22)
--
-- POR QUÉ HACE FALTA ESTO, Y POR QUÉ NO BASTABA LA MIGRACIÓN ANTERIOR
-- `20260827001400` cerró los permisos de ejecución: solo una lista blanca de
-- funciones es invocable por `authenticated`. Pero conceder `execute` no es
-- conceder permiso: cada función de esa lista tiene que comprobar el rol POR
-- DENTRO, porque cualquier persona con sesión —de cualquier empresa— puede
-- llamarla pasando los identificadores que quiera.
--
-- Al auditarlas una por una, cuatro no comprobaban nada:
--
--   * `set_employee_pin` — LA GRAVE. Validaba el formato del PIN y que el empleado
--     existiera, y nada más. Cualquier usuario con sesión podía fijar el PIN de
--     CUALQUIER empleado, incluido personal de otra empresa, y después fichar en su
--     nombre en el iPad de esa tienda. Ni RLS lo tapaba: `security definer` la
--     ejecuta con permisos del dueño.
--   * `rebuild_work_session` — recalcular sesiones de cualquier organización.
--   * `current_attendance_state` — saber si una persona concreta está trabajando
--     ahora mismo. Es información laboral de un tercero.
--   * `deactivate_push_token` — desactivar el token de otra persona conociéndolo.
--
-- EL DETALLE QUE CASI ROMPE ESTO: el camino del kiosco llama a
-- `current_attendance_state` y a `rebuild_work_session` desde dentro de otras
-- funciones `security definer`, con la `service_role`, donde NO hay `auth.uid()`.
-- Una comprobación ingenua contra `auth.uid()` habría hecho fallar todos los
-- fichajes del iPad.
--
-- Se resuelve dejando pasar cuando `auth.uid() is null`, y eso es seguro
-- exactamente por una razón que conviene dejar escrita: tras la migración anterior,
-- `anon` no puede ejecutar NINGUNA de estas funciones. Así que "sin `auth.uid()`"
-- solo puede significar `service_role` o una llamada interna, las dos de confianza.
-- Si algún día se le concediera `execute` a `anon`, esta suposición se rompe y con
-- ella la autorización: la prueba de `40_privilegios.sql` es lo que impide que eso
-- ocurra sin que nadie lo note.

-- ---------------------------------------------------------------------------
-- set_employee_pin: solo quien administra a esa persona
-- ---------------------------------------------------------------------------

create or replace function set_employee_pin(p_employee_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_len smallint := length(p_pin);
begin
  if v_len < 4 or v_len > 6 or p_pin !~ '^[0-9]+$' then
    raise exception 'El PIN debe tener entre 4 y 6 dígitos numéricos.'
      using errcode = 'check_violation';
  end if;

  select organization_id into v_org from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception 'Empleado inexistente.' using errcode = 'no_data_found';
  end if;

  -- LA COMPROBACIÓN QUE FALTABA. Con sesión, hay que administrar la empresa de esa
  -- persona o alguna de las tiendas donde trabaja. Sin sesión es la `service_role`
  -- —el seed y las Edge Functions—, ver la nota de la cabecera.
  if auth.uid() is not null
     and not public.app_administers_organization(v_org)
     and not exists (
       select 1
       from public.employee_location_assignments a
       where a.employee_id = p_employee_id
         and public.app_manages_location(a.location_id)
     )
  then
    raise exception 'No administras a esta persona.' using errcode = 'insufficient_privilege';
  end if;

  -- OJO: el cuerpo viene de la version de 20260827000600, no de la de 000300. La
  -- 600 añadio `pin_offline_hash` —bcrypt coste 10, el que compara el iPad sin
  -- red— y basarse en la 300 lo habria borrado en silencio. Paso: las pruebas de
  -- verificadores offline lo cazaron al instante, que es para lo que estan.
  insert into public.employee_pin_credentials as c
    (employee_id, organization_id, pin_hash, pin_offline_hash, pin_length, version, rotated_at)
  values
    (p_employee_id, v_org,
     extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
     extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
     v_len, 1, now())
  on conflict (employee_id) do update
    set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
        pin_offline_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
        pin_length = v_len,
        version = c.version + 1,
        failed_attempts = 0,
        locked_until = null,
        rotated_at = now();

  -- Rotar un PIN es un hecho auditable: es la credencial con la que alguien ficha.
  insert into public.audit_logs
    (organization_id, actor_user_id, action, entity_type, entity_id)
  values (v_org, auth.uid(), 'employee_pin_set', 'employee', p_employee_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- current_attendance_state: no es dato público de la plantilla
-- ---------------------------------------------------------------------------

create or replace function current_attendance_state(p_employee_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last public.time_event_type;
begin
  -- Con sesión: o es sobre uno mismo, o hay que administrar alguna de sus tiendas.
  -- Saber si una persona concreta está trabajando ahora mismo es información
  -- laboral suya, no un dato público del directorio.
  if auth.uid() is not null
     and not public.app_is_self_employee(p_employee_id)
     and not exists (
       select 1
       from public.employee_location_assignments a
       where a.employee_id = p_employee_id
         and public.app_manages_location(a.location_id)
     )
  then
    raise exception 'No puedes consultar el estado de esta persona.'
      using errcode = 'insufficient_privilege';
  end if;

  select event_type into v_last
  from public.time_events
  where employee_id = p_employee_id
  -- El desempate por `seq` es lo que hace determinista el estado cuando varios
  -- eventos comparten instante, como pasa al sincronizar un lote offline.
  order by occurred_at desc, received_at desc, seq desc
  limit 1;

  if v_last is null then return 'OFF_SHIFT'; end if;

  return case v_last
    when 'clock_in'    then 'WORKING'
    when 'break_end'   then 'WORKING'
    when 'break_start' then 'ON_BREAK'
    when 'clock_out'   then 'OFF_SHIFT'
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- attendance_state_at: mismo dato, misma regla
-- ---------------------------------------------------------------------------

create or replace function attendance_state_at(
  p_employee_id uuid,
  p_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last public.time_event_type;
begin
  if auth.uid() is not null
     and not public.app_is_self_employee(p_employee_id)
     and not exists (
       select 1
       from public.employee_location_assignments a
       where a.employee_id = p_employee_id
         and public.app_manages_location(a.location_id)
     )
  then
    raise exception 'No puedes consultar el estado de esta persona.'
      using errcode = 'insufficient_privilege';
  end if;

  select event_type into v_last
  from public.time_events
  where employee_id = p_employee_id
    and occurred_at <= p_at
  order by occurred_at desc, received_at desc, seq desc
  limit 1;

  if v_last is null then return 'OFF_SHIFT'; end if;

  return case v_last
    when 'clock_in'    then 'WORKING'
    when 'break_end'   then 'WORKING'
    when 'break_start' then 'ON_BREAK'
    when 'clock_out'   then 'OFF_SHIFT'
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- rebuild_work_session: solo sobre sesiones de una tienda que administras
-- ---------------------------------------------------------------------------
--
-- Se envuelve en vez de reescribirse: el cuerpo original es la reconstrucción de la
-- proyección y no cambia. Se le pone la comprobación delante y se renombra el
-- original a `rebuild_work_session_unchecked`, que queda sin `grant` y solo la
-- llaman otras funciones `security definer` del servidor.

alter function rebuild_work_session(uuid) rename to rebuild_work_session_unchecked;

revoke all on function rebuild_work_session_unchecked(uuid) from public, anon, authenticated;

create or replace function rebuild_work_session(p_work_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location uuid;
begin
  select location_id into v_location
  from public.work_sessions where id = p_work_session_id;

  if v_location is null then
    raise exception 'Sesión inexistente.' using errcode = 'no_data_found';
  end if;

  if auth.uid() is not null and not public.app_manages_location(v_location) then
    raise exception 'No administras esta ubicación.' using errcode = 'insufficient_privilege';
  end if;

  perform public.rebuild_work_session_unchecked(p_work_session_id);
end;
$$;

revoke all on function rebuild_work_session(uuid) from public, anon;
grant execute on function rebuild_work_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- deactivate_push_token: solo los tokens propios
-- ---------------------------------------------------------------------------

create or replace function deactivate_push_token(p_expo_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- El filtro por `user_id = auth.uid()` es la autorización: sin él, conocer la
  -- cadena del token de otra persona bastaba para dejarla sin notificaciones.
  --
  -- Con sesión solo se toca lo propio. Sin sesión es la Edge Function desactivando
  -- un token que Expo declaró muerto (`DeviceNotRegistered`), y ahí sí puede ser de
  -- cualquiera: es la única forma de limpiar un token de un dispositivo que ya no
  -- existe, porque su dueño no va a volver a abrir la app en él.
  if auth.uid() is not null then
    update public.push_tokens
      set is_active = false
      where expo_token = p_expo_token and is_active and user_id = auth.uid();
  else
    update public.push_tokens
      set is_active = false
      where expo_token = p_expo_token and is_active;
  end if;

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function deactivate_push_token(text) from public, anon;
grant execute on function deactivate_push_token(text) to authenticated;


-- ==========================================================================
-- MIGRACION: 20260827001600_close_direct_writes.sql
-- ==========================================================================

-- Krealo Shift — quitar dos escrituras directas que saltaban la auditoría (§11.4, §15)
--
-- EL AGUJERO
-- Auditando las políticas tabla por tabla —la contraparte de lo que se hizo con las
-- funciones en `20260827001400`— aparecieron dos políticas que permitían escribir
-- directamente donde solo debe escribir el servidor:
--
-- 1. `work_sessions_manager_write` (UPDATE). Cualquier gerente podía hacer
--    `update work_sessions set net_minutes = ...` con una petición normal de la app,
--    SALTÁNDOSE `manager_adjust_time`. Y `manager_adjust_time` es lo único que
--    escribe el rastro que exige §11.4: valor anterior, valor nuevo, autor, fecha
--    del servidor, motivo, canal y referencia a la solicitud.
--
--    O sea: se podían cambiar las horas pagadas de una persona sin dejar ni una
--    fila de auditoría. En una revisión laboral, la diferencia entre "corregido con
--    motivo" y "cambiado sin rastro" es toda la diferencia.
--
-- 2. `time_adjustments_insert` (INSERT). Permitía fabricar filas de ajuste: afirmar
--    un cambio que no ocurrió, o ponerle un motivo falso a uno que sí. Un registro
--    de auditoría que el auditado puede escribir a mano no es auditoría.
--
-- POR QUÉ SE PUEDEN QUITAR SIN ROMPER NADA
-- Se comprobó en todo el código: NINGUNA parte del cliente escribe esas dos tablas.
-- Las escribe `manager_adjust_time` y `manager_add_time_event`, que son
-- `security definer` y por tanto corren con los permisos del dueño y no evalúan
-- políticas. El camino legítimo sigue igual; el que se cierra no lo usaba nadie.
--
-- `shift_publications_insert` SÍ SE QUEDA: ahí el panel inserta de verdad al
-- publicar un horario (`src/features/schedules/api.ts`), y el disparador
-- `stamp_shift_publication` sella la versión. Quitarla habría roto la publicación.
-- La diferencia importa: no se trata de cerrar todo, sino de cerrar lo que nadie
-- usa y que permite mentir.

drop policy if exists work_sessions_manager_write on work_sessions;

comment on table work_sessions is
  'Proyeccion recalculable de las jornadas. SOLO la escribe el servidor: '
  'apply_event_to_projection, rebuild_work_session y manager_adjust_time, todas '
  'security definer. NO tiene politica de UPDATE a proposito —la tuvo y era un '
  'agujero—: un update directo cambiaria las horas pagadas sin dejar el rastro que '
  'exige la seccion 11.4. Para corregir, manager_adjust_time.';

drop policy if exists time_adjustments_insert on time_adjustments;

comment on table time_adjustments is
  'Rastro auditable de cada correccion. SOLO lo escribe el servidor desde '
  'manager_adjust_time y manager_add_time_event. NO tiene politica de INSERT a '
  'proposito: un registro de auditoria que el auditado puede escribir a mano no es '
  'auditoria. Se lee, no se escribe.';


-- ==========================================================================
-- DATOS DE DEMOSTRACION (supabase/seed.sql)
-- ==========================================================================

-- Krealo Shift — datos de demostración (especificación §27)
--
-- Todo es ficticio: ninguna persona real, ningún correo real, ninguna contraseña
-- en el repositorio (§22, §27). Los usuarios de auth se crean aparte con
-- `scripts/seed-demo-users.mjs`, que lee la contraseña de una variable de entorno.
--
-- Los horarios son RELATIVOS a `now()`, no fechas fijas: así el demo siempre
-- muestra a alguien trabajando, alguien en descanso, alguien atrasado y alguien
-- sin turno, sin tener que regenerar los datos cada semana.
--
-- Es idempotente: se puede volver a ejecutar sobre la misma base.

begin;

-- ---------------------------------------------------------------------------
-- Identificadores fijos, para que el seed y las pruebas hablen de lo mismo
-- ---------------------------------------------------------------------------

do $$
declare
  v_org_id      uuid := '11111111-1111-4111-8111-111111111111';
  v_loc_main    uuid := '22222222-2222-4222-8222-222222222221';
  v_loc_branch  uuid := '22222222-2222-4222-8222-222222222222';
  v_other_org   uuid := '99999999-9999-4999-8999-999999999999';
  v_other_loc   uuid := '99999999-9999-4999-8999-999999999991';

  v_user_owner    uuid := '33333333-3333-4333-8333-333333333331';
  v_user_manager  uuid := '33333333-3333-4333-8333-333333333332';
  -- Empleada CON cuenta: en P0/P1 los empleados fichan solo con PIN, pero la
  -- especificacion exige probar que un empleado no lee las horas de otro (§15),
  -- y para eso hace falta al menos una cuenta con rol employee.
  v_user_employee uuid := '33333333-3333-4333-8333-333333333333';
  v_user_other    uuid := '33333333-3333-4333-8333-333333333339';

  v_role_lead    uuid := '44444444-4444-4444-8444-444444444441';
  v_role_service uuid := '44444444-4444-4444-8444-444444444442';
  v_role_part    uuid := '44444444-4444-4444-8444-444444444443';

  v_emp_manager uuid := '55555555-5555-4555-8555-555555555550';
  v_emp_working uuid := '55555555-5555-4555-8555-555555555551';
  v_emp_break   uuid := '55555555-5555-4555-8555-555555555552';
  v_emp_late    uuid := '55555555-5555-4555-8555-555555555553';
  v_emp_noshift uuid := '55555555-5555-4555-8555-555555555554';
  v_emp_other   uuid := '55555555-5555-4555-8555-555555555559';

  v_device_main uuid := '66666666-6666-4666-8666-666666666661';

  v_today date := (now() at time zone 'America/Lima')::date;
  v_week_start date;
  v_session_working uuid;
  v_session_break uuid;
  v_session_done uuid;
  v_ev uuid;
  d integer;
  v_shift_id uuid;
begin
  v_week_start := v_today - ((extract(isodow from v_today)::int - 1));

  -- -------------------------------------------------------------------------
  -- Usuarios de auth
  -- -------------------------------------------------------------------------
  -- En Supabase real estos usuarios se crean con la Auth API mediante
  -- `scripts/seed-demo-users.mjs`, para que la contraseña no viva en Git. Aquí
  -- solo aseguramos que la fila exista, porque el resto del seed la referencia.
  insert into auth.users (id, email) values
    (v_user_owner,    'demo-owner@krealoshift.invalid'),
    (v_user_manager,  'demo-manager@krealoshift.invalid'),
    (v_user_employee, 'demo-empleada@krealoshift.invalid'),
    (v_user_other,    'demo-otra-empresa@krealoshift.invalid')
  on conflict (id) do nothing;

  insert into profiles (id, full_name, locale) values
    (v_user_owner,    'Propietaria Demo', 'es-PE'),
    (v_user_manager,  'Gerenta Demo',     'es-PE'),
    (v_user_employee, 'Sofia Demo',       'es-PE'),
    (v_user_other,    'Ajena Demo',       'es-PE')
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- Organización de demostración
  -- -------------------------------------------------------------------------

  insert into organizations (id, name, slug, default_locale, default_timezone, week_starts_on)
  values (v_org_id, 'Krealo Media Demo', 'krealo-media-demo', 'es-PE', 'America/Lima', 1)
  on conflict (id) do nothing;

  -- Segunda organización: existe SOLO para probar que el aislamiento funciona.
  -- Sin ella, una prueba de RLS entre empresas no prueba nada (§15).
  insert into organizations (id, name, slug) values
    (v_other_org, 'Empresa Ajena Demo', 'empresa-ajena-demo')
  on conflict (id) do nothing;

  insert into organization_memberships (organization_id, user_id, role) values
    (v_org_id, v_user_owner, 'owner'),
    (v_org_id, v_user_manager, 'manager'),
    (v_org_id, v_user_employee, 'employee'),
    (v_other_org, v_user_other, 'owner')
  on conflict (organization_id, user_id) do nothing;

  -- -------------------------------------------------------------------------
  -- Ubicaciones, con políticas DISTINTAS para comprobar aislamiento (§27)
  -- -------------------------------------------------------------------------

  insert into locations (id, organization_id, name, address, timezone, settings) values
    (v_loc_main, v_org_id, 'Sede Principal', 'Av. Demo 123, Lima', 'America/Lima',
     jsonb_build_object(
       'pinLength', 6, 'photoEnabled', false, 'photoRetentionDays', 30,
       'earlyClockInMinutes', 10, 'lateGraceMinutes', 5,
       'allowUnscheduledShifts', true, 'timeFormat', '24h',
       'requiredBreakMinutes', 30,
       'dailyOvertimeThresholdMinutes', 480, 'weeklyOvertimeThresholdMinutes', 2880)),
    (v_loc_branch, v_org_id, 'Sucursal Demo', 'Jr. Demo 456, Lima', 'America/Lima',
     jsonb_build_object(
       'pinLength', 4, 'photoEnabled', false, 'photoRetentionDays', 15,
       'earlyClockInMinutes', 0, 'lateGraceMinutes', 0,
       'allowUnscheduledShifts', false, 'timeFormat', '12h',
       'requiredBreakMinutes', 0,
       'dailyOvertimeThresholdMinutes', 540, 'weeklyOvertimeThresholdMinutes', 2400))
  on conflict (id) do nothing;

  insert into locations (id, organization_id, name, timezone) values
    (v_other_loc, v_other_org, 'Sede Ajena', 'America/Lima')
  on conflict (id) do nothing;

  insert into job_roles (id, organization_id, name, color) values
    (v_role_lead,    v_org_id, 'Encargada',           '#7157E8'),
    (v_role_service, v_org_id, 'Atención al cliente', '#2A6FA8'),
    (v_role_part,    v_org_id, 'Part-time',           '#16845B')
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- Personas
  -- -------------------------------------------------------------------------
  -- La gerenta tiene además turnos como empleada: la especificación lo exige (§7).

  insert into employees (id, organization_id, user_id, full_name, preferred_name, status, hire_date) values
    (v_emp_manager, v_org_id, v_user_manager, 'Gerenta Demo',      'Gerenta', 'active', v_today - 400),
    (v_emp_working, v_org_id, v_user_employee, 'Sofía Demo',        'Sofía',   'active', v_today - 300),
    (v_emp_break,   v_org_id, null,           'Marcos Demo',       'Marcos',  'active', v_today - 200),
    (v_emp_late,    v_org_id, null,           'Lucía Demo',        'Lucía',   'active', v_today - 100),
    (v_emp_noshift, v_org_id, null,           'Diego Demo',        'Diego',   'active', v_today - 50)
  on conflict (id) do nothing;

  insert into employees (id, organization_id, full_name, status) values
    (v_emp_other, v_other_org, 'Empleado Ajeno', 'active')
  on conflict (id) do nothing;

  -- Asignaciones. La gerenta administra Sede Principal y NO Sucursal Demo: es lo
  -- que permite probar que no ve la otra tienda (§15 prueba 2).
  insert into employee_location_assignments (employee_id, location_id, can_manage, is_primary) values
    (v_emp_manager, v_loc_main,   true,  true),
    (v_emp_working, v_loc_main,   false, true),
    (v_emp_break,   v_loc_main,   false, true),
    (v_emp_late,    v_loc_main,   false, true),
    (v_emp_noshift, v_loc_branch, false, true),
    -- Sofía trabaja en las dos tiendas: un empleado puede tener varias (§7).
    (v_emp_working, v_loc_branch, false, false),
    (v_emp_other,   v_other_loc,  false, true)
  on conflict (employee_id, location_id) do nothing;

  insert into employee_job_roles (employee_id, job_role_id, is_primary) values
    (v_emp_manager, v_role_lead,    true),
    (v_emp_working, v_role_service, true),
    (v_emp_break,   v_role_service, true),
    (v_emp_late,    v_role_part,    true),
    (v_emp_noshift, v_role_part,    true)
  on conflict (employee_id, job_role_id) do nothing;

  -- PIN de cada empleado. Se generan con la función segura, así que en la base
  -- solo queda el hash bcrypt. Los valores son obvios A PROPÓSITO: son de demo y
  -- nunca deben usarse en producción.
  perform set_employee_pin(v_emp_manager, '246810');
  perform set_employee_pin(v_emp_working, '135791');
  perform set_employee_pin(v_emp_break,   '112233');
  perform set_employee_pin(v_emp_late,    '445566');
  perform set_employee_pin(v_emp_noshift, '7788');   -- Sucursal usa PIN de 4

  -- -------------------------------------------------------------------------
  -- Kiosco de Sede Principal
  -- -------------------------------------------------------------------------
  -- La credencial es un valor de demo conocido para poder probar el flujo; en
  -- producción la emite `activate_kiosk_device` y nunca se escribe a mano.
  -- `offline_key` se pone explicitamente: un dispositivo sin ella no recibe
  -- verificadores offline, y el seed tiene que dejar el kiosco demo en el mismo
  -- estado en que lo dejaria `activate_kiosk_device`. La clave es fija y publica
  -- porque estos son datos de demostracion, no de produccion.
  insert into kiosk_devices
    (id, organization_id, location_id, display_name, device_public_id,
     credential_hash, offline_key, app_version, last_seen_at, created_by)
  values
    (v_device_main, v_org_id, v_loc_main, 'iPad Sede Principal', 'demo-kiosk-main',
     extensions.crypt('demo-credential-sede-principal', extensions.gen_salt('bf', 10)),
     encode(extensions.digest('demo-offline-key-sede-principal', 'sha256'), 'hex'),
     '1.0.0', now(), v_user_owner)
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- Turnos: dos semanas, la anterior y la actual (§27)
  -- -------------------------------------------------------------------------

  for d in -7..6 loop
    -- Sofía: turno de mañana todos los días laborables.
    if extract(isodow from v_week_start + d) between 1 and 5 then
      insert into shifts (organization_id, location_id, employee_id, job_role_id,
                          starts_at, ends_at, timezone, planned_unpaid_break_minutes,
                          status, publication_version, published_at, employee_note)
      values (v_org_id, v_loc_main, v_emp_working, v_role_service,
              ((v_week_start + d)::text || ' 09:00')::timestamp at time zone 'America/Lima',
              ((v_week_start + d)::text || ' 18:00')::timestamp at time zone 'America/Lima',
              'America/Lima', 60, 'published', 1, now() - interval '3 days',
              case when d = 0 then 'Hoy llega pedido nuevo a las 11:00' else null end)
      on conflict do nothing;

      insert into shifts (organization_id, location_id, employee_id, job_role_id,
                          starts_at, ends_at, timezone, planned_unpaid_break_minutes,
                          status, publication_version, published_at)
      values (v_org_id, v_loc_main, v_emp_break, v_role_service,
              ((v_week_start + d)::text || ' 10:00')::timestamp at time zone 'America/Lima',
              ((v_week_start + d)::text || ' 19:00')::timestamp at time zone 'America/Lima',
              'America/Lima', 60, 'published', 1, now() - interval '3 days')
      on conflict do nothing;
    end if;

    -- Lucía: turno de tarde de miércoles a domingo.
    if extract(isodow from v_week_start + d) in (3, 4, 5, 6, 7) then
      insert into shifts (organization_id, location_id, employee_id, job_role_id,
                          starts_at, ends_at, timezone, status, publication_version, published_at)
      values (v_org_id, v_loc_main, v_emp_late, v_role_part,
              ((v_week_start + d)::text || ' 14:00')::timestamp at time zone 'America/Lima',
              ((v_week_start + d)::text || ' 20:00')::timestamp at time zone 'America/Lima',
              'America/Lima', 'published', 1, now() - interval '3 days')
      on conflict do nothing;
    end if;
  end loop;

  -- Un turno en BORRADOR de la semana que viene: sirve para probar que el
  -- empleado no lo ve y el administrador sí (§15).
  insert into shifts (organization_id, location_id, employee_id, job_role_id,
                      starts_at, ends_at, timezone, status, manager_note)
  values (v_org_id, v_loc_main, v_emp_working, v_role_lead,
          ((v_week_start + 8)::text || ' 09:00')::timestamp at time zone 'America/Lima',
          ((v_week_start + 8)::text || ' 18:00')::timestamp at time zone 'America/Lima',
          'America/Lima', 'draft', 'Revisar si necesita cobertura')
  on conflict do nothing;

  insert into shift_publications
    (organization_id, location_id, week_starts_on, publication_version, published_by, published_at)
  values (v_org_id, v_loc_main, v_week_start, 1, v_user_manager, now() - interval '3 days')
  on conflict do nothing;

  -- -------------------------------------------------------------------------
  -- Estados de asistencia de hoy (§27)
  -- -------------------------------------------------------------------------
  -- Se insertan los eventos crudos y se deja que la proyección se construya con
  -- la misma función que usa el kiosco: si el seed construyera las sesiones a
  -- mano, el demo probaría un camino que el producto no recorre.

  -- Sofía: TRABAJANDO desde hace 3 horas.
  if not exists (select 1 from work_sessions where employee_id = v_emp_working and status = 'open') then
    select id into v_shift_id from shifts
      where employee_id = v_emp_working and status = 'published'
        and starts_at::date = v_today limit 1;

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_working, v_loc_main, v_shift_id, 'clock_in', 'kiosk',
            now() - interval '3 hours', 'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);
  end if;

  -- Marcos: EN DESCANSO desde hace 20 minutos.
  if not exists (select 1 from work_sessions where employee_id = v_emp_break and status = 'open') then
    select id into v_shift_id from shifts
      where employee_id = v_emp_break and status = 'published'
        and starts_at::date = v_today limit 1;

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_break, v_loc_main, v_shift_id, 'clock_in', 'kiosk',
            now() - interval '4 hours', 'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             break_type, source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_break, v_loc_main, v_shift_id, 'break_start', 'meal', 'kiosk',
            now() - interval '20 minutes', 'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);
  end if;

  -- Lucía: ATRASADA. Su turno de ayer se cerró tarde y hoy no ha fichado todavía.
  -- Una sesión COMPLETA de ayer, con descanso cerrado.
  if not exists (select 1 from work_sessions where employee_id = v_emp_late) then
    select id into v_shift_id from shifts
      where employee_id = v_emp_late and starts_at::date = v_today - 1 limit 1;

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             source, occurred_at, timezone, idempotency_key, device_id, metadata)
    values (v_org_id, v_emp_late, v_loc_main, v_shift_id, 'clock_in', 'kiosk',
            (( (v_today - 1)::text || ' 14:20')::timestamp at time zone 'America/Lima'),
            'America/Lima', gen_random_uuid(), v_device_main,
            jsonb_build_object('note', 'entrada tardia de demo'))
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             break_type, source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_late, v_loc_main, v_shift_id, 'break_start', 'unpaid', 'kiosk',
            (( (v_today - 1)::text || ' 17:00')::timestamp at time zone 'America/Lima'),
            'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             break_type, source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_late, v_loc_main, v_shift_id, 'break_end', 'unpaid', 'kiosk',
            (( (v_today - 1)::text || ' 17:30')::timestamp at time zone 'America/Lima'),
            'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_late, v_loc_main, v_shift_id, 'clock_out', 'kiosk',
            (( (v_today - 1)::text || ' 20:10')::timestamp at time zone 'America/Lima'),
            'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);
  end if;

  -- Una sesión INCOMPLETA de la gerenta: entró anteayer y nunca marcó salida.
  -- Es el caso que el panel debe señalar como fichaje incompleto (§11.1).
  if not exists (select 1 from work_sessions where employee_id = v_emp_manager) then
    insert into time_events (organization_id, employee_id, location_id, event_type,
                             source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_manager, v_loc_main, 'clock_in', 'kiosk',
            (( (v_today - 2)::text || ' 08:55')::timestamp at time zone 'America/Lima'),
            'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);

    update work_sessions
      set status = 'needs_review', flags = array['missing_clock_out']
      where employee_id = v_emp_manager and status = 'open';
  end if;

  -- Diego queda SIN TURNO y sin fichajes a propósito: es el cuarto estado que
  -- pide la especificación.

  -- -------------------------------------------------------------------------
  -- Solicitudes, periodo y anuncio
  -- -------------------------------------------------------------------------

  insert into time_edit_requests
    (organization_id, employee_id, location_id, target_date, kind, proposed_value, reason, status)
  values
    (v_org_id, v_emp_late, v_loc_main, v_today - 2, 'forgot_clock_out',
     jsonb_build_object('proposedAt', (v_today - 2)::text || 'T20:00:00-05:00'),
     'Olvidé marcar salida, cerré la tienda a las 20:00', 'pending'),
    (v_org_id, v_emp_noshift, v_loc_branch, v_today - 5, 'forgot_clock_in',
     jsonb_build_object('proposedAt', (v_today - 5)::text || 'T09:05:00-05:00'),
     'El iPad estaba sin batería cuando llegué', 'approved')
  on conflict do nothing;

  insert into timesheet_periods (organization_id, location_id, starts_on, ends_on, status)
  values (v_org_id, v_loc_main, v_week_start - 7, v_week_start - 1, 'open')
  on conflict do nothing;

  insert into announcements (organization_id, location_id, title, body, created_by)
  values (v_org_id, v_loc_main, 'Bienvenidos a Krealo Shift',
          'Este es un anuncio de demostración. Ficha tu entrada y salida en el iPad de la tienda.',
          v_user_owner)
  on conflict do nothing;

  insert into notification_preferences (user_id, organization_id) values
    (v_user_owner, v_org_id), (v_user_manager, v_org_id)
  on conflict (user_id, organization_id) do nothing;
end
$$;

commit;
