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

-- ===========================================================================
-- Las preferencias de notificacion y las alertas que existen: mismo conjunto
-- ===========================================================================
--
-- ESTA PRUEBA EXISTE POR UN FALLO CONCRETO, Y LUEGO POR UNO MIO. La app ofrecia ocho
-- interruptores y dos de ellos, `earlyClockIn` y `scheduleChange`, no controlaban
-- nada: no existia ninguna alerta de esos tipos. Se podian encender, se guardaban, y
-- no pasaba nada nunca. Un interruptor que no hace nada es indistinguible de "no ha
-- pasado nada que avisar".
--
-- EL PRIMER ARREGLO FUE EL EQUIVOCADO: quitar los dos interruptores. La §19 lista
-- siete notificaciones y no incluye esas dos, y con eso conclui que el conjunto de
-- ocho estaba inventado. Pero la §11.6 —la que describe la pantalla de
-- Configuracion— SI las lista. Se borraron dos preferencias que el proyecto pide.
--
-- Y ESTA PRUEBA PASO EN VERDE MIENTRAS ESO ESTABA MAL, que es lo que hay que
-- recordar de ella: compara las preferencias con los tipos de alerta que declara la
-- base, y las dos estaban de acuerdo en estar mal. Una prueba de coherencia entre dos
-- copias no dice nada sobre si la copia es correcta. De ahi la cuenta explicita de
-- abajo contra las secciones de la especificacion, que es lo unico que ata esto a
-- algo externo.
--
-- Lo que se fija: el conjunto de claves por defecto tiene que ser EXACTAMENTE los
-- tipos de alerta que la base declara, menos los que no llevan interruptor a
-- proposito. Si alguien anade una alerta y se olvida del interruptor, o anade un
-- interruptor sin alerta, falla aqui.
do $$
declare
  -- Los que NO llevan interruptor, y por que. Cambiar esta lista es una decision,
  -- no un ajuste para que la prueba pase.
  v_sin_interruptor text[] := array[
    -- Aviso de que un iPad perdido o robado sigue intentando fichar. Con
    -- interruptor, quien se llevo el dispositivo podria silenciar el aviso de que
    -- se lo llevo.
    'wrongKiosk'
  ];
  v_alertas text[];
  v_preferencias text[];
  v_faltan text;
  v_sobran text;
begin
  -- Los tipos de alerta, sacados de la restriccion `check` de la tabla y no de una
  -- lista escrita a mano aqui: si se copiaran, esta prueba tendria el mismo
  -- problema que pretende evitar.
  select array_agg(valor order by valor) into v_alertas
  from (
    select unnest(regexp_matches(pg_get_constraintdef(c.oid), '''([a-zA-Z]+)''', 'g')) as valor
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'manager_alert_deliveries'
      and c.conname like '%alert_type%'
  ) x;

  -- NUEVE, que es la UNION de las dos listas de la especificacion, no una de ellas:
  --   en las dos     late, noShow, incompleteEntry, nearOvertime, newRequest
  --   solo en §11.6  earlyClockIn, scheduleChange
  --   solo en §19    wrongKiosk, kioskNotSyncing
  -- Quitar de una lista lo que solo aparece en la otra deja al encargado sin un aviso
  -- que el proyecto pide. El numero esta escrito a mano a proposito: cambiarlo obliga
  -- a volver a la especificacion.
  perform test_assert(array_length(v_alertas, 1) = 9,
    'La base declara 9 tipos de alerta, la union de §11.6 y §19 — encontrados: ' ||
    coalesce(array_length(v_alertas, 1)::text, '0'));

  select array_agg(k order by k) into v_preferencias
  from jsonb_object_keys(default_notification_preferences()) as k;

  select string_agg(a, ', ' order by a) into v_faltan
  from unnest(v_alertas) as a
  where not (a = any (v_preferencias)) and not (a = any (v_sin_interruptor));

  perform test_assert(v_faltan is null,
    'Toda alerta que existe tiene interruptor (o esta en la lista de excepciones)' ||
    coalesce(' — SIN INTERRUPTOR: ' || v_faltan, ''));

  select string_agg(p, ', ' order by p) into v_sobran
  from unnest(v_preferencias) as p
  where not (p = any (v_alertas));

  -- LA MITAD QUE FALLABA. Un interruptor sin alerta detras.
  perform test_assert(v_sobran is null,
    'Todo interruptor apaga una alerta que existe' ||
    coalesce(' — NO CONTROLAN NADA: ' || v_sobran, ''));

  raise notice '  ok — % alertas, % interruptores, % sin interruptor a proposito',
    array_length(v_alertas, 1), array_length(v_preferencias, 1),
    array_length(v_sin_interruptor, 1);
end
$$;

-- Y que ninguna fila le falte una clave, ni tenga una que no exista.
--
-- LO PRIMERO es el modo de fallo que importa: una preferencia ausente vale `null`, y
-- `(null)::boolean` en el `where` de las alertas significa "no avisar". Una clave que
-- falta NO significa que el encargado no quiera saberlo, asi que un `insert` que
-- olvide una clave apaga un aviso en silencio.
--
-- LAS DOS se comprueban contra `default_notification_preferences()` y no contra una
-- lista escrita aqui: asi la prueba sigue valiendo cuando el conjunto cambie. La
-- version anterior nombraba `earlyClockIn` y `scheduleChange` como claves muertas, y
-- al restituirlas —§11.6 si las pide— fallaba por lo contrario.
do $$
declare
  v_faltan integer;
  v_sobran integer;
