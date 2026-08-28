-- Krealo Shift — SQL redondeaba y TypeScript truncaba los segundos sueltos (§13)
--
-- EL FALLO
-- El cálculo de duración existe DOS VECES y las dos versiones trataban los segundos
-- sueltos de forma distinta:
--
--   SQL          (extract(epoch from (salida - entrada)) / 60)::int
--                el cast a int en Postgres REDONDEA:  480.67 -> 481
--   TypeScript   differenceInMinutes de date-fns
--                TRUNCA:                              8 h 40 s -> 480
--
-- Comprobado ejecutando las dos, no leyéndolas.
--
-- CONSECUENCIA: para el mismo fichaje, el kiosco y su contador en vivo mostraban 480
-- minutos y la hoja de tiempo —y el CSV que va a nómina— decían 481. Hasta un minuto
-- por sesión, sistemáticamente, en el número por el que se paga.
--
-- Para un reloj de fichaje eso no es un detalle. Si el empleado vio 8:00 en la
-- pantalla y en su boleta aparece 8:01, la primera reacción es que el sistema miente,
-- y tiene razón en desconfiar: dos números distintos para el mismo hecho.
--
-- LA §13 NO DECIDE. Da la fórmula —`trabajado = salida - entrada - descansos no
-- pagados`— y no dice nada de los segundos sueltos. Así que es una decisión, y lo
-- único que no era una opción es tener dos.
--
-- SE ELIGE TRUNCAR, en las dos, por tres razones:
--   1. Truncar nunca reporta MÁS tiempo del trabajado. Para un sistema que dice
--      explícitamente que no calcula remuneración, inflar es la dirección equivocada
--      del error: sería la app la razón de que una nómina salga alta.
--   2. Es lo que hace una persona con un reloj en la mano: "entré 9:00, salí 17:00,
--      ocho horas".
--   3. No cambia el lado de TypeScript, que es el que se ve en vivo en el kiosco.
--
-- `trunc(...)` explícito y no `floor(...)`: las duraciones aquí no pueden ser
-- negativas —van dentro de `greatest(0, ...)`— así que los dos harían lo mismo, y
-- `trunc` dice "quita la parte decimal", que es la intención.
--
-- OJO CON DE DÓNDE SALE EL CUERPO. El de `rebuild_work_session` vive hoy en
-- `rebuild_work_session_unchecked`, por el `rename` de `20260827001500`, y se recrea
-- con ESE nombre: recrearlo con el original machacaría el envoltorio que comprueba el
-- rol y devolvería el agujero que esa migración cerró.

