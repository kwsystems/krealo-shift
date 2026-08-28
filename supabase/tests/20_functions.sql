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

-- ===========================================================================
-- Fotos de fichaje: retencion y excepcion append-only
-- ===========================================================================

begin;
do $$
declare
  v_event uuid;
  v_path text;
begin
  select id into v_event from time_events
    where employee_id = '55555555-5555-4555-8555-555555555551'
    order by occurred_at limit 1;

  v_path := attendance_photo_path(v_event);

  -- La ruta empieza por la organizacion y sigue por la ubicacion: de eso dependen
  -- las politicas de storage.objects, que solo saben mirar segmentos del nombre.
  perform test_assert(
    v_path like '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222221/%',
    'La ruta de la foto empieza por organizacion y ubicacion');
  perform test_assert(v_path like '%.jpg',
    'La ruta de la foto termina en .jpg');
  perform test_assert(v_path like '%' || v_event::text || '.jpg',
    'La ruta lleva el id del evento, asi que dos eventos nunca colisionan');
end
$$;
rollback;

begin;
do $$
declare
  v_event uuid;
begin
  select id into v_event from time_events
    where employee_id = '55555555-5555-4555-8555-555555555551'
    order by occurred_at limit 1;

  -- Se simula que ese evento tiene foto. Hace falta saltarse el disparador para
  -- ponerla, porque poner una foto donde no habia esta prohibido: en produccion la
  -- foto se escribe al crear el evento, no despues.
  -- Poner la foto ya esta permitido: es lo que hace la Edge Function despues de
  -- subir el archivo, para que la columna no apunte a un objeto inexistente.
  update time_events set photo_path = attendance_photo_path(v_event) where id = v_event;
  perform test_assert(
    (select photo_path from time_events where id = v_event) is not null,
    'Se puede poner la ruta de la foto despues de subir el archivo');

  -- LO QUE LA EXCEPCION PERMITE TAMBIEN: borrarla, que es lo que necesita la purga.
  update time_events set photo_path = null where id = v_event;
  perform test_assert(
    (select photo_path from time_events where id = v_event) is null,
    'Se puede borrar la foto de un evento, que es lo que necesita la purga');
end
$$;
rollback;

begin;
do $$
declare
  v_event uuid;
begin
  select id into v_event from time_events
    where employee_id = '55555555-5555-4555-8555-555555555551'
    order by occurred_at limit 1;

  -- LO QUE LA EXCEPCION SIGUE PROHIBIENDO. Esto es la mitad importante: si la
  -- excepcion fuera mas ancha de lo necesario, se podrian reescribir horas
  -- trabajadas sin dejar rastro.
  begin
    update time_events set occurred_at = now() where id = v_event;
    raise exception 'FALLO: se pudo cambiar la hora de un evento'
      using errcode = 'assert_failure';
  exception
    when restrict_violation then
      raise notice '  ok — no se puede cambiar la hora de un evento';
  end;

  begin
    update time_events set event_type = 'clock_out' where id = v_event;
    raise exception 'FALLO: se pudo cambiar el tipo de un evento'
      using errcode = 'assert_failure';
  exception
    when restrict_violation then
      raise notice '  ok — no se puede cambiar el tipo de un evento';
  end;

  begin
    update time_events set employee_id = '55555555-5555-4555-8555-555555555552'
      where id = v_event;
    raise exception 'FALLO: se pudo cambiar el empleado de un evento'
      using errcode = 'assert_failure';
  exception
    when restrict_violation then
      raise notice '  ok — no se puede cambiar el empleado de un evento';
  end;

  -- Cambiar la foto Y otra columna en el mismo update tambien se rechaza: la
  -- excepcion es por columna, no "si toca la foto pasa todo lo demas".
  begin
    update time_events set photo_path = 'x.jpg', occurred_at = now()
      where id = v_event;
    raise exception 'FALLO: se colo un cambio de hora junto con la foto'
      using errcode = 'assert_failure';
  exception
    when restrict_violation then
      raise notice '  ok — no se puede colar otro cambio junto con la foto';
  end;

  begin
    delete from time_events where id = v_event;
    raise exception 'FALLO: se pudo borrar un evento'
      using errcode = 'assert_failure';
  exception
    when restrict_violation then
      raise notice '  ok — no se puede borrar un evento';
  end;
end
$$;
rollback;

begin;
do $$
declare
  v_old uuid;
  v_recent uuid;
  v_purged integer;
