-- Krealo Shift — permisos de ejecución de las funciones (§15, §22)
--
-- ESTA ES LA PRUEBA QUE SOSTIENE EL ARREGLO, no la migración.
--
-- El agujero que existía era invisible para las pruebas porque el shim no tenía los
-- privilegios por defecto de Supabase. Con ellos puestos, 34 funciones quedaban
-- invocables desde `anon`, o sea sin ninguna sesión: entre ellas
-- `set_employee_pin`, con la que cualquiera podía fijar el PIN de un empleado y
-- fichar en su nombre.
--
-- Un `revoke` en una migración arregla el pasado. Lo que impide que vuelva a pasar
-- es esto: se enumeran TODAS las funciones de `public` y se exige que ninguna fuera
-- de la lista blanca sea ejecutable. Una función nueva que nadie recuerde cerrar
-- hace fallar esta prueba, que es exactamente lo que tiene que ocurrir.

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ===========================================================================
-- El shim tiene que parecerse a produccion, o esta prueba no prueba nada
-- ===========================================================================

do $$
begin
  -- Si esto falla, alguien quito los privilegios por defecto del shim y toda la
  -- suite volvio a medir un modelo de permisos que en la nube no existe.
  perform test_assert(
    exists (
      select 1 from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'public' and d.defaclobjtype = 'f'
    ),
    'El shim configura privilegios por defecto sobre funciones, como Supabase');
end
$$;

-- ===========================================================================
-- Lista blanca: NADA fuera de ella es ejecutable por anon ni authenticated
-- ===========================================================================

do $$
declare
  v_permitidas_auth text[] := array[
    'app_is_member', 'app_role_in', 'app_manages_location', 'app_is_self_employee',
    'app_employee_id', 'app_administers_organization', 'app_user_manages_location',
    'attendance_transition_allowed', 'week_start_for',
    'create_kiosk_activation_code', 'revoke_kiosk_device', 'set_employee_pin',
    'manager_adjust_time', 'manager_add_time_event', 'approve_timesheet_period',
    'export_timesheet_rows', 'rebuild_work_session', 'current_attendance_state',
    'attendance_state_at', 'deactivate_push_token'
  ];
  v_fugas text;
  v_total integer;
begin
  -- NINGUNA funcion es ejecutable por `anon`. Sin sesion no se llama a nada: no
  -- hay una sola politica `to anon` en el proyecto, asi que tampoco hay ninguna
  -- funcion que anon necesite.
  select string_agg(p.proname, ', ' order by p.proname) into v_fugas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    -- `test_*` son ayudantes de esta suite, creados por 10_rls.sql DESPUES de las
    -- migraciones. No existen en produccion; excluirlos no tapa nada.
    and p.proname not like 'test\_%'
    and has_function_privilege('anon', p.oid, 'execute');

  perform test_assert(v_fugas is null,
    'Ninguna funcion de public es ejecutable por anon' ||
    coalesce(' — FUGAS: ' || v_fugas, ''));

  -- Y por `authenticated`, solo las de la lista.
  select string_agg(p.proname, ', ' order by p.proname) into v_fugas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and p.proname not like 'test\_%'
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not (p.proname = any (v_permitidas_auth));

  perform test_assert(v_fugas is null,
    'Solo las funciones de la lista blanca son ejecutables por authenticated' ||
    coalesce(' — FUERA DE LISTA: ' || v_fugas, ''));

  -- Y al reves: las de la lista SI son ejecutables. Una prueba que solo comprueba
  -- que nada es ejecutable pasaria con la base entera cerrada y la app rota.
  select string_agg(nombre, ', ' order by nombre) into v_fugas
  from unnest(v_permitidas_auth) as nombre
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proname = nombre
      and has_function_privilege('authenticated', p.oid, 'execute')
  );

  perform test_assert(v_fugas is null,
    'Las funciones que la app necesita SI son ejecutables' ||
    coalesce(' — CERRADAS DE MAS: ' || v_fugas, ''));

  select count(*) into v_total
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f';
  raise notice '  (revisadas % funciones de public)', v_total;
end
$$;

-- ===========================================================================
-- Las peores, una por una y por su nombre
-- ===========================================================================

do $$
declare
  v_fn text;
  -- Se nombran a mano ADEMAS de la comprobacion general de arriba. Es redundante a
  -- proposito: si alguien afloja la lista blanca por comodidad, estas siguen
  -- fallando, y el mensaje dice lo que se puede hacer con cada una. Un fallo que
  -- explica el daño se arregla; uno que solo dice "fuga" se silencia.
  --
  -- Estas son SOLO DE SERVICIO: ni anon ni authenticated. Las llaman las Edge
  -- Functions con la service_role.
  v_solo_servicio text[] := array[
    'verify_employee_pin',        -- fuerza bruta de PIN sin la credencial del kiosco
    'kiosk_offline_verifiers',    -- entrega salt y verificadores de PIN de un kiosco
    'submit_time_event',          -- fichajes forjados
    'submit_offline_time_event',  -- fichajes forjados, sin token de accion
    'authenticate_kiosk',         -- probar credenciales de dispositivo
    'activate_kiosk_device',      -- probar codigos de activacion
    'apply_event_to_projection',  -- recalcular sesiones ajenas
    'kiosk_employee_context',     -- leer el estado de cualquier empleado
    'claim_manager_alerts',       -- reservar y vaciar la cola de alertas
    'record_kiosk_rejection',     -- ensuciar el registro de intentos
    'rebuild_work_session_unchecked'  -- reconstruir sin comprobar la ubicacion
  ];
