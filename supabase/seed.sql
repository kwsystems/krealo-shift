-- Krealo Shift — datos de demostración (especificación §27)
--
-- Todo es ficticio: ninguna persona real, ningún correo real, ninguna contraseña
-- en el repositorio (§22, §27). Los usuarios de auth se crean aparte con
-- `scripts/seed-demo-users.mjs`, que lee la contraseña de una variable de entorno.
--
-- Los horarios son RELATIVOS a `now()`, no fechas fijas: así el demo siempre
-- muestra a alguien trabajando, alguien en descanso, alguien atrasado y alguien
-- sin turno, sin tener que regenerar los datos cada semana.
--
-- Es idempotente: se puede volver a ejecutar sobre la misma base.

begin;

-- ---------------------------------------------------------------------------
-- Identificadores fijos, para que el seed y las pruebas hablen de lo mismo
-- ---------------------------------------------------------------------------

do $$
declare
  v_org_id      uuid := '11111111-1111-4111-8111-111111111111';
  v_loc_main    uuid := '22222222-2222-4222-8222-222222222221';
  v_loc_branch  uuid := '22222222-2222-4222-8222-222222222222';
  v_other_org   uuid := '99999999-9999-4999-8999-999999999999';
  v_other_loc   uuid := '99999999-9999-4999-8999-999999999991';

  v_user_owner    uuid := '33333333-3333-4333-8333-333333333331';
  v_user_manager  uuid := '33333333-3333-4333-8333-333333333332';
  -- Empleada CON cuenta: en P0/P1 los empleados fichan solo con PIN, pero la
  -- especificacion exige probar que un empleado no lee las horas de otro (§15),
  -- y para eso hace falta al menos una cuenta con rol employee.
  v_user_employee uuid := '33333333-3333-4333-8333-333333333333';
  v_user_other    uuid := '33333333-3333-4333-8333-333333333339';

  v_role_lead    uuid := '44444444-4444-4444-8444-444444444441';
  v_role_service uuid := '44444444-4444-4444-8444-444444444442';
  v_role_part    uuid := '44444444-4444-4444-8444-444444444443';

  v_emp_manager uuid := '55555555-5555-4555-8555-555555555550';
  v_emp_working uuid := '55555555-5555-4555-8555-555555555551';
  v_emp_break   uuid := '55555555-5555-4555-8555-555555555552';
  v_emp_late    uuid := '55555555-5555-4555-8555-555555555553';
  v_emp_noshift uuid := '55555555-5555-4555-8555-555555555554';
  v_emp_other   uuid := '55555555-5555-4555-8555-555555555559';

  v_device_main uuid := '66666666-6666-4666-8666-666666666661';

  v_today date := (now() at time zone 'America/Lima')::date;
  v_week_start date;
  v_session_working uuid;
  v_session_break uuid;
  v_session_done uuid;
  v_ev uuid;
  d integer;
  v_shift_id uuid;