begin
  -- La purga respeta el plazo de CADA ubicacion, no una constante global.
  -- Sede Principal guarda 30 dias.
  select id into v_recent from time_events
    where location_id = '22222222-2222-4222-8222-222222222221'
    order by occurred_at desc limit 1;

  -- Un evento antiguo, creado a mano para tener algo que caduque.
  insert into time_events
    (organization_id, employee_id, location_id, event_type, source,
     occurred_at, idempotency_key, photo_path)
  values
    ('11111111-1111-4111-8111-111111111111',
     '55555555-5555-4555-8555-555555555551',
     '22222222-2222-4222-8222-222222222221',
     'clock_in', 'kiosk', now() - interval '90 days', gen_random_uuid(),
     'ruta/antigua.jpg')
  returning id into v_old;

  update time_events set photo_path = 'ruta/reciente.jpg' where id = v_recent;

  v_purged := purge_expired_attendance_photos();

  perform test_assert(v_purged >= 1,
    'La purga informa cuantas fotos borro, para poder vigilar que corre');
  perform test_assert(
    (select photo_path from time_events where id = v_old) is null,
    'La purga borra la foto de un evento de hace 90 dias');
  perform test_assert(
    (select photo_path from time_events where id = v_recent) is not null,
    'La purga NO toca la foto de un evento reciente');

  -- Y lo que no debe pasar nunca: la purga borra la imagen, no el fichaje.
  perform test_assert(
    (select count(*) from time_events where id = v_old) = 1,
    'La purga borra la foto pero NO el evento: las horas trabajadas no caducan');

  raise notice '  --- pruebas de fotos de fichaje completas ---';
end
$$;
rollback;

-- ===========================================================================
-- Alertas del gerente (§19)
-- ===========================================================================
-- Lo que se fija aquí, en orden de importancia:
--   1. la DEDUPLICACIÓN funciona de verdad. Sin ella el trabajo de cada 15
--      minutos repite la misma tardanza hasta que el gerente apaga las
--      notificaciones, y entonces la función entera deja de servir;
--   2. el TEXTO no lleva datos sensibles: ni la función devuelve nombres ni hay
--      ninguna columna por la que pudieran entrar;
--   3. las PREFERENCIAS se respetan;
--   4. un gerente no recibe nada de una ubicación que no administra.

begin;
do $$
declare
  v_manager uuid := '33333333-3333-4333-8333-333333333332';
  v_org     uuid := '11111111-1111-4111-8111-111111111111';
  v_primera integer;
  v_segunda integer;
  v_tercera integer;
begin
  -- Sin dispositivo registrado no se encola nada: una alerta escrita para alguien
  -- que no tiene a dónde recibirla se perderia para siempre en cuanto registrara
  -- el primero, porque la fila de deduplicacion ya estaria puesta.
  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org)) = 0,
    'Sin ningun dispositivo registrado no hay ninguna alerta pendiente');

  insert into push_tokens (user_id, expo_token, platform, device_name)
    values (v_manager, 'ExponentPushToken[prueba-gerenta]', 'ios', 'iPhone de prueba');

  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org)) > 0,
    'Con un dispositivo registrado la gerenta si tiene alertas pendientes');

  -- LA PRUEBA CENTRAL. Dos llamadas seguidas: la primera reserva, la segunda no
  -- devuelve nada. Es lo que evita repetir la misma tardanza cada 15 minutos.
  select count(*) into v_primera from claim_manager_alerts(v_org);
  select count(*) into v_segunda from claim_manager_alerts(v_org);

  perform test_assert(v_primera > 0, 'La primera llamada reserva las alertas pendientes');
  perform test_assert(v_segunda = 0,
    'La SEGUNDA llamada no devuelve nada: la deduplicacion evita repetir el mismo aviso');

  perform test_assert(
    (select count(*) from manager_alert_deliveries) = v_primera,
    'Queda una fila de deduplicacion por alerta reservada, y ni una mas');

  -- Marcar enviado no reabre nada: una alerta avisada esta avisada.
  perform mark_manager_alerts_sent(array(select id from manager_alert_deliveries));
  select count(*) into v_tercera from claim_manager_alerts(v_org);
  perform test_assert(v_tercera = 0,
    'Despues de marcar enviado tampoco se vuelve a avisar');
  perform test_assert(
    (select count(*) from manager_alert_deliveries where status = 'sent') = v_primera,
    'Todas las filas quedan marcadas como enviadas');
end
$$;
rollback;

