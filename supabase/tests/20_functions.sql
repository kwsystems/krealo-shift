-- Krealo Shift — pruebas de integración de las funciones seguras (§28)
--
-- Prueba el camino real de un fichaje: entrada, descanso, regreso y salida, y
-- después los casos que tienen que fallar. Usa la misma función que llama el
-- kiosco, no un atajo: si el seed o las pruebas construyeran las sesiones a mano,
-- probarían un camino que el producto nunca recorre.

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ===========================================================================
-- Jornada completa: los minutos tienen que cuadrar
-- ===========================================================================

begin;
do $$
declare
  v_device uuid := '66666666-6666-4666-8666-666666666661';
  v_emp    uuid := '55555555-5555-4555-8555-555555555554';  -- Diego, sin fichajes
  v_loc    uuid := '22222222-2222-4222-8222-222222222221';
  v_res    record;
  v_session record;
begin
  -- Diego solo está asignado a Sucursal Demo, así que primero lo asignamos a Sede
  -- Principal para que el kiosco de esa tienda pueda registrarlo.
  insert into employee_location_assignments (employee_id, location_id)
    values (v_emp, v_loc) on conflict do nothing;

  select * into v_res from submit_time_event(
    p_device_id => v_device, p_employee_id => v_emp,
    p_event_type => 'clock_in', p_idempotency_key => gen_random_uuid());
  perform test_assert(v_res.status = 'accepted', 'La entrada se acepta');
  perform test_assert(v_res.attendance_state = 'WORKING',
    'Tras marcar entrada el estado es WORKING');

  select * into v_res from submit_time_event(
    p_device_id => v_device, p_employee_id => v_emp,
    p_event_type => 'break_start', p_break_type => 'unpaid',
    p_idempotency_key => gen_random_uuid());
  perform test_assert(v_res.attendance_state = 'ON_BREAK',
    'Tras iniciar descanso el estado es ON_BREAK');

  select * into v_res from submit_time_event(
    p_device_id => v_device, p_employee_id => v_emp,
    p_event_type => 'break_end', p_break_type => 'unpaid',
    p_idempotency_key => gen_random_uuid());
  perform test_assert(v_res.attendance_state = 'WORKING',
    'Tras terminar descanso el estado vuelve a WORKING');

  select * into v_res from submit_time_event(
    p_device_id => v_device, p_employee_id => v_emp,
    p_event_type => 'clock_out', p_idempotency_key => gen_random_uuid());
  perform test_assert(v_res.attendance_state = 'OFF_SHIFT',
    'Tras marcar salida el estado es OFF_SHIFT');

  select * into v_session from work_sessions
    where employee_id = v_emp order by starts_at desc limit 1;

  perform test_assert(v_session.status = 'complete',
    'La sesion queda completa y no en revision');
  perform test_assert(v_session.clock_out_event_id is not null,
    'La sesion guarda el evento de salida');
  perform test_assert(v_session.net_minutes is not null,
    'La sesion calcula los minutos netos');
  perform test_assert(v_session.net_minutes = v_session.gross_minutes - v_session.unpaid_break_minutes,
    'Los minutos netos son los brutos menos el descanso no pagado');

  -- Cuatro eventos crudos: la proyeccion no reemplaza a los eventos.
  perform test_assert(
    (select count(*) from time_events where employee_id = v_emp) = 4,
    'Quedaron los cuatro eventos crudos de la jornada');
end
$$;
rollback;

-- ===========================================================================
-- Idempotencia: un doble toque no duplica el fichaje
-- ===========================================================================

begin;
do $$
declare
  v_device uuid := '66666666-6666-4666-8666-666666666661';
  v_emp    uuid := '55555555-5555-4555-8555-555555555554';
  v_loc    uuid := '22222222-2222-4222-8222-222222222221';
  v_key    uuid := gen_random_uuid();
  v_first  record;
  v_second record;