begin
  v_week_start := v_today - ((extract(isodow from v_today)::int - 1));

  -- -------------------------------------------------------------------------
  -- Usuarios de auth
  -- -------------------------------------------------------------------------
  -- En Supabase real estos usuarios se crean con la Auth API mediante
  -- `scripts/seed-demo-users.mjs`, para que la contraseña no viva en Git. Aquí
  -- solo aseguramos que la fila exista, porque el resto del seed la referencia.
  insert into auth.users (id, email) values
    (v_user_owner,    'demo-owner@krealoshift.invalid'),
    (v_user_manager,  'demo-manager@krealoshift.invalid'),
    (v_user_employee, 'demo-empleada@krealoshift.invalid'),
    (v_user_other,    'demo-otra-empresa@krealoshift.invalid')
  on conflict (id) do nothing;

  insert into profiles (id, full_name, locale) values
    (v_user_owner,    'Propietaria Demo', 'es-PE'),
    (v_user_manager,  'Gerenta Demo',     'es-PE'),
    (v_user_employee, 'Sofia Demo',       'es-PE'),
    (v_user_other,    'Ajena Demo',       'es-PE')
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- Organización de demostración
  -- -------------------------------------------------------------------------

  insert into organizations (id, name, slug, default_locale, default_timezone, week_starts_on)
  values (v_org_id, 'Krealo Media Demo', 'krealo-media-demo', 'es-PE', 'America/Lima', 1)
  on conflict (id) do nothing;

  -- Segunda organización: existe SOLO para probar que el aislamiento funciona.
  -- Sin ella, una prueba de RLS entre empresas no prueba nada (§15).
  insert into organizations (id, name, slug) values
    (v_other_org, 'Empresa Ajena Demo', 'empresa-ajena-demo')
  on conflict (id) do nothing;

  insert into organization_memberships (organization_id, user_id, role) values
    (v_org_id, v_user_owner, 'owner'),
    (v_org_id, v_user_manager, 'manager'),
    (v_org_id, v_user_employee, 'employee'),
    (v_other_org, v_user_other, 'owner')
  on conflict (organization_id, user_id) do nothing;

  -- -------------------------------------------------------------------------
  -- Ubicaciones, con políticas DISTINTAS para comprobar aislamiento (§27)
  -- -------------------------------------------------------------------------

  insert into locations (id, organization_id, name, address, timezone, settings) values
    (v_loc_main, v_org_id, 'Sede Principal', 'Av. Demo 123, Lima', 'America/Lima',
     jsonb_build_object(
       'pinLength', 6, 'photoEnabled', false, 'photoRetentionDays', 30,
       'earlyClockInMinutes', 10, 'lateGraceMinutes', 5,
       'allowUnscheduledShifts', true, 'timeFormat', '24h',
       'requiredBreakMinutes', 30,
       'dailyOvertimeThresholdMinutes', 480, 'weeklyOvertimeThresholdMinutes', 2880)),
    (v_loc_branch, v_org_id, 'Sucursal Demo', 'Jr. Demo 456, Lima', 'America/Lima',
     jsonb_build_object(
       'pinLength', 4, 'photoEnabled', false, 'photoRetentionDays', 15,
       'earlyClockInMinutes', 0, 'lateGraceMinutes', 0,
       'allowUnscheduledShifts', false, 'timeFormat', '12h',
       'requiredBreakMinutes', 0,
       'dailyOvertimeThresholdMinutes', 540, 'weeklyOvertimeThresholdMinutes', 2400))
  on conflict (id) do nothing;

  insert into locations (id, organization_id, name, timezone) values
    (v_other_loc, v_other_org, 'Sede Ajena', 'America/Lima')
  on conflict (id) do nothing;

  insert into job_roles (id, organization_id, name, color) values
    (v_role_lead,    v_org_id, 'Encargada',           '#7157E8'),
    (v_role_service, v_org_id, 'Atención al cliente', '#2A6FA8'),
    (v_role_part,    v_org_id, 'Part-time',           '#16845B')
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- Personas
  -- -------------------------------------------------------------------------
  -- La gerenta tiene además turnos como empleada: la especificación lo exige (§7).

  insert into employees (id, organization_id, user_id, full_name, preferred_name, status, hire_date) values
    (v_emp_manager, v_org_id, v_user_manager, 'Gerenta Demo',      'Gerenta', 'active', v_today - 400),
    (v_emp_working, v_org_id, v_user_employee, 'Sofía Demo',        'Sofía',   'active', v_today - 300),
    (v_emp_break,   v_org_id, null,           'Marcos Demo',       'Marcos',  'active', v_today - 200),
    (v_emp_late,    v_org_id, null,           'Lucía Demo',        'Lucía',   'active', v_today - 100),
    (v_emp_noshift, v_org_id, null,           'Diego Demo',        'Diego',   'active', v_today - 50)
  on conflict (id) do nothing;

  insert into employees (id, organization_id, full_name, status) values
    (v_emp_other, v_other_org, 'Empleado Ajeno', 'active')
  on conflict (id) do nothing;

  -- Asignaciones. La gerenta administra Sede Principal y NO Sucursal Demo: es lo
  -- que permite probar que no ve la otra tienda (§15 prueba 2).
  insert into employee_location_assignments (employee_id, location_id, can_manage, is_primary) values
    (v_emp_manager, v_loc_main,   true,  true),
    (v_emp_working, v_loc_main,   false, true),
    (v_emp_break,   v_loc_main,   false, true),
    (v_emp_late,    v_loc_main,   false, true),
    (v_emp_noshift, v_loc_branch, false, true),
    -- Sofía trabaja en las dos tiendas: un empleado puede tener varias (§7).
    (v_emp_working, v_loc_branch, false, false),
    (v_emp_other,   v_other_loc,  false, true)
  on conflict (employee_id, location_id) do nothing;

  insert into employee_job_roles (employee_id, job_role_id, is_primary) values
    (v_emp_manager, v_role_lead,    true),
    (v_emp_working, v_role_service, true),
    (v_emp_break,   v_role_service, true),
    (v_emp_late,    v_role_part,    true),
    (v_emp_noshift, v_role_part,    true)
  on conflict (employee_id, job_role_id) do nothing;

  -- PIN de cada empleado. Se generan con la función segura, así que en la base
  -- solo queda el hash bcrypt. Los valores son obvios A PROPÓSITO: son de demo y
  -- nunca deben usarse en producción.
  perform set_employee_pin(v_emp_manager, '246810');
  perform set_employee_pin(v_emp_working, '135791');
  perform set_employee_pin(v_emp_break,   '112233');
  perform set_employee_pin(v_emp_late,    '445566');
  perform set_employee_pin(v_emp_noshift, '7788');   -- Sucursal usa PIN de 4

  -- -------------------------------------------------------------------------
  -- Kiosco de Sede Principal
  -- -------------------------------------------------------------------------
  -- La credencial es un valor de demo conocido para poder probar el flujo; en
  -- producción la emite `activate_kiosk_device` y nunca se escribe a mano.
  insert into kiosk_devices
    (id, organization_id, location_id, display_name, device_public_id,
     credential_hash, app_version, last_seen_at, created_by)
  values
    (v_device_main, v_org_id, v_loc_main, 'iPad Sede Principal', 'demo-kiosk-main',
     extensions.crypt('demo-credential-sede-principal', extensions.gen_salt('bf', 10)),
     '1.0.0', now(), v_user_owner)
  on conflict (id) do nothing;

  -- -------------------------------------------------------------------------
  -- Turnos: dos semanas, la anterior y la actual (§27)
  -- -------------------------------------------------------------------------

  for d in -7..6 loop
    -- Sofía: turno de mañana todos los días laborables.
    if extract(isodow from v_week_start + d) between 1 and 5 then
      insert into shifts (organization_id, location_id, employee_id, job_role_id,
                          starts_at, ends_at, timezone, planned_unpaid_break_minutes,
                          status, publication_version, published_at, employee_note)
      values (v_org_id, v_loc_main, v_emp_working, v_role_service,
              ((v_week_start + d)::text || ' 09:00')::timestamp at time zone 'America/Lima',
              ((v_week_start + d)::text || ' 18:00')::timestamp at time zone 'America/Lima',
              'America/Lima', 60, 'published', 1, now() - interval '3 days',
              case when d = 0 then 'Hoy llega pedido nuevo a las 11:00' else null end)
      on conflict do nothing;

      insert into shifts (organization_id, location_id, employee_id, job_role_id,
                          starts_at, ends_at, timezone, planned_unpaid_break_minutes,
                          status, publication_version, published_at)
      values (v_org_id, v_loc_main, v_emp_break, v_role_service,
              ((v_week_start + d)::text || ' 10:00')::timestamp at time zone 'America/Lima',
              ((v_week_start + d)::text || ' 19:00')::timestamp at time zone 'America/Lima',
              'America/Lima', 60, 'published', 1, now() - interval '3 days')
      on conflict do nothing;
    end if;

    -- Lucía: turno de tarde de miércoles a domingo.
    if extract(isodow from v_week_start + d) in (3, 4, 5, 6, 7) then
      insert into shifts (organization_id, location_id, employee_id, job_role_id,
                          starts_at, ends_at, timezone, status, publication_version, published_at)
      values (v_org_id, v_loc_main, v_emp_late, v_role_part,
              ((v_week_start + d)::text || ' 14:00')::timestamp at time zone 'America/Lima',
              ((v_week_start + d)::text || ' 20:00')::timestamp at time zone 'America/Lima',
              'America/Lima', 'published', 1, now() - interval '3 days')
      on conflict do nothing;
    end if;
  end loop;

  -- Un turno en BORRADOR de la semana que viene: sirve para probar que el
  -- empleado no lo ve y el administrador sí (§15).
  insert into shifts (organization_id, location_id, employee_id, job_role_id,
                      starts_at, ends_at, timezone, status, manager_note)
  values (v_org_id, v_loc_main, v_emp_working, v_role_lead,
          ((v_week_start + 8)::text || ' 09:00')::timestamp at time zone 'America/Lima',
          ((v_week_start + 8)::text || ' 18:00')::timestamp at time zone 'America/Lima',
          'America/Lima', 'draft', 'Revisar si necesita cobertura')
  on conflict do nothing;

  insert into shift_publications
    (organization_id, location_id, week_starts_on, publication_version, published_by, published_at)
  values (v_org_id, v_loc_main, v_week_start, 1, v_user_manager, now() - interval '3 days')
  on conflict do nothing;

  -- -------------------------------------------------------------------------
  -- Estados de asistencia de hoy (§27)
  -- -------------------------------------------------------------------------
  -- Se insertan los eventos crudos y se deja que la proyección se construya con
  -- la misma función que usa el kiosco: si el seed construyera las sesiones a
  -- mano, el demo probaría un camino que el producto no recorre.

  -- Sofía: TRABAJANDO desde hace 3 horas.
  if not exists (select 1 from work_sessions where employee_id = v_emp_working and status = 'open') then
    select id into v_shift_id from shifts
      where employee_id = v_emp_working and status = 'published'
        and starts_at::date = v_today limit 1;

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_working, v_loc_main, v_shift_id, 'clock_in', 'kiosk',
            now() - interval '3 hours', 'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);
  end if;

  -- Marcos: EN DESCANSO desde hace 20 minutos.
  if not exists (select 1 from work_sessions where employee_id = v_emp_break and status = 'open') then
    select id into v_shift_id from shifts
      where employee_id = v_emp_break and status = 'published'
        and starts_at::date = v_today limit 1;

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_break, v_loc_main, v_shift_id, 'clock_in', 'kiosk',
            now() - interval '4 hours', 'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             break_type, source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_break, v_loc_main, v_shift_id, 'break_start', 'meal', 'kiosk',
            now() - interval '20 minutes', 'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);
  end if;

  -- Lucía: ATRASADA. Su turno de ayer se cerró tarde y hoy no ha fichado todavía.
  -- Una sesión COMPLETA de ayer, con descanso cerrado.
  if not exists (select 1 from work_sessions where employee_id = v_emp_late) then
    select id into v_shift_id from shifts
      where employee_id = v_emp_late and starts_at::date = v_today - 1 limit 1;

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             source, occurred_at, timezone, idempotency_key, device_id, metadata)
    values (v_org_id, v_emp_late, v_loc_main, v_shift_id, 'clock_in', 'kiosk',
            (( (v_today - 1)::text || ' 14:20')::timestamp at time zone 'America/Lima'),
            'America/Lima', gen_random_uuid(), v_device_main,
            jsonb_build_object('note', 'entrada tardia de demo'))
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             break_type, source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_late, v_loc_main, v_shift_id, 'break_start', 'unpaid', 'kiosk',
            (( (v_today - 1)::text || ' 17:00')::timestamp at time zone 'America/Lima'),
            'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             break_type, source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_late, v_loc_main, v_shift_id, 'break_end', 'unpaid', 'kiosk',
            (( (v_today - 1)::text || ' 17:30')::timestamp at time zone 'America/Lima'),
            'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);

    insert into time_events (organization_id, employee_id, location_id, shift_id, event_type,
                             source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_late, v_loc_main, v_shift_id, 'clock_out', 'kiosk',
            (( (v_today - 1)::text || ' 20:10')::timestamp at time zone 'America/Lima'),
            'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);
  end if;

  -- Una sesión INCOMPLETA de la gerenta: entró anteayer y nunca marcó salida.
  -- Es el caso que el panel debe señalar como fichaje incompleto (§11.1).
  if not exists (select 1 from work_sessions where employee_id = v_emp_manager) then
    insert into time_events (organization_id, employee_id, location_id, event_type,
                             source, occurred_at, timezone, idempotency_key, device_id)
    values (v_org_id, v_emp_manager, v_loc_main, 'clock_in', 'kiosk',
            (( (v_today - 2)::text || ' 08:55')::timestamp at time zone 'America/Lima'),
            'America/Lima', gen_random_uuid(), v_device_main)
    returning id into v_ev;
    perform apply_event_to_projection(v_ev);

    update work_sessions
      set status = 'needs_review', flags = array['missing_clock_out']
      where employee_id = v_emp_manager and status = 'open';
  end if;

  -- Diego queda SIN TURNO y sin fichajes a propósito: es el cuarto estado que
  -- pide la especificación.

  -- -------------------------------------------------------------------------
  -- Solicitudes, periodo y anuncio
  -- -------------------------------------------------------------------------

  insert into time_edit_requests
    (organization_id, employee_id, location_id, target_date, kind, proposed_value, reason, status)
  values
    (v_org_id, v_emp_late, v_loc_main, v_today - 2, 'forgot_clock_out',
     jsonb_build_object('proposedAt', (v_today - 2)::text || 'T20:00:00-05:00'),
     'Olvidé marcar salida, cerré la tienda a las 20:00', 'pending'),
    (v_org_id, v_emp_noshift, v_loc_branch, v_today - 5, 'forgot_clock_in',
     jsonb_build_object('proposedAt', (v_today - 5)::text || 'T09:05:00-05:00'),
     'El iPad estaba sin batería cuando llegué', 'approved')
  on conflict do nothing;

  insert into timesheet_periods (organization_id, location_id, starts_on, ends_on, status)
  values (v_org_id, v_loc_main, v_week_start - 7, v_week_start - 1, 'open')
  on conflict do nothing;

  insert into announcements (organization_id, location_id, title, body, created_by)
  values (v_org_id, v_loc_main, 'Bienvenidos a Krealo Shift',
          'Este es un anuncio de demostración. Ficha tu entrada y salida en el iPad de la tienda.',
          v_user_owner)
  on conflict do nothing;

  insert into notification_preferences (user_id, organization_id) values
    (v_user_owner, v_org_id), (v_user_manager, v_org_id)
  on conflict (user_id, organization_id) do nothing;
end
$$;

commit;
