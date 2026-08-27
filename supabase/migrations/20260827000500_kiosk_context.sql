-- Krealo Shift — contexto del kiosco tras validar un PIN (§9.2, §16)
--
-- La Edge Function `verify-pin` necesita devolver todo lo que la pantalla del
-- empleado muestra: nombre, estado, turnos elegibles y acciones permitidas. Si
-- eso se armara con cinco consultas desde la función, cada cambio de reglas
-- viviría en dos sitios y podrían desincronizarse.
--
-- Aquí se arma en una sola llamada, con las mismas reglas que ya aplica
-- `submit_time_event`. Devuelve SOLO lo necesario para operar: sin email, sin
-- teléfono, sin datos de otros empleados (§16 `refresh-kiosk-roster`).

create or replace function kiosk_employee_context(
  p_employee_id uuid,
  p_location_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emp record;
  v_settings jsonb;
  v_state text;
  v_session record;
  v_break record;
  v_shifts jsonb;
  v_allowed text[];
  v_earliest timestamptz;
  v_next_shift record;
begin
  select e.id, e.full_name, e.preferred_name, e.organization_id
  into v_emp
  from public.employees e
  where e.id = p_employee_id and e.status = 'active';

  if v_emp.id is null then
    return null;
  end if;

  select l.settings into v_settings from public.locations l where l.id = p_location_id;

  v_state := public.current_attendance_state(p_employee_id);

  -- Acciones permitidas, derivadas de la máquina de estados y no escritas a mano.
  v_allowed := array(
    select t::text
    from unnest(enum_range(null::public.time_event_type)) as t
    where public.attendance_transition_allowed(v_state, t)
  );

  -- Sesión abierta y descanso en curso, si hay.
  select s.starts_at, s.shift_id, s.paid_break_minutes, s.unpaid_break_minutes
  into v_session
  from public.work_sessions s
  where s.employee_id = p_employee_id and s.status = 'open'
  limit 1;

  if v_session.starts_at is not null then
    select bi.starts_at, bi.break_type into v_break
    from public.break_intervals bi
    join public.work_sessions s on s.id = bi.work_session_id
    where s.employee_id = p_employee_id and s.status = 'open' and bi.status = 'open'
    limit 1;
  end if;

  -- Turnos elegibles de hoy en ESTA tienda: publicados, no cancelados, y dentro
  -- de una ventana razonable alrededor de ahora. Un turno de la semana que viene
  -- no es elegible para fichar hoy.
  select coalesce(jsonb_agg(shift_row order by shift_row ->> 'startsAt'), '[]'::jsonb)
  into v_shifts
  from (
    select jsonb_build_object(
      'id', s.id,
      'startsAt', s.starts_at,
      'endsAt', s.ends_at,
      'jobRoleName', jr.name,
      'employeeNote', s.employee_note,
      'plannedUnpaidBreakMinutes', s.planned_unpaid_break_minutes,
      -- Se le muestra al empleado si su turno cambió desde la publicación
      -- anterior, que es justo lo que reclama cuando no se le avisa (§11.3).
      'changedSinceLastPublication', s.publication_version > 1
    ) as shift_row
    from public.shifts s
    left join public.job_roles jr on jr.id = s.job_role_id
    where s.employee_id = p_employee_id
      and s.location_id = p_location_id
      and s.status = 'published'
      and s.starts_at between now() - interval '12 hours' and now() + interval '12 hours'
  ) shifts;

  -- Hora más temprana a la que puede marcar entrada, para poder explicarle
  -- "podrás hacerlo a las 09:50" en lugar de un rechazo sin motivo (§9.3).
  select s.starts_at into v_next_shift
  from public.shifts s
  where s.employee_id = p_employee_id
    and s.location_id = p_location_id
    and s.status = 'published'
    and s.starts_at > now()
  order by s.starts_at
  limit 1;

  if v_next_shift.starts_at is not null then
    v_earliest := v_next_shift.starts_at
      - make_interval(mins => coalesce((v_settings ->> 'earlyClockInMinutes')::int, 10));
  end if;

  return jsonb_build_object(
    'employee', jsonb_build_object(
      -- Identificador opaco: no se expone el uuid interno del empleado al iPad.
      'opaqueId', encode(extensions.digest(p_employee_id::text, 'sha256'), 'hex'),
      'displayName', coalesce(nullif(btrim(v_emp.preferred_name), ''), v_emp.full_name),
      'initials', upper(
        substring(coalesce(nullif(btrim(v_emp.preferred_name), ''), v_emp.full_name) from 1 for 1)
        || coalesce(
             substring(split_part(v_emp.full_name, ' ', 2) from 1 for 1),
             ''
           )
      ),
      'jobRoleName', (
        select jr.name from public.employee_job_roles ejr
        join public.job_roles jr on jr.id = ejr.job_role_id
        where ejr.employee_id = p_employee_id
        order by ejr.is_primary desc
        limit 1
      ),
      -- Si esta persona puede administrar ESTA tienda. Es lo que habilita la
      -- excepcion de entrada temprana: el cliente no puede deducirlo por su
      -- cuenta, y dejarselo adivinar convertiria cualquier PIN en un PIN de
      -- gerente (§9.3, §13).
      'canManageLocation', exists (
        select 1 from public.employee_location_assignments a
        where a.employee_id = p_employee_id
          and a.location_id = p_location_id
          and a.can_manage
      )
    ),
    'attendanceState', v_state,
    'allowedActions', to_jsonb(v_allowed),
    'eligibleShifts', v_shifts,
    'openSession', case
      when v_session.starts_at is null then null
      else jsonb_build_object(
        'startedAt', v_session.starts_at,
        'shiftEndsAt', (
          select s.ends_at from public.shifts s where s.id = v_session.shift_id
        ),
        -- Minutos de descanso ya tomados en esta sesion. El kiosco los necesita
        -- para saber si al marcar salida falta el descanso obligatorio, y para
        -- no preguntar por un descanso que la persona si tomo (§12).
        'takenBreakMinutes',
          coalesce(v_session.paid_break_minutes, 0) + coalesce(v_session.unpaid_break_minutes, 0),
        'requiredBreakMinutes', coalesce((v_settings ->> 'requiredBreakMinutes')::int, 0),
        'openBreak', case
          when v_break.starts_at is null then null
          else jsonb_build_object('startedAt', v_break.starts_at,
                                  'breakType', v_break.break_type)
        end
      )
    end,
    'earliestClockInAt', v_earliest
  );
end;
$$;

revoke all on function kiosk_employee_context(uuid, uuid) from public;

-- `digest` viene de pgcrypto, que está en el esquema `extensions`.
-- Se comprueba aquí para que la migración falle temprano si falta, en lugar de
-- fallar en producción la primera vez que alguien ficha.
do $$
begin
  perform extensions.digest('prueba', 'sha256');
end
$$;
