-- Krealo Shift — pruebas del fichaje manual del gerente (§11.4)
--
-- Va en un archivo aparte de `20_functions.sql` porque prueba una capa distinta:
-- no el camino del kiosco, sino lo que un gerente puede hacer sobre datos ya
-- registrados. `test_assert` viene de `10_rls.sql`, que corre antes.
--
-- LO QUE DE VERDAD SE ESTA PROBANDO AQUI: que agregar un fichaje a mano sea
-- posible (la especificacion lo pide) SIN abrir la puerta a inventar horas. Las
-- pruebas que fallan son mas importantes que las que pasan.

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

\set u_manager  '''33333333-3333-4333-8333-333333333332'''
\set u_employee '''33333333-3333-4333-8333-333333333333'''
\set loc_main   '''22222222-2222-4222-8222-222222222221'''
\set loc_branch '''22222222-2222-4222-8222-222222222222'''
\set e_diego    '''55555555-5555-4555-8555-555555555554'''
\set e_other    '''55555555-5555-4555-8555-555555555559'''

-- ===========================================================================
-- El estado "a fecha de" no es el estado de ahora
-- ===========================================================================

begin;
do $$
declare
  v_emp uuid := '55555555-5555-4555-8555-555555555551';  -- Sofia, trabajando
begin
  -- Sofia esta trabajando ahora mismo en el seed.
  perform test_assert(current_attendance_state(v_emp) = 'WORKING',
    'Sofia esta trabajando ahora');

  -- Y hace un año no estaba: sin esta distincion, validar un fichaje manual del
  -- pasado contra el estado actual rechazaria correcciones validas.
  perform test_assert(attendance_state_at(v_emp, now() - interval '365 days') = 'OFF_SHIFT',
    'Hace un año Sofia estaba fuera de turno, no trabajando');

  perform test_assert(attendance_state_at(v_emp, now()) = current_attendance_state(v_emp),
    'A fecha de ahora, las dos funciones coinciden');
end
$$;
rollback;

-- ===========================================================================
-- El camino que tiene que funcionar
-- ===========================================================================

