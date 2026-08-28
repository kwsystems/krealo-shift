-- Krealo Shift — el aviso de "reloj sin sincronizar" medía el campo equivocado (§19)
--
-- EL FALLO
-- La alerta y la pantalla de Configuración medían contra `kiosk_devices.last_sync_at`.
-- Ese campo lo escribe ÚNICAMENTE la Edge Function `sync-offline-events`, que la app
-- llama solo cuando hay eventos encolados sin conexión.
--
-- Así que en un iPad con buen wifi, que nunca se queda sin red, `last_sync_at` se
-- queda en NULL para siempre. La condición era
-- `now() > coalesce(last_sync_at, created_at) + 120 min`, o sea que disparaba desde
-- dos horas después de la activación y no paraba nunca.
--
-- El encargado recibía "el reloj no sincroniza" TODOS LOS DÍAS por un kiosco que
-- funcionaba perfectamente. Es la peor clase de alerta: la que siempre está
-- encendida. Entrena a la gente a ignorarla, y entonces el día que el iPad de verdad
-- se cae, nadie mira.
--
-- EL CAMPO CORRECTO YA EXISTÍA. `authenticate_kiosk` actualiza `last_seen_at` en
-- CADA petición autenticada del kiosco, de forma central, desde `20260827000300`.
-- Eso sí significa "está viva y hablando con nosotros".
--
-- QUÉ QUEDA
--   * la alerta y `minutes_since_seen` de la vista miden `last_seen_at`;
--   * `last_sync_at` conserva su significado estrecho —última vez que se vació la
--     cola— y se muestra aparte. NULL ahí significa "nunca ha tenido nada que
--     sincronizar", que es el caso normal y bueno, no un problema.

-- `create or replace view` NO puede reordenar ni renombrar columnas: Postgres
-- rechaza cambiar el nombre de una existente. Se borra y se crea, que es seguro
-- porque nada depende de ella —solo la consulta del panel— y el `grant` se vuelve a
-- dar al final.
drop view if exists kiosk_devices_admin;

create view kiosk_devices_admin as
select
  d.id,
  d.organization_id,
  d.location_id,
  l.name as location_name,
  d.display_name,
  d.device_public_id,
  d.status,
  d.app_version,
  d.last_seen_at,
  d.last_sync_at,
  d.created_at,
  d.revoked_at,
  -- MINUTOS DESDE EL ULTIMO CONTACTO, que es lo que mide el aviso de "kiosco sin
  -- sincronizar" de §19. Sale de `last_seen_at`, que `authenticate_kiosk` actualiza
  -- en CADA peticion autenticada del kiosco.
  --
  -- Antes salia de `last_sync_at` y eso era un fallo: ese campo lo escribe solo
  -- `sync-offline-events`, que la app llama unicamente cuando hay eventos encolados
  -- sin conexion. En un iPad con buen wifi se quedaba NULL para siempre, y el aviso
  -- disparaba todos los dias por un kiosco que funcionaba perfectamente.
  --
  -- `coalesce` con `created_at`: un dispositivo recien activado ya se autentico al
  -- menos una vez, asi que `last_seen_at` no deberia ser null; si lo fuera, la
  -- referencia razonable es cuando se creo.
  extract(epoch from (now() - coalesce(d.last_seen_at, d.created_at)))::bigint / 60
    as minutes_since_seen,
  -- Cuanto lleva sin VACIAR LA COLA, que es otra cosa y se muestra aparte. NULL
  -- significa "nunca ha tenido nada que sincronizar", que es el caso normal y bueno
  -- en una tienda con red estable: no es un problema y no debe leerse como uno.
  case
    when d.last_sync_at is null then null
    else extract(epoch from (now() - d.last_sync_at))::bigint / 60
  end as minutes_since_sync
from kiosk_devices d
join locations l on l.id = d.location_id
-- LA BARRERA. Ver la nota de arriba: no hay RLS detrás de esto.
where app_manages_location(d.location_id);

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
  --
  -- MIDE `last_seen_at` Y NO `last_sync_at`, y el cambio arregla un fallo serio.
  -- `last_sync_at` lo escribe solo `sync-offline-events`, que la app llama
  -- unicamente cuando hay eventos encolados sin conexion: en un iPad con buen wifi
  -- se quedaba NULL para siempre y esta alerta disparaba TODOS LOS DIAS por un
  -- kiosco sano. Una alerta que siempre esta encendida entrena a ignorarla, y
  -- entonces el dia que el iPad de verdad se cae nadie mira.
  --
  -- `last_seen_at` lo actualiza `authenticate_kiosk` en cada peticion autenticada,
  -- asi que significa exactamente lo que la alerta quiere saber: si el reloj sigue
  -- hablando con nosotros.
  select
    'kioskNotSyncing'::text, r.user_id, r.locale, r.organization_id, r.location_id,
    d.id,
    'day:' || (now() at time zone r.timezone)::date::text,
    r.payload
  from recipients r
  join public.kiosk_devices d on d.location_id = r.location_id and d.status = 'active'
  where (r.preferences ->> 'kioskNotSyncing')::boolean
    and now() > coalesce(d.last_seen_at, d.created_at)
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


comment on view kiosk_devices_admin is
  'Inventario de kioscos para el panel (§11.6). Excluye credential_hash y '
  'offline_key: son los dos secretos del dispositivo y ninguna sesion de la app '
  'debe poder leerlos. El where de app_manages_location es la UNICA barrera de '
  'autorizacion: la vista corre con los permisos de su dueño y salta la RLS de la '
  'tabla base, que no tiene politicas. minutes_since_seen es lo que mide el aviso '
  'de §19; minutes_since_sync es cuanto lleva sin vaciar la cola y null ahi es '
  'normal.';

grant select on kiosk_devices_admin to authenticated;

revoke all on function pending_manager_alerts(uuid) from public, anon, authenticated;
grant execute on function pending_manager_alerts(uuid) to service_role;
