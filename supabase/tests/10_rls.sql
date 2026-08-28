-- Krealo Shift — pruebas de Row Level Security (especificación §15)
--
-- Cubre las seis pruebas que la especificación exige explícitamente, más las que
-- hacen falta para confiar en las funciones seguras.
--
-- Cada prueba impersona a un usuario real cambiando `request.jwt.claims`, que es
-- la misma variable que usa Supabase. Si una prueba falla, el script aborta con
-- el mensaje: `ON_ERROR_STOP=1` hace que el runner devuelva error.

\set ON_ERROR_STOP on
\timing off
-- Silencia la tabla de resultados: lo unico que interesa son los NOTICE de cada
-- assert y que el script no aborte.
\pset tuples_only on
\pset format unaligned

create or replace function test_assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'FALLO: %', p_message using errcode = 'assert_failure';
  end if;
  raise notice '  ok — %', p_message;
end;
$$;

create or replace function test_impersonate(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

-- Identificadores del seed.
\set org_demo    '''11111111-1111-4111-8111-111111111111'''
\set org_other   '''99999999-9999-4999-8999-999999999999'''
\set loc_main    '''22222222-2222-4222-8222-222222222221'''
\set loc_branch  '''22222222-2222-4222-8222-222222222222'''
\set u_owner     '''33333333-3333-4333-8333-333333333331'''
\set u_manager   '''33333333-3333-4333-8333-333333333332'''
\set u_employee  '''33333333-3333-4333-8333-333333333333'''
\set u_other     '''33333333-3333-4333-8333-333333333339'''
\set e_sofia     '''55555555-5555-4555-8555-555555555551'''
\set e_marcos    '''55555555-5555-4555-8555-555555555552'''
\set e_diego     '''55555555-5555-4555-8555-555555555554'''
\set device_main '''66666666-6666-4666-8666-666666666661'''

-- ===========================================================================
-- Prueba 1 — un empleado no puede leer las horas de otro empleado
-- ===========================================================================

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_employee, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select test_assert(
    (select count(*) from work_sessions where employee_id = :e_marcos) = 0,
    'Sofia no ve ninguna sesion de trabajo de Marcos');

  select test_assert(
    (select count(*) from time_events where employee_id = :e_marcos) = 0,
    'Sofia no ve ningun evento de tiempo de Marcos');

  -- Y sí ve los suyos: una política que oculta todo no prueba nada.
  select test_assert(
    (select count(*) from work_sessions where employee_id = :e_sofia) >= 1,
    'Sofia si ve su propia sesion abierta');
rollback;

-- ===========================================================================
-- Prueba 2 — el gerente de Sede Principal no ve Sucursal Demo
-- ===========================================================================

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select test_assert(
    (select count(*) from shifts where location_id = :loc_branch) = 0,
    'La gerenta de Sede Principal no ve turnos de Sucursal Demo');

  select test_assert(
    (select count(*) from employees where id = :e_diego) = 0,
    'La gerenta no ve a Diego, que solo trabaja en Sucursal Demo');

  select test_assert(
    (select count(*) from shifts where location_id = :loc_main) >= 1,
    'La gerenta si ve los turnos de su propia tienda');

  -- Ve los borradores de su tienda; el empleado no (se comprueba abajo).
  select test_assert(
    (select count(*) from shifts where location_id = :loc_main and status = 'draft') >= 1,
    'La gerenta si ve los turnos en borrador de su tienda');
rollback;

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_employee, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select test_assert(
    (select count(*) from shifts where employee_id = :e_sofia and status = 'draft') = 0,
    'Sofia no ve sus propios turnos en borrador, solo los publicados');

  select test_assert(
    (select count(*) from shifts where employee_id = :e_sofia and status = 'published') >= 1,
    'Sofia si ve sus turnos publicados');
rollback;

-- ===========================================================================
-- Prueba 3 — un empleado no puede insertar un evento directo
-- ===========================================================================

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_employee, 'role', 'authenticated')::text, true);
  set local role authenticated;

  do $$
  begin
    insert into time_events (organization_id, employee_id, location_id, event_type,
                             occurred_at, idempotency_key)
    values ('11111111-1111-4111-8111-111111111111',
            '55555555-5555-4555-8555-555555555551',
            '22222222-2222-4222-8222-222222222221',
            'clock_in', now(), gen_random_uuid());
    raise exception 'FALLO: un empleado pudo insertar un evento de tiempo directo'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — el empleado no puede insertar un evento de tiempo directo';
    when assert_failure then raise;
  end
  $$;
rollback;

