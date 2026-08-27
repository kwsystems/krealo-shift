-- Krealo Shift — almacenamiento de las fotos de fichaje (§9.6, §22)
--
-- QUÉ FALTABA
-- El esquema ya tenía `time_events.photo_path` y las políticas para leerlo, pero
-- no existía el bucket donde guardar la imagen, ni reglas de acceso a los
-- archivos, ni purga por retención. O sea: la columna apuntaba a un sitio que no
-- existía. Activar `photoEnabled` en una tienda real habría fallado al subir.
--
-- LAS DECISIONES, Y POR QUÉ
--
-- 1. BUCKET PRIVADO, SIN EXCEPCIÓN. Es una foto del rostro de una persona
--    trabajando. Un bucket público serviría esas imágenes a cualquiera con la URL,
--    y las URL de Storage son adivinables si se conoce el patrón. Se lee siempre
--    con URL firmada de vida corta.
--
-- 2. LA RUTA LLEVA LA ORGANIZACIÓN AL PRINCIPIO:
--       {organization_id}/{location_id}/{yyyy}/{mm}/{event_id}.jpg
--    Así el aislamiento entre empresas se puede comprobar con un prefijo, que es
--    lo único que las políticas de `storage.objects` saben mirar sin consultar
--    otra tabla. Sin eso, cada política tendría que resolver el evento para saber
--    de quién es el archivo.
--
-- 3. NADIE ESCRIBE DIRECTO. El iPad no tiene sesión de usuario, solo su credencial
--    de kiosco, así que no puede subir con la anon key. Sube con una URL firmada
--    que emite una Edge Function tras autenticarlo. Por eso aquí NO hay política
--    de insert para `anon` ni `authenticated`: la escritura pasa por
--    `service_role`, que no las evalúa.
--
-- 4. SE PUEDE MIRAR, NO SE PUEDE CAMBIAR NI BORRAR A MANO. Un gerente de la
--    ubicación lee; nadie actualiza. El borrado lo hace solo la purga por
--    retención, que corre como `service_role`. Una foto que un gerente pueda
--    borrar cuando le convenga no sirve como evidencia de nada.
--
-- LÍMITE CONOCIDO: `storage.buckets` y `storage.objects` los crea la extensión de
-- Storage de Supabase, que no existe en un Postgres pelado. Todo lo que toca esas
-- tablas va condicionado a que existan, para que esta migración se aplique igual
-- en el entorno de pruebas local. Lo que sí se puede probar sin Storage —la
-- función de purga y la de rutas— no está condicionado.

-- ---------------------------------------------------------------------------
-- Excepción append-only, del tamaño exacto de la purga y ni un milímetro más
-- ---------------------------------------------------------------------------
--
-- `time_events` es append-only con un disparador que rechaza TODO update, y eso
-- incluye poner `photo_path` a null. O sea: sin esta excepción, la purga por
-- retención no puede correr, y la app se queda guardando fotos de personas para
-- siempre. Es un conflicto real entre dos reglas correctas.
--
-- Se resuelve permitiendo que cambie UNA columna, `photo_path`, y ninguna otra.
-- Cualquier otra diferencia —una hora, un tipo de evento, un empleado— se sigue
-- rechazando, igual que antes.
--
-- POR QUÉ `photo_path` Y NO OTRA: no es un dato del fichaje, es un puntero a un
-- archivo cuyo ciclo de vida es inherentemente mutable. La imagen se sube después
-- del evento (la subida puede tardar o reintentarse, y con red mala eso es lo
-- normal) y se borra antes que el evento (retención). Las horas trabajadas, que
-- son lo que la regla append-only protege, no se tocan.
--
-- Se permite en las DOS direcciones a propósito. Solo hacia null bastaría para la
-- purga, pero entonces la foto tendría que escribirse al crear el evento, o sea
-- ANTES de que exista el archivo, y `photo_path` apuntaría a un objeto inexistente
-- cada vez que una subida fallara. Permitir null → ruta deja poner el puntero
-- solo cuando el archivo ya está arriba, que es la única forma de que la columna
-- no mienta.
--
-- Quién puede hacerlo sigue siendo estrecho: la ruta la deriva el servidor con
-- `attendance_photo_path`, y la escritura pasa por una Edge Function con
-- `service_role`. Ninguna sesión de la app actualiza `time_events`.
--
-- La comparación se hace convirtiendo las dos filas a jsonb y anulando
-- `photo_path` en ambas. Es a propósito: así una columna que se agregue mañana a
-- `time_events` queda protegida sin que nadie tenga que acordarse de añadirla a
-- una lista.

create or replace function reject_time_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'La tabla % es append-only: usa un ajuste auditable en lugar de borrar el evento original.',
      tg_table_name
      using errcode = 'restrict_violation';
  end if;

  -- El único update permitido: mover el puntero de la foto, en cualquier
  -- dirección, sin tocar nada más.
  if (to_jsonb(old) - 'photo_path') = (to_jsonb(new) - 'photo_path') then
    return new;
  end if;

  raise exception
    'La tabla % es append-only: solo se puede cambiar la ruta de la foto.',
    tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists time_events_no_update on time_events;
create trigger time_events_no_update
  before update on time_events
  for each row execute function reject_time_event_mutation();

