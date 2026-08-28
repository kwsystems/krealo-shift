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

-- Cada archivo de pruebas corre en su propia invocacion de psql, asi que los \set
-- de 10_rls.sql NO llegan hasta aqui. Se repiten los que hacen falta.
--
-- Y ojo: psql NO sustituye variables dentro de bloques dollar-quoted ($$ ... $$).
-- Dentro de un `do $$` hay que escribir el uuid literal. Costo un error de sintaxis
-- averiguarlo.
\set u_manager  '''33333333-3333-4333-8333-333333333332'''
\set loc_main   '''22222222-2222-4222-8222-222222222221'''

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
    'attendance_state_at', 'deactivate_push_token',
    -- `default_notification_preferences` devuelve un jsonb constante y no toca
    -- ninguna tabla: no hay nada que filtrar. Esta en la lista porque es el
    -- `default` de `notification_preferences.preferences`, y un default de columna
    -- se evalua con los permisos de quien inserta. Sin `execute`, un insert que no
    -- envie las preferencias falla con "permiso denegado para la funcion", que no
    -- se parece en nada al problema real.
    'default_notification_preferences',
    -- `app_actor_display_name` traduce el `created_by` de una correccion a un nombre
    -- para mostrar (§11.4). Es `security definer` y PUEDE devolver correos de
    -- `auth.users`, asi que entra en la lista con su razon escrita y con cuatro
    -- pruebas propias mas abajo: se cierra por quien pregunta —solo quien administra
    -- esa organizacion— y por quien se pregunta —solo usuarios con membresia en ESA
    -- organizacion, tambien en el respaldo del correo—. Sin la segunda barrera seria
    -- un directorio de correos del proyecto entero: se llama en bucle con uuids y se
    -- cosecha.
    'app_actor_display_name'
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


-- ===========================================================================
-- Tablas: RLS en todas, y anon sin acceso a ninguna
-- ===========================================================================
--
-- La contraparte de las pruebas de funciones. Con RLS apagada en una tabla, el
-- `grant` a `authenticated` la deja legible por cualquier sesion de cualquier
-- empresa: no hay nada que filtre filas.

begin;
do $$
declare
  v_sin_rls text;
  v_anon text;
  v_total integer;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_sin_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  perform test_assert(v_sin_rls is null,
    'Todas las tablas de public tienen RLS activada' ||
    coalesce(' — SIN RLS: ' || v_sin_rls, ''));

  -- `anon` es una sesion sin usuario. No hay una sola politica `to anon` en el
  -- proyecto, asi que no hay nada que deba poder tocar.
  select string_agg(c.relname, ', ' order by c.relname) into v_anon
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (has_table_privilege('anon', c.oid, 'select')
      or has_table_privilege('anon', c.oid, 'insert')
      or has_table_privilege('anon', c.oid, 'update')
      or has_table_privilege('anon', c.oid, 'delete'));

  perform test_assert(v_anon is null,
    'anon no tiene ningun privilegio sobre ninguna tabla' ||
    coalesce(' — EXPUESTAS: ' || v_anon, ''));

  select count(*) into v_total
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';
  raise notice '  (revisadas % tablas de public)', v_total;
end
$$;
rollback;

-- ===========================================================================
-- Las horas no se cambian sin dejar rastro
-- ===========================================================================
--
-- work_sessions tenia una politica de UPDATE que permitia a cualquier gerente
-- cambiar las horas con un `update` normal, SALTANDOSE manager_adjust_time, que es
-- lo unico que escribe el valor anterior, el nuevo, el autor, la fecha, el motivo y
-- el canal que exige la seccion 11.4.

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

do $$
declare
  v_sesion uuid;
  v_antes integer;
