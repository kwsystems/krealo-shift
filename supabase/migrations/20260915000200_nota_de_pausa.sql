-- ---------------------------------------------------------------------------
-- Una pausa por «Otro» tiene que explicarse
-- ---------------------------------------------------------------------------
--
-- POR QUE
-- «Otro» es la opcion que menos hace pensar, asi que sin nada que la frene acaba
-- siendo el cajon donde cae la mitad de los registros. Y un reporte de tiempos
-- muertos donde el 40% es «otro» no responde ninguna pregunta: es la forma mas
-- educada de no saber en que se va el tiempo. La nota es lo unico que convierte ese
-- cajon en informacion.
--
-- DONDE SE OBLIGA, Y POR QUE AHI
-- En el servidor, dentro de `submit_time_event`. El kiosco tambien lo pide —y ahi es
-- donde se resuelve bien, con el teclado delante—, pero el kiosco no es la unica via:
-- esta la cola offline, estan las Edge Functions y esta cualquier cliente que se
-- escriba manana. Una regla que solo vive en una pantalla es una regla que ya tiene un
-- agujero.
--
-- SOLO SE EXIGE AL EMPEZAR LA PAUSA. Al volver no se pregunta nada, y exigirla ahi
-- dejaria a alguien sin poder reanudar su jornada por un campo de texto.

alter table time_events add column if not exists break_note text;

comment on column time_events.break_note is
  'Explicacion escrita por quien se ausenta. Obligatoria cuando break_reason = other.';

-- La nota solo tiene sentido en una pausa. La misma guarda que ya tiene el motivo: sin
-- ella, una entrada o una salida podrian llevar texto libre y nadie sabria que significa.
alter table time_events drop constraint if exists time_events_break_note_solo_en_pausa;
alter table time_events add constraint time_events_break_note_solo_en_pausa
  check (break_note is null or event_type in ('break_start', 'break_end'));

-- Y un limite de longitud, que no es burocracia: sin el, este campo es la unica entrada
-- de texto libre sin tope de toda la app, y va a parar a una tabla append-only que nadie
-- puede editar despues.
alter table time_events drop constraint if exists time_events_break_note_largo;
alter table time_events add constraint time_events_break_note_largo
  check (break_note is null or char_length(break_note) <= 500);

alter table break_intervals add column if not exists break_note text;

comment on column break_intervals.break_note is
  'La nota del evento que abrio la pausa, copiada por break_interval_hereda_motivo.';

-- ---------------------------------------------------------------------------
-- El disparador que ya heredaba el motivo, hereda tambien la nota
-- ---------------------------------------------------------------------------
--
-- Va en el MISMO disparador y no en uno nuevo por la razon que lo creo: la proyeccion
-- reconstruye los intervalos desde los eventos, y reconstruir es justo lo que pasa
-- cuando un gerente corrige una hora. Si la nota se copiara solo en la insercion
-- original, corregir una hora borraria la explicacion de la pausa.

create or replace function break_interval_hereda_motivo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo rellena lo que venga vacio: si quien inserta ya trae un motivo, manda el.
  if new.break_reason is null and new.start_event_id is not null then
    select te.break_reason into new.break_reason
    from public.time_events te
    where te.id = new.start_event_id;
  end if;

  if new.break_note is null and new.start_event_id is not null then
    select te.break_note into new.break_note
    from public.time_events te
    where te.id = new.start_event_id;
  end if;

  return new;
end;
$$;

revoke all on function break_interval_hereda_motivo() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- `submit_time_event` con un parametro mas
-- ---------------------------------------------------------------------------
--
-- Mismo procedimiento que la migracion del motivo, y por la misma razon: Postgres no
-- deja anadir un parametro sin recrear la funcion, y hacerlo con `create or replace`
-- crearia una SEGUNDA funcion de distinta aridad dejando las llamadas ambiguas.
--
-- EL CUERPO NO SE ESCRIBIO A MANO: se extrajo del archivo de la migracion anterior y se
-- transformo mecanicamente en cuatro sitios —el parametro, la validacion, la columna y
-- el valor—. Escribir de memoria una funcion de doscientas lineas es como se produjo, en
-- el primer intento de aquella migracion, una funcion huerfana que nadie llamaba.

drop function submit_time_event(uuid, uuid, public.time_event_type, uuid, uuid,
  public.break_type, timestamptz, bigint, boolean, text, public.event_source,
  public.break_reason);

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
  p_break_reason public.break_reason default null,
  p_break_note text default null
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

  -- 6. «Otro» sin explicacion no es un motivo
  --
  -- Se valida EN EL SERVIDOR y no solo en el kiosco, porque el kiosco no es la unica
  -- via: esta la cola offline, estan las Edge Functions y esta cualquier cliente que se
  -- escriba manana. Una regla que solo vive en una pantalla es una regla que ya tiene
  -- un agujero.
  --
  -- Solo en `break_start`: al VOLVER de la pausa no se vuelve a preguntar nada, y
  -- exigir la nota ahi dejaria a alguien sin poder reanudar su jornada.
  if p_event_type = 'break_start'
     and p_break_reason = 'other'
     and nullif(btrim(coalesce(p_break_note, '')), '') is null then
    raise exception 'Una pausa por «Otro» necesita una nota que explique el motivo.'
      using errcode = 'check_violation';
  end if;

  insert into public.time_events (
    organization_id, employee_id, location_id, shift_id, event_type, break_type,
    break_reason, break_note,
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
    -- La nota se guarda RECORTADA, y una cadena de solo espacios se guarda como null:
    -- asi «   » no cuenta como explicacion. Que sea obligatoria se comprueba arriba,
    -- antes de escribir nada.
    case when p_event_type in ('break_start', 'break_end')
         then nullif(btrim(p_break_note), '') else null end,
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

-- Los mismos privilegios que tenia la firma anterior: la llaman las Edge Functions con
-- `service_role`. El `drop` se llevo por delante la revocacion, y sin esto queda abierta
-- a `anon` por omision de Postgres. La prueba de privilegios lo comprueba en cada corrida.
revoke all on function submit_time_event(uuid, uuid, public.time_event_type, uuid, uuid,
  public.break_type, timestamptz, bigint, boolean, text, public.event_source,
  public.break_reason, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Y la version offline, que delega en ella
-- ---------------------------------------------------------------------------
--
-- Delega, asi que solo hay que dejar pasar el parametro. Pero hay que recrearla igual:
-- si se quedara con la firma vieja, llamaria a `submit_time_event` sin nota y una pausa
-- por «Otro» sincronizada desde la cola la rechazaria el servidor con un error que el
-- iPad no sabria explicar. La cola es justo el camino que mas tarda en descubrirse roto.

-- La firma se copio del `create` de la migracion anterior, en su orden exacto, y no de
-- memoria: escribirla a ojo fallo con «function ... does not exist» porque los
-- parametros no van en el orden que uno supondria (el turno va DESPUES de la version del
-- PIN, no junto al resto de datos del evento).
drop function submit_offline_time_event(uuid, text, public.time_event_type, uuid,
  timestamptz, bigint, integer, uuid, public.break_type, text, public.break_reason);

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
  p_break_reason public.break_reason default null,
  p_break_note text default null
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
    p_break_note => p_break_note,
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
  timestamptz, bigint, integer, uuid, public.break_type, text, public.break_reason, text)
  from public, anon, authenticated;