-- ===========================================================================
-- Prueba 4 — un kiosco revocado no puede enviar ni sincronizar
-- ===========================================================================

begin;
  -- Se revoca el dispositivo del seed y se intenta registrar un evento con él.
  update kiosk_devices set status = 'revoked', revoked_at = now()
    where id = '66666666-6666-4666-8666-666666666661';

  do $$
  begin
    perform submit_time_event(
      p_device_id => '66666666-6666-4666-8666-666666666661',
      p_employee_id => '55555555-5555-4555-8555-555555555554',
      p_event_type => 'clock_in',
      p_idempotency_key => gen_random_uuid());
    raise exception 'FALLO: un kiosco revocado pudo registrar un evento'
      using errcode = 'assert_failure';
  exception
    when invalid_authorization_specification then
      raise notice '  ok — un kiosco revocado no puede registrar eventos';
    when assert_failure then raise;
  end
  $$;

  -- Y tampoco puede autenticarse para sincronizar.
  do $$
  begin
    perform authenticate_kiosk('demo-kiosk-main', 'demo-credential-sede-principal');
    raise exception 'FALLO: un kiosco revocado se pudo autenticar'
      using errcode = 'assert_failure';
  exception
    when invalid_authorization_specification then
      raise notice '  ok — un kiosco revocado no se puede autenticar';
    when assert_failure then raise;
  end
  $$;
rollback;

-- ===========================================================================
-- Prueba 5 — no se puede eliminar al último propietario
-- ===========================================================================

begin;
  do $$
  begin
    delete from organization_memberships
      where organization_id = '11111111-1111-4111-8111-111111111111'
        and role = 'owner';
    raise exception 'FALLO: se pudo eliminar al ultimo propietario'
      using errcode = 'assert_failure';
  exception
    when restrict_violation then
      raise notice '  ok — no se puede eliminar al ultimo propietario';
    when assert_failure then raise;
  end
  $$;

  -- Tampoco degradándolo a otro rol.
  do $$
  begin
    update organization_memberships set role = 'admin'
      where organization_id = '11111111-1111-4111-8111-111111111111'
        and role = 'owner';
    raise exception 'FALLO: se pudo degradar al ultimo propietario'
      using errcode = 'assert_failure';
  exception
    when restrict_violation then
      raise notice '  ok — no se puede degradar al ultimo propietario';
    when assert_failure then raise;
  end
  $$;

  -- Con un segundo propietario sí se permite: la regla protege el último, no
  -- congela la administración.
  insert into auth.users (id, email)
    values ('33333333-3333-4333-8333-333333333334', 'demo-owner2@krealoshift.invalid')
    on conflict (id) do nothing;
  insert into organization_memberships (organization_id, user_id, role)
    values ('11111111-1111-4111-8111-111111111111',
            '33333333-3333-4333-8333-333333333334', 'owner');

  delete from organization_memberships
    where organization_id = '11111111-1111-4111-8111-111111111111'
      and user_id = '33333333-3333-4333-8333-333333333331';

  select test_assert(
    (select count(*) from organization_memberships
      where organization_id = '11111111-1111-4111-8111-111111111111'
        and role = 'owner' and status = 'active') = 1,
    'Con dos propietarios si se puede eliminar uno');
rollback;

-- ===========================================================================
-- Prueba 6 — un usuario de otra organización no lee NINGUNA fila de la primera
-- ===========================================================================

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_other, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select test_assert(
    (select count(*) from organizations where id = :org_demo) = 0,
    'Otra empresa no ve la organizacion Krealo Media Demo');
  select test_assert(
    (select count(*) from locations where organization_id = :org_demo) = 0,
    'Otra empresa no ve las ubicaciones');
  select test_assert(
    (select count(*) from employees where organization_id = :org_demo) = 0,
    'Otra empresa no ve los empleados');
  select test_assert(
    (select count(*) from shifts where organization_id = :org_demo) = 0,
    'Otra empresa no ve los turnos');
  select test_assert(
    (select count(*) from time_events where organization_id = :org_demo) = 0,
    'Otra empresa no ve los eventos de tiempo');
  select test_assert(
    (select count(*) from work_sessions where organization_id = :org_demo) = 0,
    'Otra empresa no ve las sesiones de trabajo');
  select test_assert(
    (select count(*) from time_edit_requests where organization_id = :org_demo) = 0,
    'Otra empresa no ve las solicitudes');
  select test_assert(
    (select count(*) from audit_logs where organization_id = :org_demo) = 0,
    'Otra empresa no ve la auditoria');
  select test_assert(
    (select count(*) from job_roles where organization_id = :org_demo) = 0,
    'Otra empresa no ve los puestos');
  select test_assert(
    (select count(*) from announcements where organization_id = :org_demo) = 0,
    'Otra empresa no ve los anuncios');
