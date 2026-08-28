-- Krealo Shift — CORRIGE 20260827001700: §11.6 sí pide esas dos preferencias
--
-- QUÉ HIZO MAL LA MIGRACIÓN ANTERIOR
-- Quitó los interruptores `earlyClockIn` ("entrada temprana") y `scheduleChange`
-- ("cambio de horario") argumentando que no correspondían a ninguna alerta de la
-- especificación. El argumento venía de leer la §19, que lista siete notificaciones
-- y no incluye esas dos.
--
-- LA §11.6 SÍ LAS LISTA. Es la sección que describe la pantalla de Configuración, y
-- su apartado de Notificaciones dice literal: "empleado tarde; no se presentó;
-- ENTRADA TEMPRANA; cerca de horas extra; fichaje incompleto; solicitud nueva;
-- CAMBIO DE HORARIO".
--
-- O sea que se borraron dos preferencias que el proyecto pide. Y el diagnóstico de
-- fondo también estaba mal: el conjunto de ocho claves del esquema inicial no era
-- inventado, salía de §11.6.
--
-- LO QUE PASA DE VERDAD: la especificación se contradice consigo misma. §11.6 lista
-- siete preferencias, §19 lista siete notificaciones, y solo cinco coinciden:
--
--   en las dos     tarde, no se presentó, fichaje incompleto, cerca de horas extra,
--                  solicitud nueva
--   solo en §11.6  entrada temprana, cambio de horario
--   solo en §19    kiosco revocado o incorrecto, kiosco sin sincronizar
--
-- La unión son NUEVE alertas, y es lo que se implementa: quitar de una lista lo que
-- solo aparece en la otra deja al encargado sin un aviso que el proyecto pide, y la
-- migración anterior hizo exactamente eso en una dirección.
--
-- OCHO INTERRUPTORES, uno por alerta, más `wrongKiosk` que sigue sin interruptor:
-- §11.6 no lo lista, y con interruptor quien se llevó el iPad podría silenciar el
-- aviso de que se lo llevó. La pantalla de Configuración lo dice.
--
-- LO QUE NO DETECTÓ EL ERROR, y conviene dejarlo escrito: las pruebas de
-- correspondencia de la migración anterior comparaban las preferencias de la app con
-- los tipos de alerta de la base. Las dos estaban de acuerdo en estar mal, así que
-- pasaban en verde. Una prueba de coherencia entre dos copias no dice nada sobre si
-- la copia es correcta.

-- ---------------------------------------------------------------------------
-- Las ocho preferencias que pide §11.6 más la de §19
-- ---------------------------------------------------------------------------

create or replace function default_notification_preferences()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  -- `earlyClockIn` APAGADA, y es la única: no es una incidencia sino un patrón que
  -- suma en la nómina, y la máquina de estados ya impide fichar antes de la
  -- tolerancia, así que toda entrada temprana está dentro de lo permitido. Es el
  -- mismo valor que traía el esquema inicial.
  select jsonb_build_object(
    'late', true,
    'noShow', true,
    'earlyClockIn', false,
    'nearOvertime', true,
    'incompleteEntry', true,
    'newRequest', true,
    'scheduleChange', true,
    'kioskNotSyncing', true
  );
$$;

comment on function default_notification_preferences is
  'Preferencias de notificacion por defecto (§11.6 y §19). UNICA definicion: la usan '
  'el default de notification_preferences.preferences y el respaldo de '
  'pending_manager_alerts. Ocho claves, una por alerta con interruptor; wrongKiosk no '
  'tiene interruptor a proposito porque §11.6 no lo lista y silenciarlo seria '
  'silenciar el aviso de un iPad robado.';

revoke all on function default_notification_preferences() from public;
grant execute on function default_notification_preferences() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Los dos tipos de alerta que faltaban en la restricción
-- ---------------------------------------------------------------------------
--
-- Sin esto, `claim_manager_alerts` fallaría al insertar la entrega: la restricción
-- `check` de la tabla es lo que fija qué tipos existen, y las pruebas la leen de ahí
-- en vez de de una lista copiada.

alter table manager_alert_deliveries
  drop constraint if exists manager_alert_deliveries_alert_type_check;

alter table manager_alert_deliveries
  add constraint manager_alert_deliveries_alert_type_check
  check (alert_type in (
    'late', 'noShow', 'earlyClockIn', 'nearOvertime', 'incompleteEntry',
    'newRequest', 'scheduleChange', 'kioskNotSyncing', 'wrongKiosk'
  ));

