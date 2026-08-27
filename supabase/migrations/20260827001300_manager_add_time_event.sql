-- Krealo Shift — fichaje manual del gerente (§11.4)
--
-- QUÉ FALTABA
-- §11.4 pide "agregar fichaje manual con motivo" y no existía forma de hacerlo. El
-- panel lo suplía creando una SOLICITUD de corrección, que es auditable y honesta
-- pero no es lo mismo: una solicitud la tiene que aprobar alguien, y aquí quien
-- actúa YA es el gerente. El caso real es cotidiano: a alguien se le olvidó marcar
-- la salida, se fue a casa, y el gerente tiene que dejar la jornada cuadrada hoy.
--
-- LO QUE ESTA FUNCIÓN NO ROMPE
-- `time_events` sigue siendo append-only. Esto no edita ningún evento: CREA uno
-- nuevo, marcado `source = 'manager'`, así que en el detalle diario se distingue a
-- simple vista de lo que marcó la persona en el iPad. La regla de la
-- especificación —"nunca sobrescribir silenciosamente un evento original"— se
-- respeta porque no se sobrescribe nada.
--
-- EL MOTIVO ES OBLIGATORIO Y NO ES UN CAMPO DECORATIVO. Un fichaje que el gerente
-- se inventa sin explicación es indistinguible de un fraude en una auditoría
-- laboral. Se guarda en `time_adjustments` con el valor anterior (que aquí es
-- "no había evento"), el nuevo, el autor, la fecha del servidor y el canal, que es
-- lo que §11.4 exige conservar de toda corrección.
--
-- POR QUÉ VALIDA LA TRANSICIÓN Y NO ACEPTA CUALQUIER COSA
-- Podría insertar el evento a ciegas y dejar que la proyección se arregle sola,
-- pero entonces un gerente podría crear dos entradas seguidas sin salida y las
-- horas de esa persona quedarían mal sin que nadie lo note hasta el pago. Se
-- comprueba la transición contra el estado del empleado EN ESE INSTANTE —no en el
-- actual— porque un fichaje manual casi siempre se agrega en el pasado.

-- ---------------------------------------------------------------------------
-- Estado del empleado EN UN INSTANTE DADO
-- ---------------------------------------------------------------------------

/**
 * Igual que `current_attendance_state`, pero "a fecha de".
 *
 * Existe porque un fichaje manual casi siempre se agrega en el pasado —a alguien
 * se le olvidó marcar la salida ayer— y validar la transición contra el estado de
 * AHORA rechazaría correcciones perfectamente válidas: si la persona ya volvió a
 * fichar hoy, su estado actual no dice nada de lo que pasaba ayer a las 18:00.
 *
 * El desempate por `seq` es el mismo que en la versión de ahora, y por el mismo
 * motivo: sin él el estado es indeterminado cuando dos eventos comparten instante.
 */