begin;
do $$
declare
  v_manager uuid := '33333333-3333-4333-8333-333333333332';
  v_org     uuid := '11111111-1111-4111-8111-111111111111';
  v_reservada integer;
  v_antes integer;
  v_despues integer;
begin
  insert into push_tokens (user_id, expo_token, platform)
    values (v_manager, 'ExponentPushToken[prueba-gerenta]', 'ios');

  -- REINTENTO: si el envio murio a medias, la fila se queda en `queued` y hay que
  -- poder volver a entregarla. Se simula envejeciendo `queued_at`.
  select count(*) into v_reservada from claim_manager_alerts(v_org);
  perform test_assert(v_reservada > 0, 'Hay alertas reservadas para probar el reintento');

  perform test_assert(
    (select count(*) from claim_manager_alerts(v_org)) = 0,
    'Recien reservada, la alerta no se vuelve a entregar');

  update manager_alert_deliveries set queued_at = now() - interval '30 minutes';
  perform test_assert(
    (select count(*) from claim_manager_alerts(v_org)) = v_reservada,
    'Pasado el plazo, una alerta que quedo sin enviar se vuelve a entregar');

  -- Y el reintento no es infinito: tras el tope se abandona, porque reenviar una
  -- notificacion de hace horas no ayuda a nadie.
  update manager_alert_deliveries set queued_at = now() - interval '30 minutes', attempts = 3;
  perform test_assert(
    (select count(*) from claim_manager_alerts(v_org)) = 0,
    'Superado el tope de intentos, la alerta se abandona en lugar de reintentar sin fin');

  -- La purga NO borra la fila de una solicitud que sigue pendiente: borrarla
  -- equivale a decir "esto no se ha avisado", y el gerente recibiria otra vez el
  -- aviso de una solicitud que ya conoce.
  update manager_alert_deliveries set queued_at = now() - interval '400 days';
  select count(*) into v_antes from manager_alert_deliveries where alert_type = 'newRequest';
  perform test_assert(v_antes > 0, 'Hay una alerta de solicitud pendiente para probar la purga');
  perform purge_manager_alert_deliveries(180);
  select count(*) into v_despues from manager_alert_deliveries where alert_type = 'newRequest';
  perform test_assert(v_despues = v_antes,
    'La purga conserva la fila de una solicitud que sigue pendiente');
  perform test_assert(
    (select count(*) from manager_alert_deliveries where alert_type <> 'newRequest') = 0,
    'La purga si borra el resto del historial antiguo');
end
$$;
rollback;

begin;
do $$
declare
  v_manager uuid := '33333333-3333-4333-8333-333333333332';
  v_org     uuid := '11111111-1111-4111-8111-111111111111';
  v_con_noshow integer;
  v_sin_noshow integer;
begin
  insert into push_tokens (user_id, expo_token, platform)
    values (v_manager, 'ExponentPushToken[prueba-gerenta]', 'ios');

  select count(*) into v_con_noshow from pending_manager_alerts(v_org)
    where alert_type = 'noShow';
  perform test_assert(v_con_noshow > 0,
    'Con las preferencias por defecto la gerenta recibe los avisos de ausencia');

  update notification_preferences
    set preferences = preferences || '{"noShow": false}'::jsonb
    where user_id = v_manager and organization_id = v_org;

  select count(*) into v_sin_noshow from pending_manager_alerts(v_org)
    where alert_type = 'noShow';
  perform test_assert(v_sin_noshow = 0,
    'Apagar noShow en las preferencias apaga de verdad ese aviso');
  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org)
       where alert_type = 'newRequest') > 0,
    'Apagar un aviso NO apaga los demas');

  -- Una fila ausente en `notification_preferences` significa "los valores por
  -- defecto", no "no quiere nada": el panel solo escribe cuando alguien toca algo.
  delete from notification_preferences where user_id = v_manager;
  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org) where alert_type = 'noShow') > 0,
    'Sin fila de preferencias se usan los valores por defecto, no el silencio');
end
$$;
rollback;

begin;
do $$
declare
  v_manager uuid := '33333333-3333-4333-8333-333333333332';
  v_ajena   uuid := '33333333-3333-4333-8333-333333333339';
  v_loc_main   uuid := '22222222-2222-4222-8222-222222222221';
  v_loc_branch uuid := '22222222-2222-4222-8222-222222222222';