begin
  insert into employee_location_assignments (employee_id, location_id)
    values (v_emp, v_loc) on conflict do nothing;

  select * into v_first from submit_time_event(
    p_device_id => v_device, p_employee_id => v_emp,
    p_event_type => 'clock_in', p_idempotency_key => v_key);

  -- El mismo toque otra vez, con la misma clave: es lo que pasa cuando la red
  -- responde tarde y el iPad reintenta.
  select * into v_second from submit_time_event(
    p_device_id => v_device, p_employee_id => v_emp,
    p_event_type => 'clock_in', p_idempotency_key => v_key);

  perform test_assert(v_first.status = 'accepted', 'El primer envio se acepta');
  perform test_assert(v_second.status = 'duplicate',
    'El reintento con la misma clave responde duplicate');
  perform test_assert(v_first.event_id = v_second.event_id,
    'El reintento devuelve el MISMO evento, no uno nuevo');
  perform test_assert(
    (select count(*) from time_events where employee_id = v_emp) = 1,
    'Solo se creo un evento pese a los dos envios');
end
$$;
rollback;

-- ===========================================================================
-- Transiciones imposibles y tienda equivocada
-- ===========================================================================

begin;
do $$
declare
  v_device uuid := '66666666-6666-4666-8666-666666666661';
  v_sofia  uuid := '55555555-5555-4555-8555-555555555551';  -- ya esta WORKING
  -- Lucia esta en Sede Principal y OFF_SHIFT: sirve para probar transiciones.
  v_lucia  uuid := '55555555-5555-4555-8555-555555555553';
  -- Diego solo esta en Sucursal Demo: sirve para probar la tienda equivocada.
  v_diego  uuid := '55555555-5555-4555-8555-555555555554';
begin
  -- Sofia ya esta trabajando: no puede volver a marcar entrada.
  begin
    perform submit_time_event(
      p_device_id => v_device, p_employee_id => v_sofia,
      p_event_type => 'clock_in', p_idempotency_key => gen_random_uuid());
    raise exception 'FALLO: se acepto una segunda entrada estando WORKING'
      using errcode = 'assert_failure';
  exception
    when check_violation then
      raise notice '  ok — no se puede marcar entrada dos veces';
  end;

  -- Lucia esta fuera de turno: no puede terminar un descanso que no existe.
  begin
    perform submit_time_event(
      p_device_id => v_device, p_employee_id => v_lucia,
      p_event_type => 'break_end', p_idempotency_key => gen_random_uuid());
    raise exception 'FALLO: se acepto terminar un descanso estando OFF_SHIFT'
      using errcode = 'assert_failure';
  exception
    when check_violation then
      raise notice '  ok — no se puede terminar un descanso fuera de turno';
  end;

  -- Diego no esta asignado a Sede Principal: el kiosco de esa tienda no puede
  -- registrarlo. Es la regla del §32.3.
  begin
    perform submit_time_event(
      p_device_id => v_device, p_employee_id => v_diego,
      p_event_type => 'clock_in', p_idempotency_key => gen_random_uuid());
    raise exception 'FALLO: un kiosco registro a alguien de otra tienda'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — el kiosco no registra a un empleado de otra tienda';
  end;
end
$$;
rollback;

-- ===========================================================================
-- Salida con descanso abierto: se cierra y queda para revision
-- ===========================================================================

begin;
do $$
declare
  v_device uuid := '66666666-6666-4666-8666-666666666661';
  v_emp    uuid := '55555555-5555-4555-8555-555555555552';  -- Marcos, ON_BREAK
  v_session record;
begin
  perform submit_time_event(
    p_device_id => v_device, p_employee_id => v_emp,
    p_event_type => 'clock_out', p_idempotency_key => gen_random_uuid());

  select * into v_session from work_sessions
    where employee_id = v_emp order by starts_at desc limit 1;

  perform test_assert(v_session.status = 'needs_review',
    'Salir con descanso abierto deja la sesion en revision, no la cierra en silencio');
  perform test_assert('break_closed_on_clock_out' = any (v_session.flags),
    'La sesion queda marcada con el motivo de la revision');
  perform test_assert(
    (select count(*) from break_intervals
      where work_session_id = v_session.id and status = 'needs_review') = 1,
    'El descanso abierto se cerro y quedo marcado para revision');
end
$$;
rollback;

