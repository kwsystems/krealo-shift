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