begin
  insert into push_tokens (user_id, expo_token, platform) values
    (v_manager, 'ExponentPushToken[gerenta]', 'ios'),
    (v_ajena,   'ExponentPushToken[ajena]',   'ios');

  -- La gerenta administra Sede Principal y NO Sucursal Demo. Es la misma regla
  -- que fija la RLS, aqui aplicada sin sesion: la alerta se calcula con
  -- `service_role` desde un cron, donde `auth.uid()` no existe.
  perform test_assert(
    (select count(*) from pending_manager_alerts()
       where recipient_user_id = v_manager and location_id = v_loc_branch) = 0,
    'La gerenta NO recibe alertas de una ubicacion que no administra');
  perform test_assert(
    (select count(*) from pending_manager_alerts()
       where recipient_user_id = v_manager and location_id = v_loc_main) > 0,
    'La gerenta si recibe las de la ubicacion que administra');

  -- Y la dueña de otra empresa no recibe nada de esta, ni con dispositivo
  -- registrado.
  perform test_assert(
    (select count(*) from pending_manager_alerts()
       where recipient_user_id = v_ajena
         and location_id in (v_loc_main, v_loc_branch)) = 0,
    'La dueña de otra empresa no recibe ninguna alerta de esta organizacion');

  -- La propietaria si ve las dos tiendas: owner y admin administran la
  -- organizacion completa.
  insert into push_tokens (user_id, expo_token, platform)
    values ('33333333-3333-4333-8333-333333333331', 'ExponentPushToken[dueña]', 'ios');
  perform test_assert(
    (select count(distinct location_id) from pending_manager_alerts()
       where recipient_user_id = '33333333-3333-4333-8333-333333333331') >= 1,
    'La propietaria recibe alertas de su organizacion');
end
$$;
rollback;

begin;
do $$
declare
  v_manager uuid := '33333333-3333-4333-8333-333333333332';
  v_org     uuid := '11111111-1111-4111-8111-111111111111';
  v_nombres text[];
  v_columnas text[];
  v_texto text;
begin
  insert into push_tokens (user_id, expo_token, platform)
    values (v_manager, 'ExponentPushToken[prueba-gerenta]', 'ios');

  -- EL TEXTO NO LLEVA DATOS SENSIBLES.
  --
  -- La comprobacion es doble a proposito. Primero el CONJUNTO DE COLUMNAS: si
  -- alguien anade una columna con el nombre del empleado "para que el texto sea
  -- mas util", esta lista deja de cuadrar y la prueba falla antes de que ese
  -- nombre llegue a la pantalla de bloqueo de un telefono.
  select array_agg(a.attname::text order by a.attname) into v_columnas
  from pg_proc p
  join unnest(p.proallargtypes, p.proargnames) as a(atttype, attname) on true
  where p.proname = 'pending_manager_alerts'
    and p.pronamespace = 'public'::regnamespace
    and a.attname not like 'p\_%';

  perform test_assert(
    v_columnas = array[
      'alert_type', 'location_id', 'occurrence_key', 'organization_id',
      'payload', 'recipient_locale', 'recipient_user_id', 'subject_id'
    ],
    'pending_manager_alerts devuelve exactamente las columnas previstas y ninguna de personas');

  -- Y despues el CONTENIDO: ni un nombre del personal aparece en lo que se
  -- devuelve, payload incluido. Los nombres se leen del propio seed, asi que la
  -- prueba sigue valiendo si el seed cambia.
  select array_agg(distinct x) into v_nombres from (
    select e.full_name as x from employees e where e.organization_id = v_org
    union all
    select e.preferred_name from employees e
      where e.organization_id = v_org and e.preferred_name is not null
    union all
    select pr.full_name from profiles pr
      join organization_memberships m on m.user_id = pr.id
      where m.organization_id = v_org
  ) nombres where x is not null and btrim(x) <> '';

  select string_agg(t::text, ' ') into v_texto from pending_manager_alerts(v_org) t;
  perform test_assert(v_texto is not null, 'Hay alertas que inspeccionar');

  perform test_assert(
    not exists (
      select 1 from unnest(v_nombres) as n where v_texto ilike '%' || n || '%'
    ),
    'Ningun nombre del personal aparece en lo que devuelve pending_manager_alerts');

  -- El payload lleva solo el nombre de la tienda: el gerente de dos locales
  -- necesita saber a cual ir, y un rotulo comercial no es un dato de una persona.
  perform test_assert(
    (select bool_and(payload - 'locationName' = '{}'::jsonb)
       from pending_manager_alerts(v_org)),
    'El payload no lleva nada mas que el nombre de la ubicacion');