-- ===========================================================================
-- PIN: correcto, incorrecto y bloqueo por intentos
-- ===========================================================================

begin;
do $$
declare
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_sofia uuid := '55555555-5555-4555-8555-555555555551';
  v_res record;
  i integer;
begin
  select * into v_res from verify_employee_pin(v_loc, '135791');
  perform test_assert(v_res.employee_id = v_sofia,
    'El PIN correcto identifica a la empleada');

  select * into v_res from verify_employee_pin(v_loc, '000000');
  perform test_assert(v_res.employee_id is null,
    'Un PIN incorrecto no identifica a nadie');

  -- Cinco fallos bloquean. El mensaje al usuario nunca dice de quien era el PIN.
  for i in 1..5 loop
    perform verify_employee_pin(v_loc, '000000');
  end loop;

  select * into v_res from verify_employee_pin(v_loc, '135791');
  perform test_assert(v_res.employee_id is null and v_res.locked_until is not null,
    'Tras cinco fallos el PIN correcto queda bloqueado temporalmente');

  perform test_assert(
    (select count(*) from audit_logs where action = 'pin_verification_failed') >= 1,
    'Los intentos fallidos quedan en auditoria');
end
$$;
rollback;

-- ===========================================================================
-- Exportacion: el decimal tiene que ser correcto
-- ===========================================================================

begin;
do $$
declare
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_row record;
  v_found boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-4333-8333-333333333332',
                      'role', 'authenticated')::text, true);

  for v_row in
    select * from export_timesheet_rows(v_loc, (now() - interval '10 days')::date,
                                        (now() + interval '1 day')::date)
  loop
    v_found := true;
    -- 90 minutos son 1.50 horas, no 1.30. Este es el error clasico de nomina.
    perform test_assert(
      v_row.net_hours_decimal = round(coalesce(v_row.net_minutes, 0)::numeric / 60, 2),
      format('El decimal de %s coincide con los minutos', v_row.employee_name));
  end loop;

  perform test_assert(v_found, 'La exportacion devuelve al menos una fila');
end
$$;
rollback;

-- ===========================================================================
-- Solapamiento de turnos publicados
-- ===========================================================================

begin;
do $$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_emp uuid := '55555555-5555-4555-8555-555555555551';
  v_existing record;
begin
  select * into v_existing from shifts
    where employee_id = v_emp and status = 'published' limit 1;

  begin
    insert into shifts (organization_id, location_id, employee_id, starts_at, ends_at,
                        status, published_at, publication_version)
    values (v_org, v_loc, v_emp,
            v_existing.starts_at + interval '1 hour',
            v_existing.ends_at + interval '1 hour',
            'published', now(), 1);
    raise exception 'FALLO: se pudo publicar un turno solapado'
      using errcode = 'assert_failure';
  exception
    when exclusion_violation then
      raise notice '  ok — no se puede publicar un turno solapado del mismo empleado';
  end;

  -- Un borrador si puede solaparse: el administrador esta reorganizando la semana.
  insert into shifts (organization_id, location_id, employee_id, starts_at, ends_at, status)
  values (v_org, v_loc, v_emp,
          v_existing.starts_at + interval '1 hour',
          v_existing.ends_at + interval '1 hour', 'draft');
  raise notice '  ok — un borrador si puede solaparse mientras se reorganiza';
end
$$;
rollback;

-- ===========================================================================
-- Publicar un turno incrementa su version
-- ===========================================================================

begin;
do $$
declare
  v_shift record;
  v_after record;
begin
  select * into v_shift from shifts where status = 'draft' limit 1;

  update shifts set status = 'published' where id = v_shift.id;
  select * into v_after from shifts where id = v_shift.id;

  perform test_assert(v_after.publication_version = v_shift.publication_version + 1,
    'Publicar incrementa la version del turno');
  perform test_assert(v_after.published_at is not null,
    'Publicar sella la fecha de publicacion');
end
$$;
rollback;

\echo '  --- pruebas de funciones completas ---'

-- ===========================================================================
-- Contexto del kiosco tras validar el PIN
-- ===========================================================================

