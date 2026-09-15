-- ---------------------------------------------------------------------------
-- Motivo de las pausas a mitad de jornada
-- ---------------------------------------------------------------------------
--
-- PEDIDO DE ANDREE (2026-09-15)
-- "Normalmente marcas entrada y salida. Pero puede haber un permiso en plena jornada
-- por x motivos, ahí tiene que haber una opción: por permiso, charla, reunión, etc.
-- Así controlas tiempos muertos pero usados por otro motivo."
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO MÁS VALORES EN `break_type`
-- `break_type` (paid / unpaid / meal / other) responde a UNA pregunta de nómina: ¿este
-- rato cuenta como trabajado? El motivo responde a otra completamente distinta: ¿por
-- qué se ausentó? Y no se mapean uno a uno —una reunión es trabajo y se paga, un
-- permiso personal normalmente no, la comida tampoco—, así que meterlos en el mismo
-- enum obliga a migrar el día que alguien quiera una reunión no pagada.
--
-- Separándolos, además, TODA LA MATEMÁTICA DE NÓMINA SIGUE INTACTA: la proyección y
-- `recompute_work_session` suman por `break_type = 'paid'` y no se enteran de que existe
-- el motivo. Esta migración no cambia ni un minuto de lo ya calculado.
--
-- LO QUE NO SE PREGUNTA, Y ES DELIBERADO
-- Los motivos son OPERATIVOS: reunión, permiso, comida. Nunca el detalle personal de
-- por qué alguien pide un permiso. Esto se guarda por persona y con hora, así que la
-- lista tiene que quedarse en lo que el negocio necesita para cuadrar horas y ni un
-- campo más (§22).

create type break_reason as enum (
  'meal',      -- comida
  'rest',      -- descanso corto
  'permit',    -- permiso personal
  'meeting',   -- reunión o charla
  'training',  -- capacitación
  'other'      -- otro, con nota obligatoria en la app
);

-- ---------------------------------------------------------------------------
-- El evento guarda el motivo
-- ---------------------------------------------------------------------------

alter table time_events add column break_reason break_reason;

-- Misma forma que la restricción que ya existe para `break_type`: un motivo en un
-- `clock_in` no significaría nada y sería un dato que alguien acabaría interpretando.
alter table time_events add constraint time_events_break_reason_only_for_breaks check (
  (event_type in ('break_start', 'break_end')) or break_reason is null
);

-- ---------------------------------------------------------------------------
-- El intervalo también, para poder agregar sin recorrer eventos
-- ---------------------------------------------------------------------------
--
-- Se duplica a propósito. `break_intervals` es la proyección que ya usan los reportes y
-- la pantalla de Horas; obligarlas a unir contra `time_events` para saber el motivo
-- convierte un reporte por motivo en un join por cada fila. El dato lo escribe una sola
-- disparador —más abajo— así que no hay dos fuentes que puedan divergir: hay una que
-- escribe y otra que lee.

alter table break_intervals add column break_reason break_reason;

create index break_intervals_reason_idx
  on break_intervals (work_session_id, break_reason)
  where break_reason is not null;

-- ---------------------------------------------------------------------------
-- Y por la ruta sin conexión igual
-- ---------------------------------------------------------------------------
--
-- `submit_offline_time_event` DELEGA en `submit_time_event`, así que aquí solo hay que
-- pasarle el motivo. Si no se hiciera, una pausa registrada sin red llegaría al servidor
-- sin el porqué y el reporte tendría un agujero que nadie sabría explicar: justo en el
-- caso donde menos se puede preguntar después.

drop function submit_offline_time_event(uuid, text, public.time_event_type, uuid,
  timestamptz, bigint, integer, uuid, public.break_type, text);

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
  p_photo_path text default null,
  p_break_reason public.break_reason default null
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
    p_break_reason => p_break_reason,
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
  timestamptz, bigint, integer, uuid, public.break_type, text, public.break_reason)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Que la proyección herede el motivo, pase lo que pase
-- ---------------------------------------------------------------------------
--
-- UN DISPARADOR, Y NO REESCRIBIR LA FUNCIÓN QUE PROYECTA.
--
-- El primer intento fue copiar `apply_event_to_projection` entera y añadirle una línea.
-- Salió mal de la forma más instructiva posible: se copió de memoria una versión que NO
-- EXISTE —con otro nombre y sin `clock_in_event_id`, que una migración posterior había
-- añadido—. El resultado fue una función nueva que nadie llamaba, y una prueba que la
-- llamaba a ella y por tanto no probaba nada del camino real. La prueba de privilegios
-- fue la que lo cantó, al ver una función suelta sin permisos.
--
-- Un disparador no puede caer en eso: son ocho líneas, no repite lógica de nadie y da
-- igual QUIÉN inserte el intervalo.
--
-- Y eso último resultó ser lo importante: `rebuild_work_session` también reconstruye los
-- intervalos desde los eventos. Parcheando solo la proyección, RECONSTRUIR UNA SESIÓN
-- HABRÍA BORRADO EL MOTIVO de todas sus pausas —y reconstruir es justo lo que se hace
-- cuando un gerente corrige una hora—. El disparador cubre las dos rutas y cualquier
-- tercera que aparezca.