begin
  select count(*) into v_faltan
  from notification_preferences
  where not (preferences ?& array(select jsonb_object_keys(default_notification_preferences())));

  perform test_assert(v_faltan = 0,
    'Ninguna fila de preferencias le falta una clave real — filas malas: ' || v_faltan);

  select count(*) into v_sobran
  from notification_preferences p
  where exists (
    select 1 from jsonb_object_keys(p.preferences) as k
    where k not in (select jsonb_object_keys(default_notification_preferences()))
  );

  perform test_assert(v_sobran = 0,
    'Ninguna fila de preferencias tiene claves que no existan — filas malas: ' || v_sobran);
end
$$;

-- ===========================================================================
-- Las dos alertas de §11.6 que faltaban se producen de verdad
-- ===========================================================================
--
-- No basta con que la clave exista en las preferencias: eso es exactamente lo que ya
-- pasaba y era el fallo. Aqui se provoca el hecho y se comprueba que la alerta sale.
begin;
do $$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_loc uuid := '22222222-2222-4222-8222-222222222221';
  v_gerente uuid := '33333333-3333-4333-8333-333333333332';
  v_owner uuid := '33333333-3333-4333-8333-333333333331';
  -- La empleada que el seed deja SIN turno. Con la que esta trabajando, crear un
  -- turno alrededor de ahora choca con la guarda de solapamiento, y con razon.
  v_emp uuid := '55555555-5555-4555-8555-555555555554';
  v_shift uuid;
  v_pub uuid;
begin
  -- Sin dispositivo activo no hay destinatarios: `pending_manager_alerts` lo exige
  -- como filtro, no como descarte posterior, para no escribir la fila de
  -- deduplicacion de una alerta que no se puede enviar.
  insert into push_tokens (user_id, expo_token, platform, device_name)
  values (v_gerente, 'ExponentPushToken[prueba-1106-gerenta]', 'ios', 'iPad de prueba'),
         (v_owner,   'ExponentPushToken[prueba-1106-dueña]',  'ios', 'iPhone de prueba')
  on conflict do nothing;

  -- --- ENTRADA TEMPRANA ---------------------------------------------------
  -- Un turno que empieza dentro de una hora y una entrada ya fichada.
  insert into shifts (organization_id, location_id, employee_id, starts_at, ends_at,
                      status, publication_version, published_at)
  values (v_org, v_loc, v_emp, now() + interval '1 hour', now() + interval '9 hours',
          'published', 1, now())
  returning id into v_shift;

  insert into time_events (organization_id, employee_id, location_id, shift_id,
                           event_type, occurred_at, source, idempotency_key)
  values (v_org, v_emp, v_loc, v_shift, 'clock_in', now() - interval '5 minutes',
          'kiosk', gen_random_uuid());

  -- Apagada por defecto, asi que primero NO debe salir.
  insert into notification_preferences (user_id, organization_id, preferences)
  values (v_gerente, v_org, default_notification_preferences())
  on conflict (user_id, organization_id) do update
    set preferences = default_notification_preferences();

  perform test_assert(
    not exists (
      select 1 from pending_manager_alerts(v_org)
      where alert_type = 'earlyClockIn' and recipient_user_id = v_gerente
    ),
    'Entrada temprana viene APAGADA por defecto: no avisa sin que nadie la encienda');

  update notification_preferences
  set preferences = preferences || jsonb_build_object('earlyClockIn', true)
  where user_id = v_gerente and organization_id = v_org;

  perform test_assert(
    exists (
      select 1 from pending_manager_alerts(v_org)
      where alert_type = 'earlyClockIn' and recipient_user_id = v_gerente
        and subject_id = v_emp
    ),
    'Al encenderla, la entrada temprana SI produce alerta para quien administra la tienda');

  -- --- CAMBIO DE HORARIO -------------------------------------------------
  -- Republicacion con turnos cambiados, hecha por la propietaria.
  insert into shift_publications (organization_id, location_id, week_starts_on,
                                  publication_version, published_by, changed_shift_ids)
  values (v_org, v_loc, current_date, 2, v_owner, array[v_shift])
  returning id into v_pub;

  perform test_assert(
    exists (
      select 1 from pending_manager_alerts(v_org)
      where alert_type = 'scheduleChange' and recipient_user_id = v_gerente
        and subject_id = v_pub
    ),
    'La republicacion con cambios avisa a los OTROS encargados de la tienda');

  -- LA MITAD QUE IMPORTA: no se avisa a quien lo publico. Ya lo sabe, lo acaba de
  -- hacer, y un aviso ahi entrena a la gente a ignorar los avisos.
  perform test_assert(
    not exists (
      select 1 from pending_manager_alerts(v_org)
      where alert_type = 'scheduleChange' and recipient_user_id = v_owner
        and subject_id = v_pub
    ),
    'NO se avisa del cambio de horario a quien lo publico');

  -- Una republicacion que no cambia ningun turno no es un cambio de horario:
  -- avisar de ella entrena a ignorar el aviso.
  insert into shift_publications (organization_id, location_id, week_starts_on,
                                  publication_version, published_by, changed_shift_ids)
  values (v_org, v_loc, current_date + 7, 3, v_owner, array[]::uuid[]);

  perform test_assert(
    (select count(*) from pending_manager_alerts(v_org)
      where alert_type = 'scheduleChange' and recipient_user_id = v_gerente) = 1,
    'Una republicacion sin turnos cambiados no genera alerta');

  raise notice '  --- pruebas de las alertas de §11.6 completas ---';
end
$$;
rollback;