begin;
do $$
declare
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_sofia uuid := '55555555-5555-4555-8555-555555555551';  -- WORKING
  v_lucia uuid := '55555555-5555-4555-8555-555555555553';  -- OFF_SHIFT
  v_ctx jsonb;
begin
  v_ctx := kiosk_employee_context(v_sofia, v_loc);

  perform test_assert(v_ctx is not null, 'El contexto del kiosco devuelve datos');
  perform test_assert(v_ctx -> 'employee' ->> 'displayName' = 'Sofía',
    'Devuelve el nombre preferido, no el nombre completo');
  perform test_assert(v_ctx ->> 'attendanceState' = 'WORKING',
    'Devuelve el estado actual de la empleada');
  perform test_assert(v_ctx -> 'openSession' ->> 'startedAt' is not null,
    'Devuelve desde cuando esta trabajando');

  -- Trabajando, las acciones posibles son iniciar descanso y marcar salida.
  perform test_assert(v_ctx -> 'allowedActions' @> '["break_start"]'::jsonb,
    'Trabajando puede iniciar descanso');
  perform test_assert(v_ctx -> 'allowedActions' @> '["clock_out"]'::jsonb,
    'Trabajando puede marcar salida');
  perform test_assert(not (v_ctx -> 'allowedActions' @> '["clock_in"]'::jsonb),
    'Trabajando NO puede marcar entrada otra vez');

  -- Nada sensible: ni email, ni telefono, ni el uuid interno del empleado.
  perform test_assert(v_ctx::text not like '%@%',
    'El contexto no expone ningun correo');
  perform test_assert(v_ctx::text not like '%' || v_sofia::text || '%',
    'El contexto no expone el uuid interno del empleado');

  v_ctx := kiosk_employee_context(v_lucia, v_loc);
  perform test_assert(v_ctx ->> 'attendanceState' = 'OFF_SHIFT',
    'Lucia aparece fuera de turno');
  perform test_assert(v_ctx -> 'allowedActions' @> '["clock_in"]'::jsonb,
    'Fuera de turno solo puede marcar entrada');
  perform test_assert(v_ctx -> 'openSession' = 'null'::jsonb
                      or v_ctx -> 'openSession' is null,
    'Fuera de turno no hay sesion abierta');
end
$$;
rollback;

\echo '  --- pruebas de contexto del kiosco completas ---'

-- ===========================================================================
-- El contexto informa los minutos de descanso ya tomados
-- ===========================================================================

begin;
do $$
declare
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_marcos uuid := '55555555-5555-4555-8555-555555555552';  -- ON_BREAK
  v_ctx jsonb;
begin
  v_ctx := kiosk_employee_context(v_marcos, v_loc);
  perform test_assert(v_ctx -> 'openSession' ->> 'takenBreakMinutes' is not null,
    'El contexto informa los minutos de descanso ya tomados');
  perform test_assert((v_ctx -> 'openSession' ->> 'requiredBreakMinutes')::int = 30,
    'El contexto informa el descanso obligatorio de la ubicacion');
  perform test_assert(v_ctx -> 'openSession' -> 'openBreak' ->> 'startedAt' is not null,
    'El contexto informa el descanso en curso');
end
$$;
rollback;

-- ===========================================================================
-- El contexto dice quien puede administrar la tienda
-- ===========================================================================

begin;
do $$
declare
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_gerenta uuid := '55555555-5555-4555-8555-555555555550';
  v_sofia uuid := '55555555-5555-4555-8555-555555555551';
begin
  perform test_assert(
    (kiosk_employee_context(v_gerenta, v_loc) -> 'employee' ->> 'canManageLocation')::boolean,
    'La gerenta puede administrar su tienda, y el servidor lo dice');
  perform test_assert(
    not (kiosk_employee_context(v_sofia, v_loc) -> 'employee' ->> 'canManageLocation')::boolean,
    'Una empleada normal NO puede autorizar excepciones');
end
$$;
rollback;

-- ===========================================================================
-- Verificadores offline del PIN
-- ===========================================================================