create or replace function apply_event_to_projection(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev record;
  v_session record;
  v_break record;
  v_minutes integer;
begin
  select * into v_ev from public.time_events where id = p_event_id;
  if v_ev is null then return; end if;

  select * into v_session
  from public.work_sessions
  where employee_id = v_ev.employee_id and status = 'open'
  limit 1;

  if v_ev.event_type = 'clock_in' then
    insert into public.work_sessions (
      organization_id, employee_id, location_id, shift_id,
      clock_in_event_id, starts_at, status
    ) values (
      v_ev.organization_id, v_ev.employee_id, v_ev.location_id, v_ev.shift_id,
      v_ev.id, v_ev.occurred_at, 'open'
    );
    return;
  end if;

  if v_session is null then
    -- Un descanso o una salida sin sesión abierta es una anomalía real, no algo
    -- que se pueda arreglar inventando una entrada. Se deja constancia.
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, after_data)
    values (v_ev.organization_id, 'event_without_open_session', 'time_event', v_ev.id,
            jsonb_build_object('eventType', v_ev.event_type));
    return;
  end if;

  if v_ev.event_type = 'break_start' then
    insert into public.break_intervals
      (work_session_id, start_event_id, break_type, starts_at, status)
    values (v_session.id, v_ev.id, coalesce(v_ev.break_type, 'unpaid'), v_ev.occurred_at, 'open');

  elsif v_ev.event_type = 'break_end' then
    select * into v_break
    from public.break_intervals
    where work_session_id = v_session.id and status = 'open'
    limit 1;

    if v_break.id is null then return; end if;

    v_minutes := greatest(0, trunc(extract(epoch from (v_ev.occurred_at - v_break.starts_at)) / 60)::int);

    update public.break_intervals
      set end_event_id = v_ev.id, ends_at = v_ev.occurred_at,
          duration_minutes = v_minutes, status = 'complete'
      where id = v_break.id;

    if v_break.break_type = 'paid' then
      update public.work_sessions
        set paid_break_minutes = paid_break_minutes + v_minutes
        where id = v_session.id;
    else
      update public.work_sessions
        set unpaid_break_minutes = unpaid_break_minutes + v_minutes
        where id = v_session.id;
    end if;

  elsif v_ev.event_type = 'clock_out' then
    -- Si quedó un descanso abierto se cierra con la hora de la salida y se marca
    -- para revisión: no se descarta ni se inventa una duración (§12).
    select * into v_break
    from public.break_intervals
    where work_session_id = v_session.id and status = 'open'
    limit 1;

    -- `v_break is not null` NO sirve aqui: en plpgsql un record es "no nulo" solo
    -- si TODOS sus campos lo son, y un descanso abierto tiene ends_at nulo. Se
    -- comprueba la clave primaria, que si distingue "encontrado" de "no habia".
    if v_break.id is not null then
      v_minutes := greatest(0, trunc(extract(epoch from (v_ev.occurred_at - v_break.starts_at)) / 60)::int);
      update public.break_intervals
        set end_event_id = v_ev.id, ends_at = v_ev.occurred_at,
            duration_minutes = v_minutes, status = 'needs_review'
        where id = v_break.id;
      if v_break.break_type = 'paid' then
        update public.work_sessions set paid_break_minutes = paid_break_minutes + v_minutes
          where id = v_session.id;
      else
        update public.work_sessions set unpaid_break_minutes = unpaid_break_minutes + v_minutes
          where id = v_session.id;
      end if;
    end if;

    update public.work_sessions s
      set clock_out_event_id = v_ev.id,
          ends_at = v_ev.occurred_at,
          gross_minutes = greatest(0, trunc(extract(epoch from (v_ev.occurred_at - s.starts_at)) / 60)::int),
          net_minutes = greatest(
            0,
            trunc(extract(epoch from (v_ev.occurred_at - s.starts_at)) / 60)::int
              - s.unpaid_break_minutes
          ),
          status = (case when v_break.id is not null then 'needs_review' else 'complete' end)::public.work_session_status,
          flags = case when v_break.id is not null
                       then array_append(s.flags, 'break_closed_on_clock_out')
                       else s.flags end,
          recomputed_at = now()
      where s.id = v_session.id;
  end if;
end;
$$;

create or replace function rebuild_work_session_unchecked(p_work_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_paid integer := 0;
  v_unpaid integer := 0;
  v_gross integer;
begin
  select * into v_session from public.work_sessions where id = p_work_session_id;
  if v_session is null then return; end if;

  select
    coalesce(sum(case when break_type = 'paid' then duration_minutes else 0 end), 0),
    coalesce(sum(case when break_type <> 'paid' then duration_minutes else 0 end), 0)
  into v_paid, v_unpaid
  from public.break_intervals
  where work_session_id = p_work_session_id and duration_minutes is not null;

  v_gross := case
    when v_session.ends_at is null then null
    else greatest(0, trunc(extract(epoch from (v_session.ends_at - v_session.starts_at)) / 60)::int)
  end;

  update public.work_sessions
    set paid_break_minutes = v_paid,
        unpaid_break_minutes = v_unpaid,
        gross_minutes = v_gross,
        net_minutes = case when v_gross is null then null else greatest(0, v_gross - v_unpaid) end,
        recomputed_at = now()
    where id = p_work_session_id;
end;
$$;

-- Los permisos se vuelven a fijar y no se dan por heredados. `_unchecked` no la puede
-- ejecutar nadie con sesión: es la que salta la comprobación de rol.
revoke all on function rebuild_work_session_unchecked(uuid) from public, anon, authenticated;
grant execute on function rebuild_work_session_unchecked(uuid) to service_role;

revoke all on function apply_event_to_projection(uuid) from public, anon, authenticated;
grant execute on function apply_event_to_projection(uuid) to service_role;