create or replace function attendance_state_at(
  p_employee_id uuid,
  p_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last public.time_event_type;
begin
  select event_type into v_last
  from public.time_events
  where employee_id = p_employee_id
    and occurred_at <= p_at
  order by occurred_at desc, received_at desc, seq desc
  limit 1;

  if v_last is null then return 'OFF_SHIFT'; end if;

  return case v_last
    when 'clock_in'    then 'WORKING'
    when 'break_end'   then 'WORKING'
    when 'break_start' then 'ON_BREAK'
    when 'clock_out'   then 'OFF_SHIFT'
  end;
end;
$$;

revoke all on function attendance_state_at(uuid, timestamptz) from public;
grant execute on function attendance_state_at(uuid, timestamptz) to authenticated;

create or replace function manager_add_time_event(
  p_employee_id uuid,
  p_location_id uuid,
  p_event_type public.time_event_type,
  p_occurred_at timestamptz,
  p_reason text,
  p_break_type public.break_type default null,
  p_shift_id uuid default null,
  p_idempotency_key uuid default null
)
returns table (event_id uuid, work_session_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_employee record;
  v_state text;
  v_event_id uuid;
  v_session_id uuid;
  v_key uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'El fichaje manual necesita un motivo.' using errcode = 'check_violation';
  end if;

  if p_occurred_at is null then
    raise exception 'Falta la hora del fichaje.' using errcode = 'check_violation';
  end if;

  -- Un fichaje en el futuro no es una corrección, es una invención. Se rechaza:
  -- las horas trabajadas se registran cuando ocurren.
  if p_occurred_at > now() + interval '1 minute' then
    raise exception 'No se puede registrar un fichaje en el futuro.'
      using errcode = 'check_violation';
  end if;

  if not public.app_manages_location(p_location_id) then
    raise exception 'No administras esta ubicación.' using errcode = 'insufficient_privilege';
  end if;

  select e.id, e.organization_id, e.status into v_employee
  from public.employees e where e.id = p_employee_id;

  if v_employee.id is null then
    raise exception 'Empleado inexistente.' using errcode = 'no_data_found';
  end if;

  -- La ubicación y el empleado tienen que ser de la MISMA organización. Sin esto,
  -- quien administre una tienda podría crear fichajes para personal de otra
  -- empresa pasando el par de identificadores a mano.
  select l.organization_id into v_org
  from public.locations l where l.id = p_location_id;

  if v_org is null or v_org <> v_employee.organization_id then
    raise exception 'Ese empleado no pertenece a esta ubicación.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.employee_location_assignments a
    where a.employee_id = p_employee_id and a.location_id = p_location_id
  ) then
    raise exception 'Ese empleado no está asignado a esta ubicación.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Sin clave del cliente se genera una: la idempotencia protege del doble envío
  -- del formulario igual que en el kiosco.
  v_key := coalesce(p_idempotency_key, extensions.gen_random_uuid());

  -- LA IDEMPOTENCIA SE COMPRUEBA ANTES DE LA TRANSICIÓN, y el orden no es un
  -- detalle: al revés, el reenvío del formulario se rechaza a sí mismo. El primer
  -- envío crea el fichaje, y en el segundo la validación ve el estado que acaba de
  -- dejar ese mismo evento —una entrada ya registrada— y responde "la persona ya
  -- estaba trabajando". El usuario vería un error donde en realidad su acción sí
  -- funcionó. `submit_time_event` resuelve esto igual, por el mismo motivo.
  select id into v_event_id from public.time_events
  where organization_id = v_employee.organization_id and idempotency_key = v_key;

  if v_event_id is not null then
    return query
    select v_event_id,
           (select ws.id from public.work_sessions ws
            where ws.clock_in_event_id = v_event_id
               or ws.clock_out_event_id = v_event_id
            limit 1);
    return;
  end if;

  -- Estado EN EL INSTANTE del fichaje que se agrega, no el de ahora: un fichaje
  -- manual se pone casi siempre en el pasado, y validar contra el estado actual
  -- rechazaría correcciones perfectamente válidas.
  select public.attendance_state_at(p_employee_id, p_occurred_at) into v_state;

  if not public.attendance_transition_allowed(v_state, p_event_type) then
    raise exception
      'Ese fichaje no encaja: a esa hora la persona estaba en estado %.', v_state
      using errcode = 'check_violation';
  end if;

  insert into public.time_events
    (organization_id, employee_id, location_id, shift_id, event_type, break_type,
     source, occurred_at, idempotency_key, created_by, metadata)
  values
    (v_employee.organization_id, p_employee_id, p_location_id, p_shift_id,
     p_event_type, p_break_type, 'manager', p_occurred_at, v_key, auth.uid(),
     jsonb_build_object('reason', p_reason, 'manualEntry', true))
  -- `on conflict` sigue aquí aunque ya se comprobó arriba: dos envíos
  -- simultáneos con la misma clave pueden pasar los dos por la comprobación antes
  -- de que ninguno inserte. La restricción única es la que de verdad lo impide.
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    -- Carrera perdida: el otro envío lo insertó entre la comprobación y este
    -- insert. Se devuelve el evento que gano, no un error.
    select id into v_event_id from public.time_events
    where organization_id = v_employee.organization_id and idempotency_key = v_key;

    return query
    select v_event_id,
           (select ws.id from public.work_sessions ws
            where ws.clock_in_event_id = v_event_id
               or ws.clock_out_event_id = v_event_id
            limit 1);
    return;
  end if;

  perform public.apply_event_to_projection(v_event_id);

  select ws.id into v_session_id from public.work_sessions ws
  where ws.clock_in_event_id = v_event_id or ws.clock_out_event_id = v_event_id
  limit 1;

  if v_session_id is null then
    -- Un descanso no abre ni cierra sesión: se busca la que lo contiene.
    select ws.id into v_session_id from public.work_sessions ws
    where ws.employee_id = p_employee_id
      and ws.starts_at <= p_occurred_at
      and (ws.ends_at is null or ws.ends_at >= p_occurred_at)
    order by ws.starts_at desc
    limit 1;
  end if;

  -- Rastro auditable. `before_value` dice que no había nada: es la diferencia
  -- entre "se corrigió una hora" y "se agregó un fichaje que no existía", y en una
  -- auditoría laboral esa distinción importa.
  insert into public.time_adjustments
    (organization_id, work_session_id, target_type, target_id,
     before_value, after_value, reason, created_by)
  values
    (v_employee.organization_id, v_session_id, 'time_event', v_event_id,
     jsonb_build_object('existed', false),
     jsonb_build_object(
       'eventType', p_event_type,
       'occurredAt', p_occurred_at,
       'breakType', p_break_type,
       'source', 'manager'),
     p_reason, auth.uid());

  insert into public.audit_logs
    (organization_id, actor_user_id, action, entity_type, entity_id, after_data)
  values
    (v_employee.organization_id, auth.uid(), 'time_event_added_manually', 'time_event',
     v_event_id,
     jsonb_build_object(
       'employeeId', p_employee_id,
       'locationId', p_location_id,
       'eventType', p_event_type,
       'occurredAt', p_occurred_at,
       'reason', p_reason));

  return query select v_event_id, v_session_id;
end;
$$;

revoke all on function manager_add_time_event(
  uuid, uuid, public.time_event_type, timestamptz, text, public.break_type, uuid, uuid
) from public;

grant execute on function manager_add_time_event(
  uuid, uuid, public.time_event_type, timestamptz, text, public.break_type, uuid, uuid
) to authenticated;
