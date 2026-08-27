-- =============================================================================
-- Krealo Shift — dar acceso al panel a tu usuario
-- =============================================================================
--
-- CUANDO SE USA
-- Despues de haber ejecutado `supabase/instalar-todo.sql` Y de haber creado tu
-- usuario en el panel de Supabase:
--
--   Authentication -> Users -> Add user -> Create new user
--     Email: el tuyo
--     Password: la que quieras
--     [x] Auto Confirm User   <- IMPORTANTE, si no queda sin confirmar y no entra
--
-- POR QUE EL USUARIO SE CREA EN EL PANEL Y NO AQUI
-- Un usuario que pueda iniciar sesion necesita filas correctas en `auth.users` y en
-- `auth.identities`, con el formato exacto que espera el servicio de autenticacion de
-- Supabase. Ese formato cambia entre versiones. Crearlo desde el panel es tres clics
-- y sale bien siempre; hacerlo con SQL a mano es adivinar, y el sintoma de adivinar
-- mal es un "credenciales invalidas" que no explica nada.
--
-- Este archivo solo hace la parte que el panel no puede: conectar ese usuario con la
-- organizacion de demostracion como propietario, que es lo que le abre el panel.
--
-- COMO SE USA
--   1. Cambia el correo de la linea de abajo por el tuyo
--   2. SQL Editor -> New query -> pega esto -> Run
-- =============================================================================

do $$
declare
  -- ⬇⬇⬇  CAMBIA ESTO POR TU CORREO  ⬇⬇⬇
  v_correo text := 'andree@krealomedia.com';

  v_org uuid := '11111111-1111-4111-8111-111111111111';  -- Krealo Media Demo
  v_loc uuid := '22222222-2222-4222-8222-222222222221';  -- Sede Principal
  v_user uuid;
  v_empleado uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_correo);

  if v_user is null then
    raise exception
      'No existe ningun usuario con el correo %. Crealo primero en '
      'Authentication -> Users -> Add user, con "Auto Confirm User" marcado.', v_correo
      using errcode = 'no_data_found';
  end if;

  if not exists (select 1 from public.organizations where id = v_org) then
    raise exception
      'No existe la organizacion de demostracion. Ejecuta primero '
      'supabase/instalar-todo.sql.'
      using errcode = 'no_data_found';
  end if;

  -- Perfil. `on conflict` para poder repetir esto sin romper nada.
  insert into public.profiles (id, full_name, locale)
  values (v_user, split_part(v_correo, '@', 1), 'es-PE')
  on conflict (id) do nothing;

  -- OWNER y no admin: es quien puede ver y cambiar todo, incluidos los ajustes de la
  -- organizacion y el inventario de kioscos.
  insert into public.organization_memberships (organization_id, user_id, role)
  values (v_org, v_user, 'owner')
  on conflict (organization_id, user_id) do update set role = 'owner';

  -- Ademas se crea una ficha de empleado ligada a la cuenta y asignada a Sede
  -- Principal, con permiso de administrar la tienda. Sin esto el panel funciona pero
  -- no apareces en el equipo ni puedes fichar en el kiosco, y media aplicacion se ve
  -- vacia sin motivo aparente.
  select id into v_empleado from public.employees where user_id = v_user;

  if v_empleado is null then
    insert into public.employees (organization_id, user_id, full_name, preferred_name, status, hire_date)
    values (v_org, v_user, split_part(v_correo, '@', 1), split_part(v_correo, '@', 1),
            'active', current_date)
    returning id into v_empleado;
  end if;

  insert into public.employee_location_assignments (employee_id, location_id, can_manage, is_primary)
  values (v_empleado, v_loc, true, true)
  on conflict (employee_id, location_id) do update set can_manage = true;

  -- Un PIN para poder probar el kiosco tambien. Se puede cambiar despues desde el
  -- panel, en Equipo.
  perform public.set_employee_pin(v_empleado, '246810');

  raise notice '';
  raise notice 'Listo. % es propietario de Krealo Media Demo.', v_correo;
  raise notice 'Entra al panel con ese correo y su contraseña.';
  raise notice 'Para probar el kiosco, su PIN es 246810 (cambialo en Equipo).';
  raise notice '';
end
$$;
