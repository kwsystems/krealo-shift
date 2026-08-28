-- ---------------------------------------------------------------------------
-- Quién hizo cada corrección (§11.4)
-- ---------------------------------------------------------------------------
--
-- §11.4 exige que toda corrección conserve valor anterior, valor nuevo, AUTOR, fecha de
-- servidor, motivo, canal y referencia a solicitud. Todo eso se conservaba en
-- `time_adjustments` desde la primera migración, pero el autor NO SE PODÍA MOSTRAR: la
-- columna es `created_by uuid references auth.users`, y el cliente no puede leer
-- `auth.users` —no hay política que lo permita, y no debe haberla—.
--
-- El nombre legible más cercano está en `employees.full_name`, pero solo sirve cuando
-- quien corrigió TIENE ficha de empleado. Un propietario normalmente no la tiene, y una
-- columna "Modificado por" que casi siempre dice un guion es peor que no tenerla: hace
-- dudar del historial entero justo cuando se está auditando. Por eso hace falta el
-- respaldo al correo, y por eso hace falta una función `security definer`.
--
-- ---------------------------------------------------------------------------
-- LA PARTE DELICADA: una función `security definer` que devuelve correos
-- ---------------------------------------------------------------------------
--
-- Una función así, si acepta cualquier uuid, es un oráculo de correos: se llama en bucle
-- con uuids y se cosecha el directorio de usuarios del proyecto. Aquí se cierra por los
-- DOS lados, y hacen falta los dos:
--
--   1. QUIÉN PREGUNTA. Solo se responde a quien administra esa organización. Sin esto,
--      cualquier cuenta autenticada podría preguntar por organizaciones ajenas.
--
--   2. POR QUIÉN SE PREGUNTA. La respuesta se limita a usuarios con membresía en ESA
--      organización, tanto en el camino de `employees` como en el respaldo del correo.
--      Sin esto, quien administra una tienda podría resolver el correo de cualquier
--      usuario del proyecto pasando su uuid, y eso es el oráculo otra vez.
--
-- `stable` y no `volatile` porque no escribe nada; `set search_path = ''` como todas las
-- `security definer` de este esquema, para que un esquema en el path del llamante no
-- pueda suplantar a `public` ni a `auth`.

create or replace function app_actor_display_name(
  p_user_id uuid,
  p_organization_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Barrera 1: quién pregunta.
    when p_user_id is null or p_organization_id is null then null
    when not public.app_role_in(
      p_organization_id,
      array['owner', 'admin', 'manager']::public.app_role[]
    ) then null
    else coalesce(
      -- Barrera 2, camino del nombre: la ficha tiene que ser de ESTA organización.
      (
        select e.full_name
        from public.employees e
        where e.user_id = p_user_id
          and e.organization_id = p_organization_id
        order by e.created_at
        limit 1
      ),
      -- Barrera 2, camino del respaldo: el correo solo si esa persona pertenece a ESTA
      -- organización. Un `select u.email from auth.users u where u.id = p_user_id` a
      -- secas convertiría esto en un directorio de correos del proyecto entero.
      (
        select u.email
        from auth.users u
        join public.organization_memberships m
          on m.user_id = u.id
         and m.organization_id = p_organization_id
        where u.id = p_user_id
        limit 1
      )
    )
  end;
$$;

revoke all on function app_actor_display_name(uuid, uuid) from public;
revoke all on function app_actor_display_name(uuid, uuid) from anon;
grant execute on function app_actor_display_name(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- La vista que consulta la app
-- ---------------------------------------------------------------------------
--
-- `security_invoker = true` como las demás vistas de consulta: las filas las filtra la
-- RLS de `time_adjustments` con los permisos de quien pregunta, no de quien creó la
-- vista. La función de arriba solo traduce el uuid que esa RLS ya autorizó a ver.
--
-- Las columnas son las que ya leía la app más `author_name`. Se enumeran una por una y
-- no con `ta.*`: `select *` en una vista congela las columnas en el momento de crearla,
-- así que una columna nueva en la tabla no aparecería aquí y nadie se daría cuenta.

create or replace view time_adjustments_with_author
with (security_invoker = true)
as
select
  ta.id,
  ta.organization_id,
  ta.work_session_id,
  ta.target_type,
  ta.target_id,
  ta.before_value,
  ta.after_value,
  ta.reason,
  ta.created_at,
  ta.channel,
  ta.request_id,
  -- NULL cuando no se puede resolver: la corrección la hizo alguien que ya no está en la
  -- organización, o la fila la escribió una función del sistema sin `auth.uid()`. La
  -- pantalla lo dice como "—" y no se inventa un nombre.
  public.app_actor_display_name(ta.created_by, ta.organization_id) as author_name
from time_adjustments ta;

revoke all on time_adjustments_with_author from anon;
grant select on time_adjustments_with_author to authenticated;
