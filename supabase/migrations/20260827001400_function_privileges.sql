-- Krealo Shift — permisos de ejecución de las funciones (§15, §22)
--
-- EL AGUJERO, Y POR QUÉ NO SE VIO ANTES
-- Todas las migraciones anteriores protegen sus funciones con
-- `revoke all on function ... from public`. Eso NO alcanza en Supabase, y la
-- diferencia es sutil:
--
--   * En PostgreSQL a secas, una función nueva nace con `execute` concedido al
--     pseudo-rol `PUBLIC`. Revocar de `PUBLIC` la cierra. Eso es lo que pasaba en
--     el Postgres local de pruebas, y por eso las pruebas daban verde.
--   * Supabase, además, deja configurado
--     `alter default privileges in schema public grant all on functions to
--      postgres, anon, authenticated, service_role`. Con eso cada función nueva
--     nace con `execute` concedido EXPLÍCITAMENTE a esos cuatro roles, y revocar
--     de `PUBLIC` no toca esas concesiones: son otra cosa.
--
-- Consecuencia real, comprobada añadiendo esos privilegios por defecto al shim de
-- pruebas: 34 funciones quedaban invocables por RPC desde `anon`, o sea **sin
-- ninguna sesión**. Entre ellas:
--
--   * `set_employee_pin` — cualquiera podía fijar el PIN de cualquier empleado y
--     después fichar en su nombre. Es la peor de todas.
--   * `kiosk_offline_verifiers` — entregaba los salt y verificadores de PIN de
--     cualquier dispositivo con solo conocer su uuid.
--   * `submit_time_event` y `submit_offline_time_event` — fichajes forjados.
--   * `verify_employee_pin` — fuerza bruta de PIN sin la credencial del kiosco.
--   * `authenticate_kiosk`, `activate_kiosk_device`, `apply_event_to_projection`.
--
-- EL ARREGLO: NEGAR POR DEFECTO Y CONCEDER POR LISTA
-- Se revoca `execute` de `anon` y `authenticated` en TODAS las funciones de
-- `public`, y después se concede solo a las que la app tiene que poder llamar. Es
-- al revés de como estaba —cerrar lo conocido— y esa inversión es el punto: una
-- función nueva que nadie recuerde revocar queda cerrada, no abierta.
--
-- LO QUE DE VERDAD LO SOSTIENE es la prueba de `supabase/tests/40_privilegios.sql`,
-- que enumera las funciones y falla si alguna fuera de la lista blanca es
-- ejecutable. Los privilegios por defecto de abajo ayudan pero no bastan: solo
-- aplican a objetos creados por el rol que los configura, y no se puede dar por
-- hecho qué rol corre cada migración en la nube.

-- ---------------------------------------------------------------------------
-- 1. Cambiar el defecto para las funciones futuras
-- ---------------------------------------------------------------------------

alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cerrar todas las existentes
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    -- `public` va en la lista y no es redundante: TODO rol hereda lo concedido a
    -- `PUBLIC`, asi que revocar solo de `anon` y `authenticated` deja la funcion
    -- abierta si `PUBLIC` conserva su `execute` por defecto. Es justo lo que
    -- pasaba con las funciones de disparador, que ninguna migracion habia
    -- revocado, y lo detecto la prueba de 40_privilegios.sql.
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.sig);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Conceder lo que la app necesita, y solo eso
-- ---------------------------------------------------------------------------

-- Se concede POR NOMBRE y no por firma completa, dentro de un bloque que EXIGE que
-- cada nombre exista. Dos razones, y la segunda importa mas:
--
--   * cambiar un parametro de una funcion no deja este archivo desactualizado en
--     silencio (paso al escribirlo: tres firmas no coincidian);
--   * si alguien renombra o borra una funcion de la lista, la migracion FALLA en
--     vez de seguir adelante dejandola sin permisos. En una lista blanca de
--     seguridad, fallar ruidosamente es la unica opcion aceptable.
do $$
declare
  v_nombre text;
  v_sig text;
  v_n integer;
  -- Ayudantes de RLS. Van a `authenticated` porque las POLITICAS los llaman: una
  -- politica que invoca una funcion se evalua con los permisos de quien consulta,
  -- asi que sin esto ninguna lectura de la app funcionaria. No van a `anon`: no hay
  -- ninguna politica `to anon` en el proyecto.
  --
  -- Funciones puras de apoyo que la app usa para pintar; no leen nada sensible.
  --
  -- Y los RPC del panel: cada uno comprueba el rol POR DENTRO. Conceder `execute`
  -- no es conceder permiso, solo la posibilidad de preguntar. Sin esa comprobacion
  -- interna, estos `grant` serian el agujero.
  v_permitidas text[] := array[
    'app_is_member', 'app_role_in', 'app_manages_location', 'app_is_self_employee',
    'app_employee_id', 'app_administers_organization', 'app_user_manages_location',
    'attendance_transition_allowed', 'week_start_for',
    'create_kiosk_activation_code', 'revoke_kiosk_device', 'set_employee_pin',
    'manager_adjust_time', 'manager_add_time_event', 'approve_timesheet_period',
    'export_timesheet_rows', 'rebuild_work_session', 'current_attendance_state',
    'attendance_state_at', 'deactivate_push_token'
  ];
begin
  foreach v_nombre in array v_permitidas loop
    v_n := 0;
    for v_sig in
      select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.proname = v_nombre
    loop
      execute format('grant execute on function %s to authenticated', v_sig);
      v_n := v_n + 1;
    end loop;

    if v_n = 0 then
      raise exception
        'La lista blanca de permisos nombra %, que no existe. Si se renombro o se '
        'borro, hay que actualizar 20260827001400_function_privileges.sql.', v_nombre
        using errcode = 'undefined_function';
    end if;
  end loop;
end
$$;

-- 3.d NADA para el camino del kiosco ni para los trabajos programados. Esas las
-- llaman las Edge Functions con la `service_role`, que no evalúa privilegios de
-- tabla ni de función. Dejarlas sin `grant` es lo que cierra el agujero:
--   authenticate_kiosk, verify_employee_pin, submit_time_event,
--   submit_offline_time_event, activate_kiosk_device, kiosk_offline_verifiers,
--   kiosk_employee_context, apply_event_to_projection, attendance_photo_path,
--   purge_expired_attendance_photos, pending_manager_alerts,
--   claim_manager_alerts, mark_manager_alerts_sent, mark_manager_alerts_failed,
--   purge_manager_alert_deliveries, record_kiosk_rejection.
--
-- Las funciones de disparador (`reject_mutation`, `set_updated_at`,
-- `guard_*`, `stamp_shift_publication`) tampoco reciben nada: un disparador se
-- ejecuta con los permisos del dueño de la tabla, no de quien escribe, así que no
-- hace falta ningún `grant` para que funcionen.