begin;
  -- Diego solo esta asignado a Sucursal Demo en el seed. Se le asigna Sede
  -- Principal ANTES de cambiar de rol: como `authenticated` la RLS no deja escribir
  -- asignaciones, y lo que se quiere probar aqui es otra cosa.
  insert into employee_location_assignments (employee_id, location_id)
    values (:e_diego, :loc_main) on conflict do nothing;

  select set_config('request.jwt.claims',
    json_build_object('sub', :u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

do $$
declare
  v_emp uuid := '55555555-5555-4555-8555-555555555554';  -- Diego
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_in  record;
  v_out record;
  v_key uuid;
begin
  -- Se le olvido marcar entrada y salida de ayer: el caso cotidiano.
  select * into v_in from manager_add_time_event(
    p_employee_id => v_emp,
    p_location_id => v_loc,
    p_event_type => 'clock_in',
    p_occurred_at => now() - interval '1 day' - interval '8 hours',
    p_reason => 'Olvido marcar entrada, confirmado con la encargada');

  perform test_assert(v_in.event_id is not null,
    'El gerente puede agregar un fichaje de entrada que faltaba');

  perform test_assert(
    (select source from time_events where id = v_in.event_id) = 'manager',
    'El fichaje manual queda marcado como source=manager y no se confunde con uno del iPad');

  perform test_assert(
    (select metadata ->> 'reason' from time_events where id = v_in.event_id) is not null,
    'El motivo queda guardado en el evento');

  perform test_assert(
    exists (select 1 from time_adjustments where target_id = v_in.event_id),
    'Queda un ajuste auditable con el motivo');

  perform test_assert(
    (select before_value ->> 'existed' from time_adjustments
     where target_id = v_in.event_id) = 'false',
    'El ajuste dice que NO habia evento antes: no es lo mismo que corregir una hora');

  -- La auditoria NO se comprueba aqui: `audit_logs` solo la leen owner y admin, y
  -- quien actua en este bloque es una gerenta. Comprobarla desde aqui daria un
  -- falso negativo —la fila existe, ella no la ve— asi que se comprueba mas abajo
  -- con la propietaria. Que una gerenta no lea la auditoria es correcto.

  -- Y la salida, que cierra la sesion.
  select * into v_out from manager_add_time_event(
    p_employee_id => v_emp,
    p_location_id => v_loc,
    p_event_type => 'clock_out',
    p_occurred_at => now() - interval '1 day',
    p_reason => 'Olvido marcar salida');

  perform test_assert(v_out.work_session_id is not null,
    'La salida manual cierra una sesion de trabajo');

  perform test_assert(
    (select net_minutes from work_sessions where id = v_out.work_session_id) > 0,
    'La sesion creada a mano calcula sus minutos como cualquier otra');

  -- IDEMPOTENCIA: el doble envio del formulario no crea dos fichajes.
  v_key := gen_random_uuid();
  perform manager_add_time_event(
    p_employee_id => v_emp, p_location_id => v_loc, p_event_type => 'clock_in',
    p_occurred_at => now() - interval '3 hours',
    p_reason => 'Prueba de doble envio', p_idempotency_key => v_key);
  perform manager_add_time_event(
    p_employee_id => v_emp, p_location_id => v_loc, p_event_type => 'clock_in',
    p_occurred_at => now() - interval '3 hours',
    p_reason => 'Prueba de doble envio', p_idempotency_key => v_key);

  perform test_assert(
    (select count(*) from time_events where idempotency_key = v_key) = 1,
    'Reenviar el formulario con la misma clave no crea dos fichajes');
end
$$;
rollback;

-- ===========================================================================
-- La auditoria del fichaje manual, vista por quien SI puede leerla
-- ===========================================================================

begin;
  insert into employee_location_assignments (employee_id, location_id)
    values (:e_diego, :loc_main) on conflict do nothing;

do $$
declare
  v_emp uuid := '55555555-5555-4555-8555-555555555554';
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_res record;
begin
  -- Se crea el fichaje con la gerenta, que es quien lo haria en la vida real.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-4333-8333-333333333332',
                      'role', 'authenticated')::text, true);
  set local role authenticated;

  select * into v_res from manager_add_time_event(
    p_employee_id => v_emp, p_location_id => v_loc, p_event_type => 'clock_in',
    p_occurred_at => now() - interval '6 hours',
    p_reason => 'Olvido marcar entrada');

  -- Y se lee con la propietaria, que es quien puede.
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-4333-8333-333333333331',
                      'role', 'authenticated')::text, true);
  set local role authenticated;

  perform test_assert(
    exists (select 1 from audit_logs
            where entity_id = v_res.event_id and action = 'time_event_added_manually'),
    'La propietaria ve en auditoria que el fichaje se agrego a mano');

  perform test_assert(
    (select after_data ->> 'reason' from audit_logs
     where entity_id = v_res.event_id and action = 'time_event_added_manually') is not null,
    'La auditoria conserva el motivo, que es lo que pide la especificacion');
end
$$;
rollback;

-- ===========================================================================
-- Lo que NO tiene que funcionar. Esta es la mitad que importa.
-- ===========================================================================

