-- Krealo Shift — alertas del gerente (§19)
--
-- QUÉ FALTABA
-- `push_tokens` y `notification_preferences` existían desde la primera migración y
-- el panel ya escribía las ocho preferencias, pero nada calculaba una alerta y
-- nada las enviaba. Ocho interruptores que no encendían nada.
--
-- QUÉ HACE ESTE ARCHIVO
--   1. `pending_manager_alerts()` — qué hechos merecen aviso AHORA, por
--      destinatario, ya filtrados por rol y por preferencia.
--   2. `manager_alert_deliveries` — la tabla de deduplicación. Es la pieza más
--      importante del diseño; la justificación larga está sobre la tabla.
--   3. `claim_manager_alerts()` — reserva y devuelve SOLO lo que no se avisó
--      todavía, en una sola sentencia. La Edge Function `send-manager-alerts`
--      envía lo que esta función le entrega.
--   4. `kiosk_rejected_attempts` + `record_kiosk_rejection()` — el hecho
--      "intento de fichaje desde un kiosco revocado o incorrecto" no existía en
--      ninguna tabla, así que no había nada que avisar. Ver la nota de esa tabla.
--
-- LO QUE NUNCA SALE DE AQUÍ
-- Ninguna función de este archivo devuelve el nombre, el número de empleado, el
-- correo, el teléfono ni la ruta de la foto de una persona. El razonamiento está
-- entero sobre `pending_manager_alerts`.

-- ---------------------------------------------------------------------------
-- Ajuste nuevo: cuánto puede pasar un reloj sin sincronizar
-- ---------------------------------------------------------------------------
-- §19 pide avisar de un "kiosco sin sincronizar durante un periodo
-- configurable". No existía ese ajuste, así que se define aquí.
--
-- POR QUÉ 120 MINUTOS
-- Es el único valor de este archivo elegido a mano, así que conviene decir por
-- qué. Con 15 o 30 minutos el aviso salta con cualquier corte de wifi de una
-- tienda, y un aviso que salta por ruido es un aviso que el gerente silencia. Con
-- 8 o 12 horas el iPad puede pasar un turno entero desconectado y el gerente lo
-- descubre al día siguiente, cuando ya hay horas sin registrar. Dos horas es
-- suficiente para que un corte normal se cure solo y sigue avisando dentro del
-- mismo turno.
--
-- Es por ubicación, no global: una tienda con internet malo puede subirlo sin
-- obligar a las demás a aguantar el mismo ruido.
alter table locations alter column settings set default jsonb_build_object(
  'pinLength', 6,
  'photoEnabled', false,
  'photoRetentionDays', 30,
  'earlyClockInMinutes', 10,
  'lateGraceMinutes', 5,
  'allowUnscheduledShifts', true,
  'timeFormat', '24h',
  'requiredBreakMinutes', 0,
  'dailyOvertimeThresholdMinutes', 480,
  'weeklyOvertimeThresholdMinutes', 2880,
  'kioskSyncStaleMinutes', 120
);

-- Las ubicaciones que ya existen no tienen la clave. Las funciones de abajo usan
-- `coalesce` de todas formas —una fila con `settings` incompleto no debe romper el
-- cálculo— pero se rellena igual para que el panel muestre el valor real y no un
-- campo vacío que al guardar parecería un cambio.
update locations
  set settings = jsonb_set(settings, '{kioskSyncStaleMinutes}', '120'::jsonb)
  where not (settings ? 'kioskSyncStaleMinutes');

-- ---------------------------------------------------------------------------
-- ¿Quién administra esta ubicación? Ahora también sin sesión
-- ---------------------------------------------------------------------------
-- `app_manages_location(location)` resuelve contra `auth.uid()`, y eso es lo
-- correcto para RLS. Pero el trabajo de alertas corre con `service_role` desde un
-- cron: no hay `auth.uid()`, y la pregunta que hay que hacer es "¿ESTA persona
-- administra esta ubicación?", con la persona como parámetro.
--
-- Se extrae la regla a una función con el usuario explícito y `app_manages_location`
-- pasa a ser una envoltura de una línea. Es a propósito: dos copias de la regla de
-- autorización se separan con el primer cambio que alguien haga en una sola, y esa
-- regla es la que impide que la gerenta de Sede Principal lea Sucursal Demo.
create or replace function app_user_manages_location(p_user_id uuid, p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.locations l
    join public.organization_memberships m
      on m.organization_id = l.organization_id
     and m.user_id = p_user_id
     and m.status = 'active'
    where l.id = p_location_id
      and (
        m.role in ('owner', 'admin')
        or (
          m.role = 'manager'
          and exists (
            select 1
            from public.employee_location_assignments a
            join public.employees e on e.id = a.employee_id
            where a.location_id = l.id
              and a.can_manage
              and e.user_id = p_user_id
          )
        )
      )
  );
