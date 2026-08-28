-- Krealo Shift — el empleado se entera del resultado de su solicitud (§19)
--
-- EL HUECO
-- La §19 dice literal: "Después de validar su PIN, el kiosco muestra el turno
-- vigente, cualquier cambio publicado y EL RESULTADO DE SOLICITUDES RELEVANTES."
--
-- Las dos primeras estaban: `kiosk_employee_context` ya devolvía los turnos
-- elegibles, la nota del turno y `changedSinceLastPublication`. La tercera no
-- existía en ninguna parte.
--
-- POR QUÉ NO ES UN ADORNO
-- El kiosco YA CREA solicitudes. Cuando alguien dice "me olvidé de marcar la salida"
-- o "tomé el descanso pero no lo registré", `create_time_edit_request` genera una
-- solicitud pendiente y auditable —no toca la hoja de tiempo, eso es el punto—, el
-- encargado la aprueba o la rechaza en el panel, y el empleado NO SE ENTERABA NUNCA.
-- El circuito quedaba abierto justo en el paso que le importa a quien reportó el
-- problema. Eso es lo que hace que la gente deje de reportar: pides que te arreglen
-- una hora, nadie te dice nada, y la siguiente vez ya no lo pides.
--
-- QUÉ SE DEVUELVE, Y QUÉ NO
-- Resultado, tipo, fecha afectada, el motivo que dio ella misma, el comentario de la
-- revisión y cuándo se resolvió. NO se devuelve quién revisó: el kiosco es un
-- dispositivo compartido y §16 exige devolver solo lo necesario para operar.
--
-- El motivo propio se incluye porque sin él "Aprobada" a secas no dice de qué: una
-- persona puede tener tres solicitudes en una semana.
--
-- Se recrea la función entera porque Postgres no permite cambiar un trozo del
-- cuerpo. El texto se extrajo de `20260827000500` y solo se añadieron la variable,
-- el cálculo y la clave del resultado.

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
  v_request_updates jsonb;
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

  -- RESULTADO DE SUS SOLICITUDES (§19 "el resultado de solicitudes relevantes").
  --
  -- El kiosco YA CREA solicitudes: cuando alguien dice "me olvide de marcar la
  -- salida" o "tomé el descanso pero no lo registré", eso genera una solicitud
  -- pendiente y auditable, el encargado la resuelve en el panel, y hasta ahora el
  -- empleado NO SE ENTERABA NUNCA. El circuito quedaba abierto justo en el paso que
  -- le importa a quien reportó el problema, que es lo que hace que la gente deje de
  -- reportar.
  --
  -- SIN NOMBRES DE TERCEROS: se devuelve el resultado y el comentario, no quién
  -- revisó. El kiosco es un dispositivo compartido y §16 exige devolver solo lo
  -- necesario para operar.
  --
  -- VENTANA DE TIEMPO Y NO UNA MARCA DE "VISTO", y el costo queda escrito: marcar
  -- visto necesitaría un endpoint de escritura nuevo desde el kiosco, con su RLS,
  -- para un aviso que se resuelve solo. Con la ventana, quien no pise la tienda en
  -- ese plazo se pierde el aviso; la solicitud sigue en su historial y el ajuste
  -- sigue aplicado en su hoja de tiempo, así que no se pierde el efecto, solo el
  -- aviso. 14 días porque es del orden de un periodo de nómina (§11.5): quien
  -- trabaje algo dentro del periodo lo ve.
  select coalesce(jsonb_agg(fila order by fila ->> 'reviewedAt' desc), '[]'::jsonb)
  into v_request_updates
  from (
    select jsonb_build_object(
      'id', q.id,
      'kind', q.kind,
      'status', q.status,
      'targetDate', q.target_date,
      -- El motivo que dio ella misma: sin eso, "Aprobada" a secas no dice de qué.
      'reason', q.reason,
      'reviewerComment', nullif(btrim(coalesce(q.reviewer_comment, '')), ''),
      'reviewedAt', q.reviewed_at
    ) as fila
    from public.time_edit_requests q
    where q.employee_id = p_employee_id
      and q.location_id = p_location_id
      and q.status in ('approved', 'rejected')
      and q.reviewed_at is not null
      and q.reviewed_at > now() - interval '14 days'
  ) resueltas;

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
    'earliestClockInAt', v_earliest,
    'requestUpdates', v_request_updates
  );
end;
$$;


comment on function kiosk_employee_context is
  'Contexto del empleado tras validar el PIN (§9.2, §16, §19). Devuelve SOLO lo '
  'necesario para operar: sin correo, sin telefono, sin datos de otros empleados, y '
  'sin el nombre de quien revisa una solicitud. Incluye requestUpdates: el resultado '
  'de las solicitudes de esa persona resueltas en los ultimos 14 dias.';

-- `create or replace` conserva los permisos, pero se vuelven a fijar para que no
-- dependan de lo que hubiera antes. Solo la `service_role` la llama: el iPad no
-- tiene sesion de Supabase, va por la Edge Function `verify-pin`.
revoke all on function kiosk_employee_context(uuid, uuid) from public, anon, authenticated;
grant execute on function kiosk_employee_context(uuid, uuid) to service_role;
