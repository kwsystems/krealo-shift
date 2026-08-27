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
