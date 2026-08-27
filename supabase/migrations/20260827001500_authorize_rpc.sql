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