end
$$;
rollback;

begin;
do $$
declare
  v_manager uuid := '33333333-3333-4333-8333-333333333332';
  v_org     uuid := '11111111-1111-4111-8111-111111111111';
  v_device  uuid := '66666666-6666-4666-8666-666666666661';
  v_id1 uuid;
  v_id2 uuid;
begin
  insert into push_tokens (user_id, expo_token, platform)
    values (v_manager, 'ExponentPushToken[prueba-gerenta]', 'ios');

  -- RELOJ SIN SINCRONIZAR: el umbral sale de `locations.settings`, no de una
  -- constante, y el aviso vuelve cada dia mientras el problema siga.
  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org)
       where alert_type = 'kioskNotSyncing') = 0,
    'Un reloj recien activado no cuenta como sin sincronizar');

  update kiosk_devices set last_sync_at = now() - interval '5 hours' where id = v_device;
  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org)
       where alert_type = 'kioskNotSyncing') = 1,
    'Cinco horas sin sincronizar pasan el umbral por defecto de 120 minutos');

  update locations set settings = settings || '{"kioskSyncStaleMinutes": 600}'::jsonb
    where id = '22222222-2222-4222-8222-222222222221';
  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org)
       where alert_type = 'kioskNotSyncing') = 0,
    'Subir el umbral de la ubicacion calla el aviso: el periodo es configurable (§19)');

  -- INTENTO DE FICHAJE RECHAZADO. El hecho no existia en ninguna tabla porque la
  -- funcion SQL rechaza levantando una excepcion, que deshace su propia
  -- transaccion; lo anota la Edge Function despues, con esta funcion.
  v_id1 := record_kiosk_rejection('demo-kiosk-main', 'revoked');
  perform test_assert(v_id1 is not null, 'Se anota el intento desde un reloj revocado');

  v_id2 := record_kiosk_rejection('demo-kiosk-main', 'revoked');
  perform test_assert(v_id2 is null,
    'Un segundo intento igual en el mismo minuto se colapsa: un iPad revocado reintenta en bucle');

  perform test_assert(
    record_kiosk_rejection('identificador-inventado', 'revoked') is null,
    'Un identificador desconocido no se anota: no hay empresa a la que atribuirlo');

  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org) where alert_type = 'wrongKiosk') = 1,
    'El intento rechazado produce un aviso para quien administra esa tienda');

  -- No tiene interruptor a proposito: es el aviso de que un iPad perdido sigue
  -- intentando fichar, y quien se lo llevo no debe poder silenciarlo.
  update notification_preferences
    set preferences = preferences || '{"late": false, "noShow": false, "nearOvertime": false,
                                       "incompleteEntry": false, "newRequest": false,
                                       "kioskNotSyncing": false}'::jsonb
    where user_id = v_manager;
  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org) where alert_type = 'wrongKiosk') = 1,
    'El aviso de fichaje rechazado no se puede apagar desde las preferencias');
  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org) where alert_type <> 'wrongKiosk') = 0,
    'Y todo lo demas si se apago');

  raise notice '  --- pruebas de alertas del gerente completas ---';
end
$$;
rollback;

begin;
-- Las funciones de alertas NO son alcanzables desde una sesión de la app.
--
-- LÍMITE HONESTO DE ESTA PRUEBA: el Postgres local no tiene los `default
-- privileges` que Supabase deja puestos sobre el esquema `public`, así que aquí
-- basta un `revoke ... from public` para que falle. En Supabase real hacen falta
-- los `revoke` nominales a `anon` y `authenticated` que pone la migración, y esta
-- prueba no puede distinguir las dos situaciones. Sirve para que un `grant ... to
-- authenticated` futuro no pase inadvertido.
do $$
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '33333333-3333-4333-8333-333333333332', 'role', 'authenticated')::text,
    true);

  begin
    perform count(*) from public.pending_manager_alerts();
    raise exception 'FALLO: una sesion de la app pudo listar las alertas de todas las empresas'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — una sesion de la app no puede llamar a pending_manager_alerts';
  end;

  begin
    perform count(*) from public.claim_manager_alerts();
    raise exception 'FALLO: una sesion de la app pudo reservar alertas'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — una sesion de la app no puede llamar a claim_manager_alerts';
  end;

  begin
    perform public.record_kiosk_rejection('demo-kiosk-main', 'revoked');
    raise exception 'FALLO: una sesion de la app pudo inventar un intento rechazado'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — una sesion de la app no puede inventar intentos rechazados';
  end;

  reset role;
  raise notice '  --- permisos de las funciones de alertas comprobados ---';
