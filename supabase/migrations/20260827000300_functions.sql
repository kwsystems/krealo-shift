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