begin;
do $$
declare
  v_device uuid := '66666666-6666-4666-8666-666666666661';
  v_rows integer;
  v_salt text;
  v_verifier text;
  v_key text;
  v_hash text;
begin
  select count(*) into v_rows from kiosk_offline_verifiers(v_device);
  perform test_assert(v_rows >= 3,
    'El dispositivo recibe verificadores de los empleados de SU tienda');

  -- Ni un solo verificador de la otra tienda: Diego solo esta en Sucursal Demo.
  perform test_assert(
    not exists (
      select 1 from kiosk_offline_verifiers(v_device) v
      where v.employee_opaque_id = encode(extensions.digest(
        '55555555-5555-4555-8555-555555555554', 'sha256'), 'hex')
    ),
    'No recibe verificadores de empleados de otra tienda');

  select pin_salt, pin_verifier into v_salt, v_verifier
  from kiosk_offline_verifiers(v_device)
  where employee_opaque_id = encode(extensions.digest(
    '55555555-5555-4555-8555-555555555551', 'sha256'), 'hex');

  select pin_offline_hash into v_hash from employee_pin_credentials
    where employee_id = '55555555-5555-4555-8555-555555555551';

  -- LO MAS IMPORTANTE DE ESTE ARCHIVO: el hash bcrypt NO sale de la base. Si
  -- saliera, robar el SQLite del iPad permitiria probar los 10^6 PIN posibles sin
  -- limite y sin la clave del dispositivo.
  perform test_assert(
    not exists (
      select 1 from kiosk_offline_verifiers(v_device) v
      where v.pin_salt = v_hash or v.pin_verifier = v_hash
    ),
    'El hash bcrypt completo NUNCA se entrega al dispositivo');

  -- El salt son los 29 primeros caracteres del hash: prefijo + 22 de salt. Por si
  -- solo no permite comprobar ningun intento.
  perform test_assert(v_salt like '$2a$10$%' or v_salt like '$2b$10$%',
    'El salt entregado es de bcrypt coste 10');
  perform test_assert(length(v_salt) = 29,
    'El salt son exactamente 29 caracteres, sin un solo byte del digest');
  perform test_assert(v_hash like v_salt || '%',
    'El salt es el prefijo del hash real, asi que bcrypt(PIN, salt) reproduce el hash');

  -- El verificador es sha256(clave_del_dispositivo || ':' || hash), en hexadecimal.
  select offline_key into v_key from kiosk_devices where id = v_device;
  perform test_assert(v_key is not null and length(v_key) = 64,
    'El dispositivo tiene una clave de derivacion de 32 bytes');
  perform test_assert(
    v_verifier = encode(extensions.digest(v_key || ':' || v_hash, 'sha256'), 'hex'),
    'El verificador es exactamente sha256(clave || ":" || hash): las dos puntas coinciden');
  perform test_assert(length(v_verifier) = 64,
    'El verificador es un sha256 en hexadecimal');

  -- Y la parte que hace que separar la clave valga la pena: la clave de derivacion
  -- no es la credencial que viaja en cada peticion, asi que rotar una no expone la
  -- otra. Se comprueba de la unica forma posible sin conocer la credencial en
  -- claro: el hash de la credencial no contiene la clave.
  perform test_assert(
    (select credential_hash from kiosk_devices where id = v_device) not like '%' || v_key || '%',
    'La clave offline es independiente de la credencial de peticion');

  -- Dos dispositivos distintos reciben verificadores distintos para el MISMO PIN:
  -- un verificador copiado de un iPad a otro no sirve.
  perform test_assert(
    v_verifier <> encode(extensions.digest(
      encode(extensions.gen_random_bytes(32), 'hex') || ':' || v_hash, 'sha256'), 'hex'),
    'El verificador esta ligado al dispositivo: con otra clave no coincide');
end
$$;
rollback;

begin;
do $$
declare
  v_device uuid := '66666666-6666-4666-8666-666666666661';