begin
  select id, net_minutes into v_sesion, v_antes from work_sessions
    where location_id = '22222222-2222-4222-8222-222222222221'
      and net_minutes is not null
    order by starts_at limit 1;

  if v_sesion is null then
    raise notice '  (sin sesiones con minutos en el seed, se omite)';
    return;
  end if;

  -- Con RLS y sin politica de UPDATE, el update no afecta ninguna fila. No lanza:
  -- simplemente no cambia nada, que es el comportamiento de PostgreSQL. Lo que se
  -- comprueba es el efecto, no la excepcion.
  update work_sessions set net_minutes = 999 where id = v_sesion;

  perform test_assert(
    (select net_minutes from work_sessions where id = v_sesion) = v_antes,
    'Un gerente NO puede cambiar las horas con un update directo');

  -- Y fabricar un ajuste tampoco: un registro de auditoria que el auditado puede
  -- escribir a mano no es auditoria.
  begin
    insert into time_adjustments
      (organization_id, work_session_id, target_type, target_id,
       before_value, after_value, reason, created_by)
    values
      ('11111111-1111-4111-8111-111111111111', v_sesion, 'work_session', v_sesion,
       '{}'::jsonb, '{}'::jsonb, 'Motivo inventado', auth.uid());
    raise exception 'FALLO: se fabrico una fila de auditoria a mano'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — no se puede fabricar una fila de auditoria a mano';
  end;
end
$$;
rollback;

begin;
do $$
declare
  v_sesion uuid;
  v_antes integer;
  v_despues integer;
begin
  select id, net_minutes into v_sesion, v_antes from work_sessions
    where location_id = '22222222-2222-4222-8222-222222222221'
      and net_minutes is not null and ends_at is not null
    order by starts_at limit 1;

  if v_sesion is null then
    raise notice '  (sin sesiones cerradas en el seed, se omite)';
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-4333-8333-333333333332',
                      'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Y LA OTRA MITAD: el camino legitimo SIGUE FUNCIONANDO. Cerrar la puerta
  -- equivocada habria dejado el panel sin poder corregir nada, y una prueba que
  -- solo comprueba que no se puede escribir pasaria igual con todo roto.
  perform manager_adjust_time(
    p_work_session_id => v_sesion,
    p_expected_updated_at => (select updated_at from work_sessions where id = v_sesion),
    p_new_starts_at => (select starts_at from work_sessions where id = v_sesion),
    p_new_ends_at => (select ends_at from work_sessions where id = v_sesion) - interval '15 minutes',
    p_reason => 'Salio 15 minutos antes, confirmado con la encargada');

  select net_minutes into v_despues from work_sessions where id = v_sesion;

  perform test_assert(v_despues <> v_antes,
    'manager_adjust_time SI puede corregir las horas: el camino legitimo funciona');

  perform test_assert(
    exists (select 1 from time_adjustments
            where work_session_id = v_sesion and reason like 'Salio 15 minutos%'),
    'Y deja el rastro auditable con el motivo, que es la diferencia entera');

  raise notice '  --- pruebas de escritura directa completas ---';
end
$$;
rollback;

-- ===========================================================================
-- El autor de una correccion (§11.4) sin convertirse en un directorio de correos
-- ===========================================================================
--
-- `app_actor_display_name` es `security definer` y puede devolver correos de
-- `auth.users`. Una funcion asi, si acepta cualquier uuid, es un ORACULO: se llama en
-- bucle y se cosecha el directorio de usuarios del proyecto. Se cierra por los dos
-- lados y aqui se comprueban los dos, mas que el camino legitimo siga funcionando:
-- cerrar la puerta equivocada dejaria el historial sin autor y una prueba que solo
-- comprueba las negaciones pasaria igual con todo roto.
begin;
do $$
declare
  v_org        uuid := '11111111-1111-4111-8111-111111111111';
  v_otra_org   uuid := '99999999-9999-4999-8999-999999999999';
  v_gerenta    uuid := '33333333-3333-4333-8333-333333333332';
  v_propietaria uuid := '33333333-3333-4333-8333-333333333331';
  v_ajeno      uuid := '33333333-3333-4333-8333-333333333339';
  v_nombre     text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerenta, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Camino del NOMBRE: quien corrigio tiene ficha de empleado en esta organizacion.
  select app_actor_display_name(v_gerenta, v_org) into v_nombre;
  perform test_assert(v_nombre = 'Gerenta Demo',
    'El autor con ficha de empleado se resuelve por su nombre');

  -- Camino del RESPALDO: la propietaria NO tiene ficha de empleado, y sin el respaldo
  -- la columna diria un guion justo para quien mas corrige. Ese es el caso por el que
  -- la funcion existe.
  select app_actor_display_name(v_propietaria, v_org) into v_nombre;
  perform test_assert(v_nombre = 'demo-owner@krealoshift.invalid',
    'Un autor sin ficha de empleado se resuelve por su correo, no como un guion');

  -- BARRERA 2, por quien se pregunta. El usuario existe y es propietario de OTRA
  -- organizacion. Sin esta barrera, quien administra una tienda podria resolver el
  -- correo de cualquier usuario del proyecto pasando su uuid: el oraculo otra vez.
  select app_actor_display_name(v_ajeno, v_org) into v_nombre;
  perform test_assert(v_nombre is null,
    'No se resuelve un usuario que no pertenece a la organizacion preguntada');

  -- BARRERA 1, quien pregunta. La organizacion existe y el usuario tambien; lo que no
  -- existe es el derecho de esta gerenta a preguntar por ella.
  select app_actor_display_name(v_ajeno, v_otra_org) into v_nombre;
  perform test_assert(v_nombre is null,
    'No se resuelve nada de una organizacion que quien pregunta no administra');

  -- Un nulo no revienta ni devuelve basura: `created_by` puede ser null si la fila la
  -- escribio una funcion del sistema sin `auth.uid()`.
  select app_actor_display_name(null, v_org) into v_nombre;
  perform test_assert(v_nombre is null, 'Un autor nulo devuelve nulo y no revienta');

  raise notice '  --- pruebas del autor de correcciones completas ---';
