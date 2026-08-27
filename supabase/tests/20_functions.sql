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