begin;
  -- Diego solo esta asignado a Sucursal Demo en el seed. Se le asigna Sede
  -- Principal ANTES de cambiar de rol: como `authenticated` la RLS no deja escribir
  -- asignaciones, y lo que se quiere probar aqui es otra cosa.
  insert into employee_location_assignments (employee_id, location_id)
    values (:e_diego, :loc_main) on conflict do nothing;

  select set_config('request.jwt.claims',
    json_build_object('sub', :u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

do $$
declare
  v_emp uuid := '55555555-5555-4555-8555-555555555554';
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_branch uuid := '22222222-2222-4222-8222-222222222222';
  v_other uuid := '55555555-5555-4555-8555-555555555559';
begin
  -- SIN MOTIVO NO PASA. Un fichaje que el gerente se inventa sin explicacion es
  -- indistinguible de un fraude en una auditoria laboral.
  begin
    perform manager_add_time_event(v_emp, v_loc, 'clock_in', now() - interval '2 hours', '');
    raise exception 'FALLO: se agrego un fichaje sin motivo' using errcode = 'assert_failure';
  exception
    when check_violation then
      raise notice '  ok — no se puede agregar un fichaje manual sin motivo';
  end;

  begin
    perform manager_add_time_event(v_emp, v_loc, 'clock_in', now() - interval '2 hours', '   ');
    raise exception 'FALLO: un motivo de solo espacios paso' using errcode = 'assert_failure';
  exception
    when check_violation then
      raise notice '  ok — un motivo de solo espacios no cuenta como motivo';
  end;

  -- EN EL FUTURO NO. Eso no es una correccion, es una invencion.
  begin
    perform manager_add_time_event(v_emp, v_loc, 'clock_in', now() + interval '2 hours',
      'Turno de mañana');
    raise exception 'FALLO: se agrego un fichaje en el futuro' using errcode = 'assert_failure';
  exception
    when check_violation then
      raise notice '  ok — no se puede registrar un fichaje en el futuro';
  end;

  -- EN UNA TIENDA QUE NO ADMINISTRA, NO. La gerenta del seed administra Sede
  -- Principal y no Sucursal Demo.
  begin
    perform manager_add_time_event(v_emp, v_branch, 'clock_in', now() - interval '2 hours',
      'Motivo cualquiera');
    raise exception 'FALLO: se agrego un fichaje en una tienda ajena'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — no se puede agregar un fichaje en una tienda que no administra';
  end;

  -- A UN EMPLEADO DE OTRA EMPRESA, NO, ni pasando el par de identificadores a mano.
  begin
    perform manager_add_time_event(v_other, v_loc, 'clock_in', now() - interval '2 hours',
      'Motivo cualquiera');
    raise exception 'FALLO: se agrego un fichaje a personal de otra empresa'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — no se puede fichar por personal de otra empresa';
  end;

  -- UNA TRANSICION IMPOSIBLE, NO. Sin esto un gerente podria crear dos entradas
  -- seguidas sin salida y las horas de esa persona quedarian mal hasta el pago.
  perform manager_add_time_event(v_emp, v_loc, 'clock_in', now() - interval '5 hours',
    'Entrada que faltaba');
  begin
    perform manager_add_time_event(v_emp, v_loc, 'clock_in', now() - interval '4 hours',
      'Otra entrada seguida');
    raise exception 'FALLO: dos entradas seguidas sin salida'
      using errcode = 'assert_failure';
  exception
    when check_violation then
      raise notice '  ok — no se pueden crear dos entradas seguidas sin salida';
  end;
end
$$;
rollback;

-- ===========================================================================
-- Una empleada no puede agregarse fichajes a si misma
-- ===========================================================================

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_employee, 'role', 'authenticated')::text, true);
  set local role authenticated;

do $$
declare
  v_self uuid := '55555555-5555-4555-8555-555555555551';  -- Sofia es la empleada con cuenta
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
begin
  -- Si esto pasara, cualquiera podria pagarse las horas que quisiera. Es el
  -- escenario que hace que la funcion tenga que comprobar el rol y no solo la
  -- pertenencia a la ubicacion.
  begin
    perform manager_add_time_event(v_self, v_loc, 'clock_out', now() - interval '1 hour',
      'Me olvide de marcar');
    raise exception 'FALLO: una empleada se agrego un fichaje a si misma'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — una empleada no puede agregarse fichajes a si misma';
  end;

  raise notice '  --- pruebas de fichaje manual completas ---';
end
$$;
rollback;