end
$$;
rollback;

-- ===========================================================================
-- El empleado se entera del resultado de su solicitud (§19)
-- ===========================================================================
--
-- El kiosco YA CREA solicitudes de correccion y el encargado las resuelve en el
-- panel, pero el empleado no se enteraba nunca. Lo que se fija aqui es que el
-- contexto del kiosco lo devuelve, y sobre todo QUE NO DEVUELVE: el kiosco es un
-- dispositivo compartido.
begin;
do $$
declare
  v_emp uuid := '55555555-5555-4555-8555-555555555551';  -- Sofia
  v_otra uuid := '55555555-5555-4555-8555-555555555552';
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_revisor uuid := '33333333-3333-4333-8333-333333333331';
  v_ctx jsonb;
  v_updates jsonb;
begin
  -- Una aprobada reciente, una rechazada reciente, una pendiente, una resuelta hace
  -- mucho, y una de OTRA persona. Solo deben salir las dos primeras.
  insert into time_edit_requests
    (organization_id, employee_id, location_id, kind, reason, status,
     reviewed_by, reviewed_at, reviewer_comment, target_date)
  values
    (v_org, v_emp, v_loc, 'forgot_clock_out', 'Me olvide de marcar la salida',
     'approved', v_revisor, now() - interval '2 hours', 'Verificado con la camara',
     current_date - 1),
    (v_org, v_emp, v_loc, 'forgot_break', 'Tome el descanso y no lo registre',
     'rejected', v_revisor, now() - interval '1 day', 'No coincide con el registro',
     current_date - 2),
    (v_org, v_emp, v_loc, 'correction', 'Pendiente de revisar', 'pending',
     null, null, null, current_date),
    (v_org, v_emp, v_loc, 'correction', 'Resuelta hace mucho', 'approved',
     v_revisor, now() - interval '30 days', null, current_date - 30),
    (v_org, v_otra, v_loc, 'forgot_clock_in', 'De otra persona', 'approved',
     v_revisor, now() - interval '1 hour', null, current_date - 1);

  v_ctx := kiosk_employee_context(v_emp, v_loc);
  v_updates := v_ctx -> 'requestUpdates';

  perform test_assert(v_updates is not null and jsonb_typeof(v_updates) = 'array',
    'El contexto del kiosco devuelve requestUpdates como arreglo');

  perform test_assert(jsonb_array_length(v_updates) = 2,
    'Solo las resueltas hace poco: ni pendientes, ni antiguas, ni de otra persona — ' ||
    'devueltas: ' || jsonb_array_length(v_updates));

  -- Orden: la mas reciente primero. Quien mira el iPad diez segundos ve la de arriba.
  perform test_assert((v_updates -> 0 ->> 'status') = 'approved',
    'La mas reciente va primero');

  perform test_assert((v_updates -> 0 ->> 'reason') = 'Me olvide de marcar la salida',
    'Se devuelve el motivo que dio ella: sin eso "Aprobada" no dice de que');

  perform test_assert((v_updates -> 0 ->> 'reviewerComment') = 'Verificado con la camara',
    'Se devuelve el comentario de la revision');

  perform test_assert((v_updates -> 1 ->> 'status') = 'rejected',
    'Tambien se devuelven las rechazadas: un rechazo silencioso es peor que un rechazo');

  -- LO QUE NO SE DEVUELVE. El kiosco es compartido: cualquiera que pase por el iPad
  -- puede estar mirando la pantalla de otra persona.
  perform test_assert(not (v_updates -> 0 ? 'reviewedBy'),
    'NO se devuelve quien reviso la solicitud');

  perform test_assert(
    not exists (
      select 1 from jsonb_array_elements(v_updates) e
      where e::text ilike '%De otra persona%'
    ),
    'NO se filtra ninguna solicitud de otra persona');

  -- Y una sin resolver no puede colarse por tener reviewed_at nulo.
  perform test_assert(
    not exists (
      select 1 from jsonb_array_elements(v_updates) e
      where (e ->> 'status') = 'pending' or (e ->> 'reviewedAt') is null
    ),
    'Ninguna pendiente aparece como resultado');

  raise notice '  --- pruebas de resultado de solicitudes completas ---';
end
$$;
rollback;