$$;

-- Misma firma y mismo comportamiento que antes: las políticas RLS y la vista
-- `kiosk_devices_admin` que dependen de ella siguen funcionando sin cambios.
create or replace function app_manages_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_user_manages_location(auth.uid(), p_location_id);
$$;

revoke all on function app_user_manages_location(uuid, uuid) from public;
grant execute on function app_user_manages_location(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Inicio de semana según la organización
-- ---------------------------------------------------------------------------
-- `date_trunc('week', ...)` siempre corta en lunes. `organizations.week_starts_on`
-- existe justamente porque no toda empresa empieza el lunes, y el umbral SEMANAL
-- de horas extra se mide sobre esa semana, no sobre la de Postgres.
create or replace function week_start_for(p_date date, p_week_starts_on smallint)
returns date
language sql
immutable
set search_path = ''
as $$
  -- `isodow` es 1..7 con lunes = 1; `week_starts_on` es 0..6 con domingo = 0.
  -- Se normalizan al mismo eje antes de restar.
  select p_date - (
    (extract(isodow from p_date)::int
      - (case when p_week_starts_on = 0 then 7 else p_week_starts_on::int end)
      + 7) % 7
  );
$$;

revoke all on function week_start_for(date, smallint) from public;
grant execute on function week_start_for(date, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- Intentos de fichaje rechazados
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTA TABLA EXISTE
-- §19 pide avisar al gerente de un "intento de fichaje desde un kiosco revocado o
-- incorrecto". Ese hecho no quedaba registrado en ningún sitio: `authenticate_kiosk`
-- y `submit_time_event` levantan una excepción, y una excepción aborta la
-- transacción, así que un `insert` en la misma función se desharía con ella.
-- Postgres no tiene transacciones autónomas.
--
-- Por eso lo registra la Edge Function, DESPUÉS de recibir el fallo, en una
-- petición nueva: `_shared/kiosk-auth.ts` para el dispositivo revocado o
-- desconocido, y `submit-time-event` para el empleado que no pertenece a la tienda
-- de ese iPad.
--
-- LÍMITE CONOCIDO: si el `device_public_id` no existe en la base, no hay ninguna
-- organización a la que atribuir el intento y no se registra nada. Es coherente
-- —no hay gerente a quien avisar— pero significa que un escaneo con
-- identificadores inventados no deja rastro aquí. Eso pertenece a un límite de
-- peticiones en el borde, no a esta tabla.
create table kiosk_rejected_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  device_id uuid not null references kiosk_devices (id) on delete cascade,
  -- 'revoked' = el iPad está desactivado o su credencial no vale.
  -- 'wrong_location' = el iPad es válido pero el empleado no trabaja en su tienda.
  reason text not null check (reason in ('revoked', 'wrong_location')),
  employee_id uuid references employees (id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index kiosk_rejected_attempts_recent_idx
  on kiosk_rejected_attempts (location_id, occurred_at desc);

alter table kiosk_rejected_attempts enable row level security;
-- Sin políticas: nadie con una sesión de la app lee esta tabla directamente. El
-- gerente se entera por la notificación y por el inventario de kioscos.
revoke all on kiosk_rejected_attempts from anon, authenticated;

comment on table kiosk_rejected_attempts is
  'Intentos de fichaje rechazados por dispositivo revocado o por tienda '
  'equivocada (§19). Lo escribe la Edge Function tras recibir el fallo, porque '
  'una excepcion en la funcion SQL desharia el insert con la transaccion.';

/**
 * Registra un intento rechazado. La llama la Edge Function con `service_role`.
 *
 * Colapsa las repeticiones: un iPad revocado que se quedó encendido reintenta en
 * bucle, y sin esto la tabla crecería sin aportar información nueva. Un minuto es
 * suficiente para que el aviso salga y para no guardar mil filas idénticas.
 *
 * Devuelve el id de la fila, o `null` si el dispositivo no existe o si el intento
 * se colapsó contra uno reciente.
 */
create or replace function record_kiosk_rejection(
  p_device_public_id text,
  p_reason text,
  p_employee_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_id uuid;
begin
  if p_reason not in ('revoked', 'wrong_location') then
    raise exception 'Motivo de rechazo desconocido: %', p_reason
      using errcode = 'check_violation';
  end if;

  -- Se busca también entre los revocados: son justamente los que interesan.
  select d.id, d.organization_id, d.location_id into v_device
  from public.kiosk_devices d
  where d.device_public_id = p_device_public_id;

  if v_device is null then
    return null;
  end if;

  if exists (
    select 1 from public.kiosk_rejected_attempts a
    where a.device_id = v_device.id
      and a.reason = p_reason
      and a.occurred_at > now() - interval '1 minute'
  ) then
    return null;
  end if;

  insert into public.kiosk_rejected_attempts
    (organization_id, location_id, device_id, reason, employee_id)
  values
    (v_device.organization_id, v_device.location_id, v_device.id, p_reason, p_employee_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function record_kiosk_rejection(text, text, uuid) from public;

-- ---------------------------------------------------------------------------
-- LA TABLA DE DEDUPLICACIÓN
-- ---------------------------------------------------------------------------
-- POR QUÉ ES LA PIEZA MÁS IMPORTANTE
-- El trabajo corre cada 15 minutos y las alertas se derivan del estado actual, no
-- de un evento. Sin esta tabla, la misma tardanza de las 09:06 se avisaría a las
-- 09:15, 09:30, 09:45 y así hasta que el turno acabe: 30 notificaciones por una
-- persona que llegó tarde. El gerente apaga las notificaciones el primer día y
-- entonces el sistema entero deja de servir. La deduplicación no es una
-- optimización: es lo que hace utilizable la función.
--
-- LA CLAVE, Y POR QUÉ ES ESA
--   (recipient_user_id, alert_type, subject_id, occurrence_key)
--
--   * `recipient_user_id` va en la clave y no fuera. Dos personas pueden
--     administrar la misma tienda y las dos tienen que enterarse. Si la clave
--     fuera del hecho y no del par hecho+persona, el primer envío se tragaría el
--     aviso de todos los demás. Efecto secundario deseado: a un gerente nuevo le
--     llegan una vez las alertas que ya están abiertas.
--
--   * `subject_id` es el identificador del HECHO, no del empleado: el turno para
--     la tardanza y la ausencia, la sesión de trabajo para el fichaje sin salida,
--     la solicitud para la solicitud pendiente, el dispositivo para el reloj sin
--     sincronizar. Con el empleado como sujeto, dos turnos distintos del mismo día
--     compartirían clave y el segundo no se avisaría nunca.
--
--   * `occurrence_key` es lo que decide si una alerta se repite y cada cuánto, y
--     es la parte que no se puede omitir:
--
--       - Los hechos que ocurren UNA vez llevan 'once'. Un turno se empieza tarde
--         una sola vez; una solicitud se crea una sola vez. Aviso único.
--
--       - Los hechos que son una CONDICIÓN que dura llevan un cubo de tiempo. Un
--         reloj sin sincronizar sigue sin sincronizar mañana: con 'once' se
--         avisaría una vez y nunca más, y si el gerente no vio esa notificación el
--         iPad se queda roto en silencio. Lleva el día de la ubicación, así que el
--         aviso vuelve cada día mientras el problema siga. Cerca del umbral de
--         horas extra es por persona y por día (o por semana, para el umbral
--         semanal), porque mañana es un caso nuevo. Los intentos rechazados llevan
--         la hora del intento: un iPad robado en bucle da un aviso por hora, no
--         uno por intento.
--
-- LO QUE SE DESCARTÓ, Y POR QUÉ
--   * Solo `(alert_type, subject_id)`: se traga el aviso de los demás gerentes.
--   * Una ventana de tiempo ("nada dos veces en 30 minutos"): eso es un límite de
--     ritmo, no deduplicación. Silencia alertas DISTINTAS y sigue reenviando la
--     misma tardanza indefinidamente, solo más despacio.
--   * El texto de la notificación como clave: el texto es traducido y cambia con
--     cualquier corrección de estilo. Un cambio de copy reenviaría todo el
--     historial.
create table manager_alert_deliveries (
  -- Clave sustituta para poder marcar el envío por id. La clave de negocio es el
  -- `unique` de abajo.
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  alert_type text not null check (alert_type in (
    'late', 'noShow', 'incompleteEntry', 'nearOvertime',
    'newRequest', 'kioskNotSyncing', 'wrongKiosk'
  )),
  subject_id uuid not null,
  occurrence_key text not null,
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  -- Idioma con el que se compuso el texto. Se guarda para poder explicar por qué
  -- una notificación salió en un idioma, no para volver a enviarla.
  recipient_locale text not null default 'es-PE',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  failure_reason text,
  -- La restricción lleva nombre a propósito: `claim_manager_alerts` la referencia
  -- con `on conflict on constraint`. Escribir ahí la lista de columnas hace que
  -- Postgres las confunda con los parámetros de salida de la función, y el error
  -- que da —"column reference is ambiguous"— no señala la causa.
  constraint manager_alert_deliveries_key
    unique (recipient_user_id, alert_type, subject_id, occurrence_key)
);

create index manager_alert_deliveries_queued_idx
  on manager_alert_deliveries (queued_at) where status = 'queued';

alter table manager_alert_deliveries enable row level security;
-- Sin políticas y sin permisos: la escriben las funciones `security definer` y la
-- lee la Edge Function con `service_role`. Nada de esto es dato de negocio que la
-- app deba consultar.
revoke all on manager_alert_deliveries from anon, authenticated;

comment on table manager_alert_deliveries is
  'Deduplicacion de notificaciones al gerente (§19). La clave unica '
  '(destinatario, tipo, sujeto, ocurrencia) es lo que evita repetir la misma '
  'tardanza cada 15 minutos. Ver el comentario largo de la migracion.';

-- ---------------------------------------------------------------------------
-- Alertas pendientes
-- ---------------------------------------------------------------------------
/**
 * Hechos que merecen aviso ahora mismo, ya filtrados por rol y por preferencia.
 *
 * `p_organization_id` nulo significa TODAS las organizaciones: es como la llama el
 * trabajo programado. Con un valor concreto sirve para depurar una sola empresa.
 *
 * QUÉ CUENTA COMO DATO SENSIBLE AQUÍ, Y POR QUÉ
 * §19 dice "no enviar datos sensibles en el texto de notificación" y §9.6 prohíbe
 * la fotografía. La línea que traza esta función:
 *
 *   NO SALE: el nombre propio o preferido, el número de empleado, el correo, el
 *   teléfono, la ruta o la URL de la foto, el PIN o cualquier parte de él, la
 *   credencial del dispositivo, la dirección de la tienda.
 *
 *   SÍ SALE: el tipo de alerta, la cantidad de hechos, y el nombre de la
 *   ubicación.
 *
 * Un nombre propio en la pantalla de bloqueo de un teléfono NO es un detalle de
 * estilo: es información laboral de un tercero —"esta persona llegó tarde hoy"—
 * legible por cualquiera que pase cerca del teléfono, sin desbloquearlo, y también
 * por quien esté mirando la pantalla compartida en una reunión. El gerente ve el
 * nombre un toque después, dentro de la app, detrás del código del dispositivo.
 * El costo es real y se asume: la notificación dice "2 personas" y no quién, así
 * que hay que abrir la app para actuar.
 *
 * El nombre de la ubicación sí viaja porque un gerente de dos tiendas necesita
 * saber a cuál ir, y es un rótulo comercial que él mismo eligió, no un dato de una
 * persona.
 *
 * `payload` lleva solo `locationName`. Cualquier columna nueva con un nombre de
 * persona rompe la prueba de `supabase/tests/20_functions.sql`, que fija tanto el
 * conjunto de columnas como la ausencia de nombres del seed.
 */
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
      coalesce(np.preferences, jsonb_build_object(
        'late', true, 'noShow', true, 'earlyClockIn', false, 'nearOvertime', true,
        'incompleteEntry', true, 'newRequest', true, 'scheduleChange', true,
        'kioskNotSyncing', true
      )) as preferences,
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
  -- NO TIENE INTERRUPTOR, y es deliberado. Las ocho preferencias de la
  -- especificación no incluyen esta alerta, y no se inventa una novena: es el
  -- aviso de que un iPad perdido o robado sigue intentando fichar. Un interruptor
  -- aquí permitiría que quien se llevó el dispositivo sea también quien silencie
  -- el aviso, y a diferencia de una tardanza este hecho no aparece hoy en ninguna
  -- pantalla. Costo asumido: no se puede callar; un iPad revocado olvidado
  -- encendido da un aviso por hora hasta que lo apaguen.
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

revoke all on function pending_manager_alerts(uuid) from public;

/**
 * Reserva las alertas que todavía no se avisaron y las devuelve para enviar.
 *
 * TODO ocurre en UNA sentencia. La deduplicación no es "consulto, comparo y
 * escribo": es el propio `insert ... on conflict`, que en Postgres es atómico. Con
 * dos pasos, dos ejecuciones solapadas del trabajo —o un reintento del cron— leen
 * la misma alerta pendiente y las dos la envían.
 *
 * El `on conflict do update` con `where` es lo que permite reintentar sin
 * duplicar: si la fila ya está `sent`, la condición falla y no se devuelve nada;
 * si quedó `queued` porque el envío murió a medias, se vuelve a entregar pasado
 * `p_retry_after` y hasta `p_max_attempts` veces. Después se abandona: reintentar
 * indefinidamente una notificación de hace horas no ayuda a nadie.
 */
create or replace function claim_manager_alerts(
  p_organization_id uuid default null,
  p_max_attempts integer default 3,
  p_retry_after interval default interval '10 minutes'
)
returns table (
  delivery_id uuid,
  alert_type text,
  recipient_user_id uuid,
  recipient_locale text,
  organization_id uuid,
  location_id uuid,
  payload jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    -- `distinct on` la clave completa: una misma persona puede administrar dos
    -- tiendas y un empleado puede tener sesiones en las dos, así que la alerta de
    -- horas extra —cuyo sujeto es el empleado y no la tienda— puede aparecer dos
    -- veces con la misma clave. Postgres rechaza un `on conflict do update` que
    -- toque la misma fila dos veces en una sentencia, con un error que no explica
    -- nada. Se resuelve aquí, no en el llamador.
    select distinct on (a.recipient_user_id, a.alert_type, a.subject_id, a.occurrence_key)
      a.recipient_user_id, a.alert_type, a.subject_id, a.occurrence_key,
      a.organization_id, a.location_id, a.recipient_locale, a.payload
    from public.pending_manager_alerts(p_organization_id) a
    order by a.recipient_user_id, a.alert_type, a.subject_id, a.occurrence_key, a.location_id
  ),
  claimed as (
    insert into public.manager_alert_deliveries as d (
      recipient_user_id, alert_type, subject_id, occurrence_key,
      organization_id, location_id, recipient_locale, payload
    )
    select
      c.recipient_user_id, c.alert_type, c.subject_id, c.occurrence_key,
      c.organization_id, c.location_id, c.recipient_locale, c.payload
    from candidates c
    on conflict on constraint manager_alert_deliveries_key do update
      set attempts = d.attempts + 1,
          queued_at = now()
      where d.status = 'queued'
        and d.attempts < p_max_attempts
        and d.queued_at < now() - p_retry_after
    returning
      d.id, d.alert_type, d.recipient_user_id, d.recipient_locale,
      d.organization_id, d.location_id, d.payload
  )
  select * from claimed;
end;
$$;

revoke all on function claim_manager_alerts(uuid, integer, interval) from public;

/** Marca enviado lo que Expo aceptó. */
create or replace function mark_manager_alerts_sent(p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.manager_alert_deliveries
    set status = 'sent', sent_at = now(), failure_reason = null
    where id = any (p_ids) and status = 'queued';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * Marca fallido lo que Expo rechazó de forma definitiva.
 *
 * `p_reason` se guarda para poder diagnosticar, y por eso NO puede llevar el texto
 * de la notificación ni el token: es un motivo corto de la API de Expo.
 */
create or replace function mark_manager_alerts_failed(p_ids uuid[], p_reason text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.manager_alert_deliveries
    set status = 'failed', failure_reason = left(coalesce(p_reason, ''), 200)
    where id = any (p_ids) and status = 'queued';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** Desactiva un token que Expo declaró inexistente (`DeviceNotRegistered`). */
create or replace function deactivate_push_token(p_expo_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.push_tokens
    set is_active = false
    where expo_token = p_expo_token and is_active;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function mark_manager_alerts_sent(uuid[]) from public;
revoke all on function mark_manager_alerts_failed(uuid[], text) from public;
revoke all on function deactivate_push_token(text) from public;

/**
 * Purga el historial de deduplicación.
 *
 * Sin purga la tabla crece para siempre. Con purga a ciegas reaparecen avisos
 * viejos, porque borrar la fila de deduplicación es exactamente lo mismo que decir
 * "esto no se ha avisado". 180 días es holgado: la ventana más larga de
 * `pending_manager_alerts` es de 7 días.
 *
 * LA EXCEPCIÓN QUE HAY QUE TENER PRESENTE: una solicitud pendiente no caduca. Es
 * el único hecho de vida ilimitada, así que su fila se conserva mientras la
 * solicitud siga pendiente; si no, a los 180 días el gerente recibiría otra vez el
 * aviso de una solicitud que ya conoce.
 */
create or replace function purge_manager_alert_deliveries(p_keep_days integer default 180)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.manager_alert_deliveries d
  where d.queued_at < now() - make_interval(days => greatest(p_keep_days, 1))
    and not exists (
      select 1 from public.time_edit_requests q
      where d.alert_type = 'newRequest'
        and q.id = d.subject_id
        and q.status = 'pending'
    );
  get diagnostics v_count = row_count;

  -- Los intentos rechazados son bitácora, no dato de negocio: se guardan lo
  -- suficiente para investigar un iPad perdido y no más.
  delete from public.kiosk_rejected_attempts
    where occurred_at < now() - interval '90 days';

  return v_count;
end;
$$;

revoke all on function purge_manager_alert_deliveries(integer) from public;

-- ---------------------------------------------------------------------------
-- Programación
-- ---------------------------------------------------------------------------
-- Mismo patrón que `20260827000900_scheduled_jobs.sql`: si `pg_cron` no está, la
-- migración avisa y sigue. Que se aplique importa, porque si falla aquí no corre
-- ninguna migración posterior.
--
-- QUÉ SE PROGRAMA Y QUÉ NO, Y POR QUÉ
-- `pg_cron` ejecuta SQL dentro de la base. La purga es SQL, así que se programa.
-- El ENVÍO no lo es: hay que hablar HTTP con la API de Expo Push, y eso vive en la
-- Edge Function `send-manager-alerts`. Para que `pg_cron` la llamara habría que
-- instalar `pg_net` y guardar un token de servicio en un ajuste de la base, o sea
-- mover un secreto desde el entorno de las Edge Functions —donde está hoy— a la
-- propia base de datos, donde lo puede leer cualquiera con acceso de lectura a la
-- configuración. No se hace: el disparador del envío es un programador externo con
-- la `service_role` (un Scheduled Function de Supabase o un cron propio), cada 15
-- minutos, y está documentado en `supabase/functions/README.md`.
--
-- Si nadie configura ese disparador, la consecuencia es concreta: las alertas se
-- calculan y no se envían. No se pierden —`pending_manager_alerts` las vuelve a
-- devolver mientras el hecho siga vigente— pero nadie se entera.
do $$
declare
  v_has_cron boolean;
begin
  select exists (
    select 1 from pg_available_extensions where name = 'pg_cron'
  ) into v_has_cron;

  if not v_has_cron then
    raise notice
      'pg_cron no disponible: la purga del historial de alertas NO queda '
      'programada. Hay que llamar a purge_manager_alert_deliveries() a diario '
      'desde fuera. Y en cualquier caso el ENVIO lo dispara un programador '
      'externo sobre la Edge Function send-manager-alerts cada 15 minutos.';
    return;
  end if;

  create extension if not exists pg_cron;

  perform cron.unschedule('krealo-shift-purgar-alertas')
    where exists (
      select 1 from cron.job where jobname = 'krealo-shift-purgar-alertas'
    );

  -- 03:30 UTC, o 22:30 en Lima: quince minutos después de la purga de fotos, para
  -- no arrancar dos borrados a la vez sobre la misma base.
  perform cron.schedule(
    'krealo-shift-purgar-alertas',
    '30 3 * * *',
    $job$ select public.purge_manager_alert_deliveries(); $job$
  );

  raise notice
    'Purga del historial de alertas programada a diario (03:30 UTC). El ENVIO lo '
    'dispara un programador externo sobre send-manager-alerts cada 15 minutos.';
end
$$;
