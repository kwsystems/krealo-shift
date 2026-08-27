-- Krealo Shift — inventario de kioscos para el administrador (§11.6)
--
-- QUÉ FALTABA
-- `20260827000200_rls.sql` revoca todo acceso a `kiosk_devices` para `anon` y
-- `authenticated`, y su propio comentario decía que el inventario se resolvería
-- "con la vista `kiosk_devices_admin` de la migración de funciones". Esa vista
-- nunca se escribió. Resultado: el administrador podía GENERAR un código de
-- activación pero no ver la lista de kioscos, así que **no podía revocar
-- ninguno**. La pantalla de configuración mostraba un "permiso denegado" honesto
-- y el botón de revocar era inalcanzable.
--
-- Poder revocar importa más de lo que parece: es el corte de emergencia cuando un
-- iPad se pierde o se lo llevan. Y ahora también corta la validación de PIN sin
-- conexión, porque un dispositivo revocado deja de recibir verificadores.
--
-- POR QUÉ UNA VISTA Y NO LEVANTAR EL REVOKE
-- Porque `kiosk_devices` tiene dos columnas que nadie con una sesión de la app
-- debe leer nunca:
--   * `credential_hash`, el hash bcrypt de la credencial del dispositivo;
--   * `offline_key`, la clave con la que se derivan los verificadores del PIN.
-- Con `offline_key` en la mano, más el archivo SQLite de un iPad, se pueden
-- probar los 10⁶ PIN posibles. La vista no las incluye, y así el revoke de la
-- tabla sigue en pie: no hay ninguna consulta desde la app que pueda alcanzarlas.

-- OJO CON ESTA VISTA: NO lleva `security_invoker`, a diferencia de las otras del
-- proyecto, y es deliberado.
--
-- `kiosk_devices` tiene RLS activada y CERO políticas, más un `revoke all` para
-- `anon` y `authenticated`. Con `security_invoker = true` la vista se evaluaría con
-- los permisos de quien consulta y devolvería "permission denied" siempre: sería
-- una vista que no se puede leer. Al no ponerlo, se evalúa con los permisos de su
-- dueño, que sí puede leer la tabla.
--
-- CONSECUENCIA QUE HAY QUE TENER PRESENTE: eso salta la RLS de la tabla base, así
-- que el `where` de abajo NO es un filtro de conveniencia, es la única barrera de
-- autorización de esta vista. Si alguien lo quita o lo debilita, el inventario de
-- kioscos de todas las empresas queda legible por cualquier sesión. Hay pruebas
-- que lo fijan desde las dos puntas: la gerenta ve los suyos, la dueña de otra
-- empresa ve cero.
--
-- `app_manages_location` es `security definer` y resuelve contra `auth.uid()`, o
-- sea el usuario que llama, no el dueño de la vista. Por eso el filtro sigue
-- siendo correcto por persona.
create or replace view kiosk_devices_admin as
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
  -- Cuánto lleva sin sincronizar, para el aviso de "kiosco sin sincronizar" de
  -- §19. Se calcula aquí y no en el cliente para que la respuesta sea la misma
  -- desde el panel y desde el trabajo de notificaciones.
  case
    when d.last_sync_at is null then null
    else extract(epoch from (now() - d.last_sync_at))::bigint / 60
  end as minutes_since_sync
from kiosk_devices d
join locations l on l.id = d.location_id
-- LA BARRERA. Ver la nota de arriba: no hay RLS detrás de esto.
where app_manages_location(d.location_id);

comment on view kiosk_devices_admin is
  'Inventario de kioscos para el panel (§11.6). Excluye credential_hash y '
  'offline_key: son los dos secretos del dispositivo y ninguna sesion de la app '
  'debe poder leerlos. El where de app_manages_location es la UNICA barrera de '
  'autorizacion: la vista corre con los permisos de su dueño y salta la RLS de la '
  'tabla base, que no tiene politicas.';

-- La tabla sigue revocada; solo se abre la vista.
grant select on kiosk_devices_admin to authenticated;
