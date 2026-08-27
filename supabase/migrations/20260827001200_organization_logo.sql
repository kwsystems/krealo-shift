-- Krealo Shift — logotipo de la organización (§11.6)
--
-- QUÉ FALTABA
-- `organizations.logo_path` existía desde el esquema inicial, pero sin bucket
-- donde guardar la imagen. Igual que pasaba con las fotos de fichaje: una columna
-- que apunta a un sitio que no existe.
--
-- POR QUÉ ESTE BUCKET SÍ ES PÚBLICO, A DIFERENCIA DEL DE LAS FOTOS
-- Es la única decisión que hay que pensar aquí, y va en la dirección contraria.
-- Un logotipo de empresa es material de marca: se pone en la pantalla del kiosco,
-- que está a la vista de cualquiera que entre a la tienda, y a veces en un correo
-- o un PDF exportado. Tratarlo como secreto obligaría a firmar una URL cada vez
-- que el kiosco pinta su pantalla de reposo —incluido un kiosco sin sesión de
-- usuario— y no protegería nada: la imagen ya es pública de hecho.
--
-- La comparación es útil: la foto de fichaje es la cara de una persona trabajando
-- y va en bucket privado con URL firmada. El logotipo es el letrero de la puerta.
-- Los dos casos existen en la misma app y merecen tratos opuestos; confundirlos en
-- cualquiera de las dos direcciones sería el error.
--
-- ESCRIBIR SÍ ESTÁ RESTRINGIDO. Público es la lectura, no la subida: solo quien
-- es owner o admin de la organización del primer segmento de la ruta puede
-- escribir o borrar. Si no, cualquier sesión podría reemplazar el logotipo de
-- cualquier empresa, que es una forma barata de suplantación.
--
-- RUTA: {organization_id}/logo.{ext}. Sin fecha ni identificador aleatorio, porque
-- hay UN logotipo por organización y sustituirlo debe sustituirlo, no acumular
-- versiones que nadie va a limpiar.

-- ---------------------------------------------------------------------------
-- Quién puede administrar una organización
-- ---------------------------------------------------------------------------

/**
 * Cierto si quien llama es owner o admin de la organización.
 *
 * Existe aparte de `app_role_in` porque las políticas de `storage.objects` tienen
 * que resolver esto desde un segmento del nombre del archivo, sin más contexto, y
 * repetir el `array[...]::public.app_role[]` en cada política es cómo se
 * introducen diferencias silenciosas entre ellas.
 */
create or replace function app_administers_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_role_in(p_organization_id, array['owner', 'admin']::public.app_role[]);
$$;

revoke all on function app_administers_organization(uuid) from public;
grant execute on function app_administers_organization(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bucket y políticas — solo si la extensión de Storage está presente
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'Storage de Supabase no presente: se omiten el bucket de logotipos y '
      'sus politicas. Normal en el Postgres local de pruebas; en la nube se aplican.';
    return;
  end if;

  -- 1 MB basta de sobra para un logotipo y evita que alguien suba una imagen de
  -- imprenta que el kiosco tendría que descargar en cada arranque.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('organization-logos', 'organization-logos', true, 1048576,
          array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
  on conflict (id) do update
    set public = true,
        file_size_limit = 1048576,
        allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

  -- LECTURA: pública. Ver la nota de arriba sobre por qué.
  drop policy if exists "logos legibles por cualquiera" on storage.objects;
  create policy "logos legibles por cualquiera"
    on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'organization-logos');

  -- ESCRITURA: solo owner o admin de LA organización del primer segmento.
  drop policy if exists "logos los sube un administrador" on storage.objects;
  create policy "logos los sube un administrador"
    on storage.objects for insert
    to authenticated
    with check (
      bucket_id = 'organization-logos'
      and public.app_administers_organization(((storage.foldername(name))[1])::uuid)
    );

  drop policy if exists "logos los reemplaza un administrador" on storage.objects;
  create policy "logos los reemplaza un administrador"
    on storage.objects for update
    to authenticated
    using (
      bucket_id = 'organization-logos'
      and public.app_administers_organization(((storage.foldername(name))[1])::uuid)
    );

  drop policy if exists "logos los borra un administrador" on storage.objects;
  create policy "logos los borra un administrador"
    on storage.objects for delete
    to authenticated
    using (
      bucket_id = 'organization-logos'
      and public.app_administers_organization(((storage.foldername(name))[1])::uuid)
    );
end
$$;