rollback;

-- ===========================================================================
-- Secretos: nadie lee hashes de PIN, credenciales ni códigos de activación
-- ===========================================================================

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  do $$
  begin
    perform 1 from employee_pin_credentials limit 1;
    raise exception 'FALLO: se pudo leer employee_pin_credentials'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — ni el propietario puede leer los hashes de PIN';
    when assert_failure then raise;
  end
  $$;

  do $$
  begin
    perform 1 from kiosk_activation_codes limit 1;
    raise exception 'FALLO: se pudo leer kiosk_activation_codes'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — nadie puede leer los codigos de activacion';
    when assert_failure then raise;
  end
  $$;

  do $$
  begin
    perform 1 from kiosk_devices limit 1;
    raise exception 'FALLO: se pudo leer kiosk_devices con su credential_hash'
      using errcode = 'assert_failure';
  exception
    when insufficient_privilege then
      raise notice '  ok — kiosk_devices no se lee directo desde el cliente';
    when assert_failure then raise;
  end
  $$;
rollback;

-- ===========================================================================
-- Escalamiento de rol: un empleado no se asciende a sí mismo
-- ===========================================================================

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_employee, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update organization_memberships set role = 'owner'
    where user_id = '33333333-3333-4333-8333-333333333333';

  -- La política filtra la fila, así que el update no afecta nada en lugar de
  -- fallar. Lo que importa es que el rol NO cambió.
  reset role;
  select set_config('request.jwt.claims', null, true);

  select test_assert(
    (select role from organization_memberships
      where user_id = '33333333-3333-4333-8333-333333333333') = 'employee',
    'Un empleado no puede ascenderse a propietario');
rollback;

-- ===========================================================================
-- Append-only: los eventos y la auditoría no se modifican ni se borran
-- ===========================================================================

begin;
  do $$
  declare v_id uuid;
  begin
    select id into v_id from time_events limit 1;
    begin
      update time_events set occurred_at = now() where id = v_id;
      raise exception 'FALLO: se pudo modificar un evento de tiempo'
        using errcode = 'assert_failure';
    exception
      when restrict_violation then
        raise notice '  ok — un evento de tiempo no se puede modificar';
    end;
    begin
      delete from time_events where id = v_id;
      raise exception 'FALLO: se pudo borrar un evento de tiempo'
        using errcode = 'assert_failure';
    exception
      when restrict_violation then
        raise notice '  ok — un evento de tiempo no se puede borrar';
    end;
  end
  $$;

  do $$
  declare v_id uuid;
  begin
    select id into v_id from audit_logs limit 1;
    if v_id is null then
      raise notice '  (sin filas de auditoria en el seed, se omite)';
      return;
    end if;
    begin
      delete from audit_logs where id = v_id;
      raise exception 'FALLO: se pudo borrar un registro de auditoria'
        using errcode = 'assert_failure';
    exception
      when restrict_violation then
        raise notice '  ok — la auditoria no se puede borrar';
    end;
  end
  $$;
rollback;

-- ===========================================================================
-- Un turno publicado no se borra: se cancela
-- ===========================================================================