-- Las filas que quedaron con las dos claves quitadas se completan. Se usa
-- `defaults || preferences` y no al revés: lo que el usuario eligió gana, y solo se
-- rellena lo que falta.
update notification_preferences
set preferences = default_notification_preferences() || preferences,
    updated_at = now()
where not (preferences ?& array['late', 'noShow', 'earlyClockIn', 'nearOvertime',
                                'incompleteEntry', 'newRequest', 'scheduleChange',
                                'kioskNotSyncing']);

-- ---------------------------------------------------------------------------
-- `pending_manager_alerts` con las nueve fuentes
-- ---------------------------------------------------------------------------
--
-- Se recrea íntegra —Postgres no deja cambiar un trozo del cuerpo— partiendo del
-- texto de `20260827001700` y añadiendo solo los dos bloques nuevos.

create or replace function pending_manager_alerts(p_organization_id uuid default null)
returns table (
  alert_type text,
  recipient_user_id uuid,
  recipient_locale text,
  organization_id uuid,
  location_id uuid,
  subject_id uuid,
  occurrence_key text,
  payload jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with recipients as (
    select
      m.user_id,
      l.organization_id,
      l.id                as location_id,
      l.timezone,
      l.settings,
      o.week_starts_on,
      coalesce(nullif(pr.locale, ''), o.default_locale, 'es-PE') as locale,
      -- Una fila ausente en `notification_preferences` significa "los valores por
      -- defecto", no "no quiere nada": la primera migración los define y el panel
      -- solo escribe cuando el usuario toca algo.
      coalesce(np.preferences, public.default_notification_preferences()) as preferences,
      jsonb_build_object('locationName', l.name) as payload
    from public.locations l
    join public.organizations o on o.id = l.organization_id
    join public.organization_memberships m
      on m.organization_id = l.organization_id
     and m.status = 'active'
    left join public.profiles pr on pr.id = m.user_id
    left join public.notification_preferences np
      on np.user_id = m.user_id and np.organization_id = l.organization_id
    where l.is_active
      and (p_organization_id is null or l.organization_id = p_organization_id)
      -- LA BARRERA DE ROL. La misma regla que usa RLS, con la persona como
      -- parámetro porque aquí no hay sesión.
      and public.app_user_manages_location(m.user_id, l.id)
      -- Sin ningún dispositivo activo no hay a dónde enviar. Importa que sea un
      -- filtro y no un descarte posterior: si se encolara igual, la fila de
      -- deduplicación quedaría escrita y la alerta se perdería para siempre en
      -- cuanto la persona registrara su primer dispositivo.
      and exists (
        select 1 from public.push_tokens t
        where t.user_id = m.user_id and t.is_active
      )
  ),

  -- Minutos trabajados por persona y día local, contando la sesión abierta hasta
  -- ahora. `net_minutes` es nulo mientras la sesión está abierta, así que el
  -- tiempo en curso se estima restando los descansos ya cerrados.
  worked as (
    select
      ws.employee_id,
      ws.location_id,
      (ws.starts_at at time zone l.timezone)::date as work_date,
      sum(
        coalesce(
          ws.net_minutes,
          greatest(
            0,
            (extract(epoch from (now() - ws.starts_at)) / 60)::int
              - ws.paid_break_minutes - ws.unpaid_break_minutes
          )
        )
      )::int as minutes
    from public.work_sessions ws
    join public.locations l on l.id = ws.location_id
    where ws.starts_at > now() - interval '14 days'
    group by ws.employee_id, ws.location_id, (ws.starts_at at time zone l.timezone)::date
  )

  -- Tardanza: el turno ya empezó pasada la tolerancia, todavía no ha terminado, y
  -- no hay ninguna sesión de trabajo que le corresponda.
  select
    'late'::text,
    r.user_id,
    r.locale,
    r.organization_id,
    r.location_id,
    s.id,
    'once'::text,
    r.payload
  from recipients r
  join public.shifts s
    on s.location_id = r.location_id
   and s.status = 'published'
  where (r.preferences ->> 'late')::boolean
    and now() > s.starts_at
                + make_interval(mins => coalesce((r.settings ->> 'lateGraceMinutes')::int, 5))
    and now() < s.ends_at
    and not exists (
      select 1 from public.work_sessions ws
      where ws.employee_id = s.employee_id
        and ws.starts_at >= s.starts_at
                           - make_interval(mins => coalesce((r.settings ->> 'earlyClockInMinutes')::int, 10))
        and ws.starts_at <= s.ends_at
    )

  union all

  -- Sin presentarse: el turno terminó y no hubo ni un fichaje. Se mira solo el
  -- último día; más atrás no es una alerta, es un informe.
  select
    'noShow'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    s.id, 'once'::text, r.payload
  from recipients r
  join public.shifts s
    on s.location_id = r.location_id
   and s.status = 'published'
  where (r.preferences ->> 'noShow')::boolean
    and s.ends_at < now()
    and s.ends_at > now() - interval '24 hours'
    and not exists (
      select 1 from public.work_sessions ws
      where ws.employee_id = s.employee_id
        and ws.starts_at >= s.starts_at - interval '1 hour'
        and ws.starts_at <= s.ends_at
    )

  union all

  -- Turno sin salida: la sesión sigue abierta mucho después de lo razonable, o el
  -- servidor ya la marcó para revisión por falta de salida.
  select
    'incompleteEntry'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    ws.id, 'once'::text, r.payload
  from recipients r
  join public.work_sessions ws on ws.location_id = r.location_id
  where (r.preferences ->> 'incompleteEntry')::boolean
    and ws.starts_at > now() - interval '7 days'
    and (
      (ws.status = 'open' and now() > ws.starts_at + interval '16 hours')
      or (ws.status = 'needs_review' and 'missing_clock_out' = any (ws.flags))
    )

  union all

  -- Cerca del umbral DIARIO de horas extra. El margen de 30 minutos es fijo a
  -- propósito: es tiempo de reacción, no una política de la tienda. Un umbral
  -- configurable más sería un interruptor que nadie va a tocar.
  --
  -- SOLO EL DÍA EN CURSO. Sin este filtro la primera ejecución avisaría de cada
  -- día pasado de la ventana: catorce notificaciones sobre jornadas ya cerradas
  -- que el gerente no puede cambiar. "Cercanía a un umbral" solo es accionable
  -- mientras la persona todavía está trabajando.
  select
    'nearOvertime'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    w.employee_id, 'daily:' || w.work_date::text, r.payload
  from recipients r
  join worked w on w.location_id = r.location_id
  where (r.preferences ->> 'nearOvertime')::boolean
    and w.work_date = (now() at time zone r.timezone)::date
    and w.minutes >= coalesce((r.settings ->> 'dailyOvertimeThresholdMinutes')::int, 480) - 30

  union all

  -- Cerca del umbral SEMANAL, sobre la semana de la organización y no la de
  -- Postgres, y solo sobre la semana en curso por la misma razón que arriba.
  select
    'nearOvertime'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    w.employee_id,
    'weekly:' || public.week_start_for(w.work_date, r.week_starts_on)::text,
    r.payload
  from recipients r
  join worked w on w.location_id = r.location_id
  where (r.preferences ->> 'nearOvertime')::boolean
    and public.week_start_for(w.work_date, r.week_starts_on)
        = public.week_start_for((now() at time zone r.timezone)::date, r.week_starts_on)
  group by
    r.user_id, r.locale, r.organization_id, r.location_id, w.employee_id,
    public.week_start_for(w.work_date, r.week_starts_on), r.payload,
    r.settings
  having sum(w.minutes) >= coalesce((r.settings ->> 'weeklyOvertimeThresholdMinutes')::int, 2880) - 30

  union all

  -- Solicitud pendiente. Sin ventana de tiempo: una solicitud sin revisar sigue
  -- siendo un pendiente el mes que viene.
  select
    'newRequest'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    q.id, 'once'::text, r.payload
  from recipients r
  join public.time_edit_requests q on q.location_id = r.location_id
  where (r.preferences ->> 'newRequest')::boolean
    and q.status = 'pending'

  union all

  -- Reloj sin sincronizar. El cubo diario es lo que hace que el aviso vuelva
  -- mañana si el iPad sigue caído, en lugar de avisar una vez y callarse.
  select
    'kioskNotSyncing'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    d.id,
    'day:' || (now() at time zone r.timezone)::date::text,
    r.payload
  from recipients r
  join public.kiosk_devices d on d.location_id = r.location_id and d.status = 'active'
  where (r.preferences ->> 'kioskNotSyncing')::boolean
    and now() > coalesce(d.last_sync_at, d.created_at)
                + make_interval(mins => coalesce((r.settings ->> 'kioskSyncStaleMinutes')::int, 120))

  union all

  -- ENTRADA TEMPRANA (§11.6). Ficho antes del inicio de su turno.
  --
  -- No es una incidencia y por eso viene APAGADA por defecto: la maquina de estados
  -- ya impide fichar antes de `earlyClockInMinutes`, asi que cualquier entrada
  -- temprana permitida esta dentro de la tolerancia. Lo que sirve es el patron —diez
  -- minutos antes todos los dias suma en la nomina—, no el hecho aislado, y una
  -- alerta por cada uno seria ruido.
  --
  -- Se mide contra `starts_at` del turno y no contra la tolerancia: avisar solo de
  -- quien se pasa de la tolerancia no avisaria de nada, porque eso no se puede fichar.
  select
    'earlyClockIn'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    te.employee_id,
    -- Cubo diario en la zona de la TIENDA: con el cubo en UTC, una entrada temprana
    -- de las 19:00 en Lima y otra de las 21:00 del mismo dia caerian en dias
    -- distintos y avisarian dos veces por lo mismo.
    'daily:' || (te.occurred_at at time zone r.timezone)::date::text,
    r.payload
  from recipients r
  join public.time_events te
    on te.location_id = r.location_id
   and te.event_type = 'clock_in'
  join public.shifts s on s.id = te.shift_id
  where (r.preferences ->> 'earlyClockIn')::boolean
    and te.occurred_at < s.starts_at
    -- Solo lo reciente: mas atras no es una alerta, es un informe.
    and te.occurred_at > now() - interval '24 hours'

  union all

  -- CAMBIO DE HORARIO (§11.6). Se publico una version nueva del horario con turnos
  -- cambiados.
  --
  -- NO SE AVISA A QUIEN LO PUBLICO: ya lo sabe, lo acaba de hacer. Esta alerta
  -- existe para los OTROS encargados de la tienda, que es el caso real: dos personas
  -- administran la misma sede y una republica la semana.
  --
  -- Se exige `changed_shift_ids` no vacio: una republicacion que no cambia ningun
  -- turno —corregir una nota, volver a publicar por error— no es un cambio de
  -- horario, y avisar de ella entrena a la gente a ignorar el aviso.
  select
    'scheduleChange'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    sp.id,
    'once'::text,
    r.payload
  from recipients r
  join public.shift_publications sp on sp.location_id = r.location_id
  where (r.preferences ->> 'scheduleChange')::boolean
    and sp.publication_version > 1
    and cardinality(sp.changed_shift_ids) > 0
    and sp.published_at > now() - interval '24 hours'
    and (sp.published_by is null or sp.published_by <> r.user_id)

  union all

  -- Intento de fichaje desde un kiosco revocado o de otra tienda.
  --
  -- NO TIENE INTERRUPTOR, y es deliberado: es el aviso de que un iPad perdido o
  -- robado sigue intentando fichar. Un interruptor aquí permitiría que quien se
  -- llevó el dispositivo sea también quien silencie el aviso de que se lo llevó, y
  -- a diferencia de una tardanza este hecho no aparece en ninguna otra pantalla.
  --
  -- Costo asumido: no se puede callar; un iPad revocado olvidado encendido da un
  -- aviso por hora hasta que lo apaguen. Y como no hay interruptor, la pantalla de
  -- Configuración lo DICE, en vez de dejar una alerta que llega sin que nada en la
  -- app la mencione.
  --
  -- (El comentario anterior justificaba esto diciendo que "las ocho preferencias
  -- de la especificación no incluyen esta alerta". Estaba mal: la §19 lista SIETE
  -- notificaciones, y esta es una de ellas. Las ocho preferencias eran un conjunto
  -- inventado en el esquema inicial, con dos claves que no correspondían a ninguna
  -- alerta. Se corrigen en 20260827001700.)
  select
    'wrongKiosk'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    a.device_id,
    -- El cubo se calcula en UTC y no en la zona de la sesión: si dependiera del
    -- `TimeZone` de quien ejecuta, dos pases del trabajo podrían agrupar el mismo
    -- intento en horas distintas y avisar dos veces.
    'hour:' || to_char(date_trunc('hour', a.occurred_at at time zone 'UTC'), 'YYYY-MM-DD HH24'),
    r.payload
  from recipients r
  join public.kiosk_rejected_attempts a on a.location_id = r.location_id
  where a.occurred_at > now() - interval '2 hours'
$$;


revoke all on function pending_manager_alerts(uuid) from public, anon, authenticated;
grant execute on function pending_manager_alerts(uuid) to service_role;
