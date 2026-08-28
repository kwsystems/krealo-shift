-- Krealo Shift — las preferencias de notificación pasan a ser las que existen (§19)
--
-- EL FALLO
-- La pantalla de Configuración ofrecía OCHO interruptores. Dos de ellos,
-- `earlyClockIn` ("fichaje temprano") y `scheduleChange` ("cambio de horario"), no
-- controlaban nada: NO EXISTE ninguna alerta de esos dos tipos, ni aquí ni en las
-- Edge Functions. Se podían encender, se guardaban, y no pasaba nada nunca.
--
-- POR QUÉ ES PEOR QUE UN INTERRUPTOR DE MÁS
-- Un interruptor que no hace nada es una mentira que no se descubre: quien lo
-- enciende no recibe el aviso y concluye que no ha pasado nada que avisar. Es
-- indistinguible de "todo va bien". Un interruptor que falla al menos se nota.
--
-- DE DÓNDE SALIÓ
-- La §19 lista SIETE notificaciones para el gerente, y `pending_manager_alerts`
-- produce exactamente esas siete: late, noShow, incompleteEntry, nearOvertime,
-- newRequest, kioskNotSyncing y wrongKiosk. El conjunto de ocho preferencias se
-- inventó en `20260827000100` y nunca coincidió con la lista.
--
-- QUÉ QUEDA
-- Seis interruptores —las siete alertas menos `wrongKiosk`, que no lo tiene a
-- propósito, ver el comentario dentro de la función—. La cuenta cierra: cada
-- interruptor apaga una alerta que existe, y la única alerta sin interruptor está
-- explicada en la pantalla.
--
-- LA DEFINICIÓN DE "POR DEFECTO" PASA A ESTAR EN UN SOLO SITIO. Antes estaba
-- duplicada en el `default` de la columna y en un literal dentro de
-- `pending_manager_alerts`, que es exactamente por lo que pudieron divergir.

-- ---------------------------------------------------------------------------
-- La única definición de las preferencias por defecto
-- ---------------------------------------------------------------------------

create or replace function default_notification_preferences()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  -- `late` y `noShow` encendidos porque son el motivo por el que alguien mira el
  -- panel. `kioskNotSyncing` encendido porque un iPad caído no avisa por sí mismo.
  -- Ninguno apagado por defecto: los seis que quedan corresponden a hechos que un
  -- encargado necesita saber, y quien no los quiera los apaga.
  select jsonb_build_object(
    'late', true,
    'noShow', true,
    'nearOvertime', true,
    'incompleteEntry', true,
    'newRequest', true,
    'kioskNotSyncing', true
  );
$$;

comment on function default_notification_preferences is
  'Preferencias de notificacion por defecto (§19). UNICA definicion: la usan el '
  'default de notification_preferences.preferences y el respaldo de '
  'pending_manager_alerts cuando no hay fila. Seis claves, una por alerta con '
  'interruptor; wrongKiosk no tiene interruptor a proposito.';

-- Inmutable y sin datos: cualquiera puede evaluarla. Se concede explícitamente
-- porque `20260827001400` revoca `execute` a `authenticated` sobre todas las
-- funciones y devuelve por lista blanca; sin esto, el `default` de la columna
-- fallaría al insertar desde el panel.
revoke all on function default_notification_preferences() from public;
grant execute on function default_notification_preferences() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El default de la columna, y limpiar lo que ya existe
-- ---------------------------------------------------------------------------

alter table notification_preferences
  alter column preferences set default default_notification_preferences();

-- Las filas que ya se escribieron llevan las dos claves muertas. Se quitan: si se
-- dejaran, el panel las ignoraría pero seguirían ahí para confundir a quien mire
-- la tabla, y un `select preferences` seguiría sugiriendo que esos avisos existen.
update notification_preferences
set preferences = preferences - 'earlyClockIn' - 'scheduleChange',
    updated_at = now()
where preferences ? 'earlyClockIn' or preferences ? 'scheduleChange';

-- Y las que les falte alguna de las seis reales se completan con el valor por
-- defecto, en lugar de dejar un `null` que `(x)::boolean` convertiría en "no
-- avisar". Ese es el modo de fallo silencioso que importa: una preferencia
-- ausente NO significa "no quiero saberlo".
update notification_preferences
set preferences = default_notification_preferences() || preferences,
    updated_at = now()
where not (preferences ?& array['late', 'noShow', 'nearOvertime',
                                'incompleteEntry', 'newRequest', 'kioskNotSyncing']);

-- ---------------------------------------------------------------------------
-- `pending_manager_alerts` con el respaldo compartido
-- ---------------------------------------------------------------------------
--
-- Se recrea íntegra porque Postgres no permite cambiar un trozo del cuerpo. El
-- texto se sacó del propio `20260827001100` y solo se cambiaron dos cosas: el
-- literal de preferencias por la llamada a la función de arriba, y el comentario
-- de `wrongKiosk`, que justificaba la decisión contra el conjunto inventado de
-- ocho en vez de contra la especificación. La decisión no cambia; el motivo sí.

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


-- Los permisos se vuelven a fijar: `create or replace` conserva los de la
-- función anterior, pero dejarlo implícito significa que si algún día se
-- recrea con otro nombre de argumentos, esta función queda abierta sin que
-- nadie lo note. Es la única de este archivo que cruza empresas.
revoke all on function pending_manager_alerts(uuid) from public, anon, authenticated;
grant execute on function pending_manager_alerts(uuid) to service_role;