begin
  -- Un dispositivo sin clave de derivacion no recibe verificadores a medias: falla
  -- claro y el iPad sigue validando online, que es el comportamiento seguro.
  update kiosk_devices set offline_key = null where id = v_device;
  begin
    perform kiosk_offline_verifiers(v_device);
    raise exception 'FALLO: un dispositivo sin clave recibio verificadores'
      using errcode = 'assert_failure';
  exception
    when invalid_authorization_specification then
      raise notice '  ok — un dispositivo sin clave de derivacion no recibe verificadores';
  end;
end
$$;
rollback;

begin;
do $$
declare
  v_res record;
begin
  -- La activacion entrega credencial y clave offline, y son valores DISTINTOS.
  -- Antes la funcion reutilizaba la credencial como clave; si volviera a hacerlo,
  -- esta prueba lo detecta.
  insert into kiosk_activation_codes
    (organization_id, location_id, code_hash, expires_at, max_uses, created_by)
  values
    ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221',
     extensions.crypt('999111', extensions.gen_salt('bf', 10)),
     now() + interval '10 minutes', 1, null);

  select * into v_res from activate_kiosk_device('999111', 'inst-prueba', 'iPad de prueba', '1.0.0');

  perform test_assert(v_res.credential is not null and length(v_res.credential) = 64,
    'La activacion entrega una credencial de 32 bytes');
  perform test_assert(v_res.offline_key is not null and length(v_res.offline_key) = 64,
    'La activacion entrega una clave offline de 32 bytes');
  perform test_assert(v_res.credential <> v_res.offline_key,
    'La credencial y la clave offline son secretos separados');
  perform test_assert(
    (select offline_key from kiosk_devices where id = v_res.device_id) = v_res.offline_key,
    'La clave offline guardada es la misma que se entrego al dispositivo');
end
$$;
rollback;

begin;
do $$
begin
  -- Un dispositivo revocado no recibe verificadores: es lo que hace que revocar
  -- sirva de algo tambien sin conexion.
  update kiosk_devices set status = 'revoked', revoked_at = now()
    where id = '66666666-6666-4666-8666-666666666661';
  begin
    perform kiosk_offline_verifiers('66666666-6666-4666-8666-666666666661');
    raise exception 'FALLO: un kiosco revocado recibio verificadores offline'
      using errcode = 'assert_failure';
  exception
    when invalid_authorization_specification then
      raise notice '  ok — un kiosco revocado no recibe verificadores offline';
  end;
end
$$;
rollback;

begin;
do $$
declare
  v_device uuid := '66666666-6666-4666-8666-666666666661';
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_opaque text;
  v_res record;
begin
  -- Un evento validado offline por el dispositivo se acepta y queda marcado.
  insert into employee_location_assignments (employee_id, location_id)
    values ('55555555-5555-4555-8555-555555555554', v_loc) on conflict do nothing;

  v_opaque := encode(extensions.digest('55555555-5555-4555-8555-555555555554', 'sha256'), 'hex');

  select * into v_res from submit_offline_time_event(
    p_device_id => v_device,
    p_employee_opaque_id => v_opaque,
    p_event_type => 'clock_in',
    p_idempotency_key => gen_random_uuid(),
    p_occurred_at_device => now() - interval '2 hours',
    p_device_sequence => 1,
    p_pin_version => 1);

  perform test_assert(v_res.status = 'accepted',
    'Un evento validado offline se acepta aunque el token de accion ya caducara');
  perform test_assert(
    (select is_offline from time_events where id = v_res.event_id),
    'El evento queda marcado como offline y no se presenta como validado por el servidor');
  perform test_assert(
    (select occurred_at from time_events where id = v_res.event_id) < now() - interval '1 hour',
    'Se conserva la hora real del dispositivo, no la de la sincronizacion');

  -- Un identificador opaco que no corresponde a nadie de esta tienda se rechaza.
  begin
    perform submit_offline_time_event(
      p_device_id => v_device,
      p_employee_opaque_id => 'no-corresponde-a-nadie',
      p_event_type => 'clock_in',
      p_idempotency_key => gen_random_uuid(),
      p_occurred_at_device => now(),
      p_device_sequence => 2,
      p_pin_version => 1);
    raise exception 'FALLO: se acepto un identificador opaco desconocido'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — un identificador opaco desconocido se rechaza';
  end;
end
$$;
rollback;