-- El disparador de borrado sigue igual de cerrado; se reapunta a la misma función
-- para que los dos mensajes salgan del mismo sitio.
drop trigger if exists time_events_no_delete on time_events;
create trigger time_events_no_delete
  before delete on time_events
  for each row execute function reject_time_event_mutation();

-- ---------------------------------------------------------------------------
-- Ruta del archivo: una sola definición, usada por servidor y por la app
-- ---------------------------------------------------------------------------

/**
 * Construye la ruta de la foto de un evento.
 *
 * Existe como función y no como cadena armada en tres sitios porque la ruta es un
 * contrato: las políticas de Storage dependen de que el primer segmento sea la
 * organización. Si un día cambia, cambia aquí y las políticas siguen valiendo.
 */
create or replace function attendance_photo_path(p_event_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.organization_id::text || '/' ||
         e.location_id::text || '/' ||
         to_char(e.occurred_at, 'YYYY') || '/' ||
         to_char(e.occurred_at, 'MM') || '/' ||
         e.id::text || '.jpg'
  from public.time_events e
  where e.id = p_event_id;
$$;

revoke all on function attendance_photo_path(uuid) from public;
grant execute on function attendance_photo_path(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Purga por retención (§22)
-- ---------------------------------------------------------------------------

/**
 * Borra las fotos que pasaron el plazo de retención de SU ubicación.
 *
 * Cada ubicación tiene su propio `photoRetentionDays`, así que el plazo se lee por
 * ubicación y no como una constante global: una tienda puede guardar 15 días y
 * otra 30.
 *
 * Devuelve cuántas borró. No es un detalle cosmético: un trabajo programado que
 * siempre devuelve 0 es indistinguible de uno que no corre, y así se puede
 * vigilar.
 *
 * DOS PASOS, EN ESTE ORDEN: primero se borra el archivo, después se limpia la
 * columna. Al revés quedarían archivos huérfanos que nada volvería a mirar —o sea
 * fotos de personas guardadas para siempre sin que nadie sepa que están ahí—.
 * Si el borrado del archivo falla, `photo_path` sigue puesto y el siguiente pase
 * lo reintenta.
 *
 * El evento en sí NO se toca: `time_events` es append-only y las horas trabajadas
 * no caducan. Lo que caduca es la imagen.
 */
create or replace function purge_expired_attendance_photos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_deleted integer := 0;
  v_has_storage boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) into v_has_storage;

  for v_row in
    select e.id, e.photo_path
    from public.time_events e
    join public.locations l on l.id = e.location_id
    where e.photo_path is not null
      and e.occurred_at < now() - make_interval(
        days => coalesce((l.settings ->> 'photoRetentionDays')::int, 30))
  loop
    if v_has_storage then
      execute 'delete from storage.objects where bucket_id = $1 and name = $2'
        using 'attendance-photos', v_row.photo_path;
    end if;

    -- `photo_path` es la única columna de `time_events` que se puede modificar
    -- después de creada, y el disparador append-only lo permite justamente por
    -- esto. Ver la excepción en `reject_mutation()`.
    update public.time_events set photo_path = null where id = v_row.id;
    v_deleted := v_deleted + 1;
  end loop;

  if v_deleted > 0 then
    insert into public.audit_logs
      (organization_id, action, entity_type, after_data)
    select distinct e.organization_id, 'photos_purged', 'time_event',
           jsonb_build_object('deleted', v_deleted)
    from public.time_events e
    limit 1;
  end if;

  return v_deleted;
end;
$$;

revoke all on function purge_expired_attendance_photos() from public;
-- Sin `grant`: la ejecuta un trabajo programado con la `service_role`.

-- ---------------------------------------------------------------------------
-- Bucket y políticas — solo si la extensión de Storage está presente
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'Storage de Supabase no presente: se omiten el bucket y sus politicas. '
      'Normal en el Postgres local de pruebas; en la nube se aplican.';
    return;
  end if;

  -- `public => false` es lo que importa de esta línea. El límite de tamaño evita
  -- que un fallo de la app llene el bucket con una imagen sin comprimir.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('attendance-photos', 'attendance-photos', false, 2097152,
          array['image/jpeg', 'image/webp'])
  on conflict (id) do update
    set public = false,
        file_size_limit = 2097152,
        allowed_mime_types = array['image/jpeg', 'image/webp'];

  -- LECTURA: solo quien administra la ubicación del primer y segundo segmento de
  -- la ruta. `storage.foldername(name)` devuelve los segmentos; el 1 es la
  -- organización y el 2 la ubicación.
  drop policy if exists "attendance photos legibles por gerentes" on storage.objects;
  create policy "attendance photos legibles por gerentes"
    on storage.objects for select
    to authenticated
    using (
      bucket_id = 'attendance-photos'
      and public.app_manages_location(((storage.foldername(name))[2])::uuid)
    );

  -- Sin políticas de insert, update ni delete a propósito. Subir pasa por una URL
  -- firmada que emite una Edge Function; borrar, solo la purga por retención.
  -- Las dos corren con `service_role`, que no evalúa políticas.
  drop policy if exists "attendance photos sin escritura directa" on storage.objects;
end
$$;