create function break_interval_hereda_motivo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo rellena lo que venga vacío: si quien inserta ya trae un motivo, manda él.
  if new.break_reason is null and new.start_event_id is not null then
    select te.break_reason into new.break_reason
    from public.time_events te
    where te.id = new.start_event_id;
  end if;
  return new;
end;
$$;

create trigger break_intervals_hereda_motivo
  before insert on break_intervals
  for each row
  execute function break_interval_hereda_motivo();

revoke all on function break_interval_hereda_motivo() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- El motivo entra CON el evento, porque después ya no se puede
-- ---------------------------------------------------------------------------
--
-- Se intentó primero anotarlo después, con una función pequeña que actualizara la fila.
-- No se puede, y la razón es buena: `time_events` es APPEND-ONLY —un disparador rechaza
-- cualquier UPDATE salvo la ruta de la foto—. Un registro de jornada que se puede
-- reescribir después no sirve como prueba de nada, y esa regla vale mucho más que la
-- comodidad de esta migración.
--
-- Así que hay que recrear `submit_time_event` con un parámetro más. Postgres no deja
-- añadirlo sin recrear la función entera, y añadirlo con `create or replace` crearía una
-- SEGUNDA función con distinta aridad, dejando las llamadas ambiguas. Por eso el `drop`.
--
-- EL CUERPO NO SE ESCRIBIÓ A MANO: se extrajo del archivo de la migración original y se
-- transformó mecánicamente, y la diferencia son tres sitios —el parámetro, la columna y
-- el valor—. Se hace así porque el primer intento de esta migración copió de memoria una
-- función que ni siquiera existía con ese nombre, y produjo una función huérfana que
-- nadie llamaba y una prueba que la probaba a ella en vez de al camino real.

drop function submit_time_event(uuid, uuid, public.time_event_type, uuid, uuid,
  public.break_type, timestamptz, bigint, boolean, text, public.event_source);

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
  p_source public.event_source default 'kiosk',
  p_break_reason public.break_reason default null
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
    break_reason,
    source, occurred_at, occurred_at_device, timezone, idempotency_key,
    device_id, device_sequence, is_offline, photo_path, metadata
  ) values (
    v_device.organization_id, p_employee_id, v_device.location_id, p_shift_id,
    p_event_type,
    case when p_event_type in ('break_start', 'break_end')
         then coalesce(p_break_type, 'unpaid') else null end,
    -- Misma guarda que el tipo: un motivo fuera de una pausa lo rechazaria la
    -- restriccion de la tabla, y es mejor no llegar a intentarlo.
    case when p_event_type in ('break_start', 'break_end')
         then p_break_reason else null end,
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

-- Los mismos privilegios que tenía la firma anterior: la llaman las Edge Functions con
-- `service_role`. `drop` se llevó por delante la revocación, y sin esto queda abierta a
-- `anon` por omisión de Postgres. La prueba de privilegios lo comprueba en cada corrida.
revoke all on function submit_time_event(uuid, uuid, public.time_event_type, uuid, uuid,
  public.break_type, timestamptz, bigint, boolean, text, public.event_source,
  public.break_reason) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Vista de reporte: en qué se va el tiempo que no se trabaja
-- ---------------------------------------------------------------------------
--
-- `security_invoker = true`: la vista respeta las políticas RLS de quien pregunta, en
-- lugar de correr con los permisos de su dueño. Sin esto, cualquiera con acceso a la
-- vista vería las pausas de TODAS las organizaciones.
--
-- Agrega ya por empleado, día y motivo para que el cliente no tenga que bajarse miles
-- de intervalos y sumarlos en un teléfono.

create view break_time_by_reason
with (security_invoker = true)
as
select
  ws.organization_id,
  ws.location_id,
  ws.employee_id,
  (ws.starts_at at time zone l.timezone)::date as work_date,
  coalesce(bi.break_reason, 'other'::public.break_reason) as break_reason,
  bi.break_type,
  count(*)::int as pauses,
  coalesce(sum(bi.duration_minutes), 0)::int as minutes
from public.break_intervals bi
join public.work_sessions ws on ws.id = bi.work_session_id
join public.locations l on l.id = ws.location_id
where bi.duration_minutes is not null
group by 1, 2, 3, 4, 5, 6;

comment on view break_time_by_reason is
  'Minutos de pausa por empleado, dia y motivo. Responde a "en que se va el tiempo que no se trabaja" sin recorrer intervalos en el cliente.';

grant select on break_time_by_reason to authenticated;