-- ===========================================================================
-- La vista de kioscos del administrador no filtra los secretos del dispositivo
-- ===========================================================================

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- La gerenta SI ve el inventario de su tienda: sin esto no puede revocar un
  -- iPad perdido, que es el corte de emergencia del modelo kiosco.
  select test_assert(
    (select count(*) from kiosk_devices_admin where location_id = :loc_main) >= 1,
    'La gerenta ve el inventario de kioscos de su tienda');

  -- Que la TABLA siga revocada ya se comprueba mas arriba ("kiosk_devices no se
  -- lee directo desde el cliente"). La vista existe justamente para que esa
  -- revocacion pueda seguir en pie, y las dos pruebas juntas son el par que
  -- importa: se ve el inventario, no se ve el secreto.
rollback;

begin;
  set local role authenticated;

  -- LOS DOS SECRETOS DEL DISPOSITIVO NO ESTAN EN LA VISTA. Con offline_key mas el
  -- archivo SQLite de un iPad se pueden probar los 10^6 PIN posibles, asi que esta
  -- comprobacion es la que sostiene todo el modelo de PIN sin conexion.
  select test_assert(
    not exists (
      select 1 from information_schema.columns
      where table_name = 'kiosk_devices_admin'
        and column_name in ('credential_hash', 'offline_key')
    ),
    'La vista de kioscos NO expone credential_hash ni offline_key');
rollback;

begin;
  set local role authenticated;

  -- LAS COLUMNAS QUE LEE EL PANEL, fijadas por nombre.
  --
  -- Esta prueba existe por un fallo concreto: la consulta del panel apuntaba a la
  -- TABLA `kiosk_devices` en vez de a esta vista, y nada lo detecto. El nombre de
  -- una relacion es una cadena, asi que `tsc` no puede verlo, las pruebas de Jest
  -- no tocan la base, y las pruebas SQL comprobaban la vista pero no que alguien
  -- la estuviera usando. El sintoma en produccion era "permiso denegado" en
  -- Configuracion y el boton de revocar un iPad perdido inalcanzable.
  --
  -- Lo que fija esto es la otra mitad: si alguien renombra o quita una de estas
  -- columnas, falla aqui y no en la pantalla.
  select test_assert(
    (select count(*) from information_schema.columns
      where table_name = 'kiosk_devices_admin'
        and column_name in ('id', 'organization_id', 'location_id', 'location_name',
                            'device_public_id', 'display_name', 'status', 'app_version',
                            'last_seen_at', 'last_sync_at', 'minutes_since_seen',
                            'minutes_since_sync')) = 12,
    'La vista de kioscos expone las 12 columnas que lee el panel');
rollback;

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- `minutes_since_sync` es null solo si nunca vacio la cola, y nunca negativo.
  -- Ese null es el caso NORMAL de una tienda con red estable, no un problema: el
  -- panel lo muestra como "nada pendiente". Antes se trataba como atrasado y eso
  -- marcaba en ambar todos los kioscos sanos.
  select test_assert(
    not exists (
      select 1 from kiosk_devices_admin
      where (minutes_since_sync is null) <> (last_sync_at is null)
         or minutes_since_sync < 0
    ),
    'minutes_since_sync es null si y solo si nunca vacio la cola, y nunca negativo');

  -- `minutes_since_seen` NUNCA es null: es lo que mide el aviso del §19, y un null
  -- ahi obligaria a decidir en el cliente si eso cuenta como atrasado, que es
  -- exactamente la ambiguedad que produjo el fallo.
  select test_assert(
    not exists (
      select 1 from kiosk_devices_admin
      where minutes_since_seen is null or minutes_since_seen < 0
    ),
    'minutes_since_seen nunca es null ni negativo');

  -- El nombre de la tienda viene resuelto en la vista: el panel lo muestra tal
  -- cual y no hace una segunda consulta por cada kiosco.
  select test_assert(
    not exists (select 1 from kiosk_devices_admin where coalesce(location_name, '') = ''),
    'Cada kiosco del inventario trae el nombre de su tienda');
rollback;

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_other, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Aislamiento entre empresas, tambien en la vista.
  select test_assert(
    (select count(*) from kiosk_devices_admin) = 0,
    'La duena de otra empresa no ve ningun kiosco de Krealo Media Demo');
rollback;

-- ===========================================================================
-- Quien puede administrar una organizacion (logotipos, ajustes de empresa)
-- ===========================================================================

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select test_assert(
    app_administers_organization(:org_demo),
    'La propietaria administra su organizacion');
  select test_assert(
    not app_administers_organization(:org_other),
    'La propietaria NO administra la organizacion ajena');
rollback;

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Esto es lo que separa "administrar una tienda" de "administrar la empresa".
  -- Una gerenta gestiona su ubicacion pero no cambia el logotipo ni los ajustes de
  -- la organizacion: si pudiera, el logotipo de la empresa quedaria en manos de
  -- cualquiera con permiso de tienda, que es una suplantacion barata.
  select test_assert(
    not app_administers_organization(:org_demo),
    'Una gerenta de tienda NO administra la organizacion');
  select test_assert(
    app_manages_location(:loc_main),
    'Pero si administra su propia ubicacion');
rollback;

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', :u_employee, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select test_assert(
    not app_administers_organization(:org_demo),
    'Una empleada NO administra la organizacion');
rollback;

begin;
  do $$
  declare v_id uuid;
  begin
    select id into v_id from shifts where status = 'published' limit 1;
    delete from shifts where id = v_id;
    raise exception 'FALLO: se pudo borrar un turno publicado'
      using errcode = 'assert_failure';
  exception
    when restrict_violation then
      raise notice '  ok — un turno publicado no se puede borrar';
    when assert_failure then raise;
  end
  $$;
rollback;

\echo '  --- pruebas de RLS completas ---'