begin
  foreach v_fn in array v_solo_servicio loop
    perform test_assert(
      not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and p.proname = v_fn
          and (has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('authenticated', p.oid, 'execute'))
      ),
      'Ni anon ni authenticated pueden ejecutar ' || v_fn);
  end loop;
end
$$;

-- ===========================================================================
-- Conceder execute NO es conceder permiso: los RPC comprueban el rol por dentro
-- ===========================================================================
--
-- Esta es la mitad que faltaba y que casi se me pasa. La migracion 001400 cierra
-- quien PUEDE llamar; estas pruebas comprueban que quien puede llamar no puede
-- hacer lo que no le toca. `set_employee_pin` no comprobaba NADA: cualquier
-- usuario con sesion podia fijar el PIN de cualquier empleado, incluso de otra
-- empresa, y despues fichar en su nombre.

begin;
do $$
declare
  v_ajena uuid := '55555555-5555-4555-8555-555555555559';  -- empleado de otra empresa
  v_propia uuid := '55555555-5555-4555-8555-555555555551'; -- Sofia, Sede Principal
  v_sucursal uuid := '55555555-5555-4555-8555-555555555554'; -- Diego, Sucursal Demo
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-4333-8333-333333333332',
                      'role', 'authenticated')::text, true);
  set local role authenticated;

  -- LO PEOR QUE PERMITIA EL AGUJERO: fijar el PIN de personal de otra empresa.
  begin
    perform set_employee_pin(v_ajena, '999999');
    raise exception 'FALLO: se fijo el PIN de un empleado de otra empresa'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — no se puede fijar el PIN de personal de otra empresa';
  end;

  -- Ni de una tienda que no administra. La gerenta del seed administra Sede
  -- Principal y no Sucursal Demo, y Diego solo esta en Sucursal.
  begin
    perform set_employee_pin(v_sucursal, '888888');
    raise exception 'FALLO: se fijo el PIN de personal de una tienda ajena'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — no se puede fijar el PIN de personal de una tienda que no administra';
  end;

  -- Y SI puede con el personal de la suya: una comprobacion que lo bloquea todo
  -- rompe el panel y no prueba nada.
  perform set_employee_pin(v_propia, '777777');
  raise notice '  ok — la gerenta SI puede restablecer el PIN de su propio equipo';

  -- La auditoria se comprueba con la PROPIETARIA y no aqui: `audit_logs` solo la
  -- leen owner y admin, asi que hacerlo con la gerenta daria un falso negativo —la
  -- fila existe, ella no la ve—. Que una gerenta no lea la auditoria es correcto.
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-4333-8333-333333333331',
                      'role', 'authenticated')::text, true);
  set local role authenticated;

  perform test_assert(
    exists (select 1 from audit_logs
            where entity_id = v_propia and action = 'employee_pin_set'),
    'Rotar un PIN queda en auditoria: es la credencial con la que alguien ficha');
end
$$;
rollback;

begin;
do $$
declare
  v_ajena uuid := '55555555-5555-4555-8555-555555555559';
  v_sucursal uuid := '55555555-5555-4555-8555-555555555554';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-4333-8333-333333333332',
                      'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Saber si una persona esta trabajando ahora mismo es informacion laboral suya.
  begin
    perform current_attendance_state(v_ajena);
    raise exception 'FALLO: se leyo el estado de personal de otra empresa'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — no se puede consultar el estado de personal de otra empresa';
  end;

  begin
    perform attendance_state_at(v_sucursal, now());
    raise exception 'FALLO: se leyo el estado historico de una tienda ajena'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — tampoco el estado historico de una tienda que no administra';
  end;

  -- Y si con el suyo.
  perform current_attendance_state('55555555-5555-4555-8555-555555555551');
  raise notice '  ok — la gerenta SI puede consultar el estado de su equipo';
end
$$;
rollback;

begin;
do $$
declare
  v_sesion uuid;
begin
  -- rebuild_work_session sobre una sesion de una tienda ajena.
  select id into v_sesion from work_sessions
    where location_id = '22222222-2222-4222-8222-222222222222' limit 1;

  if v_sesion is null then
    raise notice '  (sin sesiones en Sucursal Demo en el seed, se omite)';
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-4333-8333-333333333332',
                      'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform rebuild_work_session(v_sesion);
    raise exception 'FALLO: se reconstruyo una sesion de una tienda ajena'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — no se puede reconstruir una sesion de una tienda ajena';
  end;
end
$$;
rollback;

begin;
do $$
declare
  v_otro uuid := '33333333-3333-4333-8333-333333333331';  -- la propietaria
begin
  insert into push_tokens (user_id, expo_token, platform)
    values (v_otro, 'ExponentPushToken[de-otra-persona]', 'ios')
    on conflict (expo_token) do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-4333-8333-333333333332',
                      'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Conocer la cadena del token de otra persona no debe bastar para dejarla sin
  -- notificaciones.
  perform deactivate_push_token('ExponentPushToken[de-otra-persona]');

  -- Se comprueba SIN el rol de la gerenta: la RLS de push_tokens no le deja ni ver
  -- ese token, asi que preguntarlo desde su sesion devolveria null y la prueba
  -- pasaria por el motivo equivocado. Lo que se quiere comprobar es el estado real
  -- de la fila, no lo que ella alcanza a leer.
  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform test_assert(
    (select is_active from push_tokens
     where expo_token = 'ExponentPushToken[de-otra-persona]'),
    'No se puede desactivar el token de push de otra persona');

  raise notice '  --- pruebas de permisos de funciones completas ---';
end
$$;
rollback;