end
$$;
rollback;

-- La vista: mismas filas que la RLS ya autoriza, con el autor traducido.
begin;
do $$
declare
  v_gerenta  uuid := '33333333-3333-4333-8333-333333333332';
  v_ajeno    uuid := '33333333-3333-4333-8333-333333333339';
  v_sesion   uuid;
  v_filas    integer;
  v_con_autor integer;
begin
  -- Se crea una correccion por el camino legitimo para tener algo que mirar.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gerenta, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select id into v_sesion from work_sessions
    where location_id = '22222222-2222-4222-8222-222222222221'
      and net_minutes is not null and ends_at is not null
    order by starts_at limit 1;

  if v_sesion is null then
    raise notice '  (sin sesiones cerradas en el seed, se omite)';
    return;
  end if;

  perform manager_adjust_time(
    p_work_session_id => v_sesion,
    p_expected_updated_at => (select updated_at from work_sessions where id = v_sesion),
    p_new_starts_at => (select starts_at from work_sessions where id = v_sesion),
    p_new_ends_at => (select ends_at from work_sessions where id = v_sesion) - interval '10 minutes',
    p_reason => 'Prueba del autor en la vista');

  select count(*), count(author_name)
    into v_filas, v_con_autor
    from time_adjustments_with_author
    where work_session_id = v_sesion;

  perform test_assert(v_filas > 0, 'La vista devuelve las correcciones de la sesion');
  perform test_assert(v_con_autor = v_filas,
    'Y TODAS traen autor: una columna que casi siempre esta vacia hace dudar del historial');

  perform test_assert(
    exists (select 1 from time_adjustments_with_author
            where work_session_id = v_sesion and author_name = 'Gerenta Demo'),
    'El autor de la vista es quien hizo la correccion, no otro');

  -- La vista NO es un agujero: lleva `security_invoker`, asi que filtra con la RLS de
  -- quien pregunta. Alguien de otra organizacion no ve nada de esta.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ajeno, 'role', 'authenticated')::text, true);

  select count(*) into v_filas from time_adjustments_with_author
    where organization_id = '11111111-1111-4111-8111-111111111111';

  perform test_assert(v_filas = 0,
    'Otra organizacion no ve ni una correccion a traves de la vista');

  raise notice '  --- pruebas de la vista con autor completas ---';
end
$$;
rollback;

-- Y anon no toca nada de esto.
begin;
do $$
begin
  perform test_assert(
    not has_function_privilege('anon',
      'public.app_actor_display_name(uuid, uuid)', 'execute'),
    'anon no puede ejecutar app_actor_display_name');

  perform test_assert(
    not has_table_privilege('anon', 'public.time_adjustments_with_author', 'select'),
    'anon no puede leer la vista de correcciones con autor');

  perform test_assert(
    has_table_privilege('authenticated', 'public.time_adjustments_with_author', 'select'),
    'authenticated SI puede leerla: es la que usa el panel');
end
$$;
rollback;
