-- Krealo Shift — reglas de integridad que no se pueden dejar solo a la interfaz
--
-- Estas son reglas de la especificación que RLS por sí solo no puede expresar,
-- porque no dependen de QUIÉN consulta sino de en qué estado queda la tabla
-- después de escribir.

-- ---------------------------------------------------------------------------
-- Una organización nunca se queda sin propietario (§7)
-- ---------------------------------------------------------------------------
-- El administrador tiene casi todos los permisos operativos del propietario,
-- pero no puede eliminar al último propietario ni transferir la propiedad. Si
-- esto viviera solo en la app, un `delete` desde cualquier cliente dejaría la
-- organización sin nadie que pueda administrarla, sin vuelta atrás.

create or replace function guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_remaining integer;
begin
  v_org := coalesce(old.organization_id, new.organization_id);

  -- Solo importa cuando la fila afectada era de un propietario activo y deja de
  -- serlo: por borrado, por cambio de rol o por suspensión.
  if old.role <> 'owner' or old.status <> 'active' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active' then
    return new;
  end if;

  select count(*) into v_remaining
  from public.organization_memberships m
  where m.organization_id = v_org
    and m.role = 'owner'
    and m.status = 'active'
    and m.id <> old.id;

  if v_remaining = 0 then
    raise exception
      'Una organización no puede quedarse sin propietario activo. Asigna otro propietario antes de cambiar este.'
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger organization_memberships_guard_owner_update
  before update on organization_memberships
  for each row execute function guard_last_owner();

create trigger organization_memberships_guard_owner_delete
  before delete on organization_memberships
  for each row execute function guard_last_owner();

-- ---------------------------------------------------------------------------
-- Solapamiento de turnos (§11.3)
-- ---------------------------------------------------------------------------
-- El editor advierte los solapamientos antes de publicar, pero la advertencia no
-- puede ser la única defensa: dos administradores editando la misma semana en
-- paralelo pueden crear un solapamiento que ninguna pantalla vio.
--
-- Se aplica solo a turnos publicados. Los borradores pueden solaparse mientras el
-- administrador reorganiza la semana; es al publicar cuando debe estar limpio.

create or replace function guard_shift_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_conflict record;
begin
  if new.status <> 'published' then
    return new;
  end if;

  select s.id, s.starts_at, s.ends_at into v_conflict
  from public.shifts s
  where s.employee_id = new.employee_id
    and s.id <> new.id
    and s.status = 'published'
    and tstzrange(s.starts_at, s.ends_at, '[)')
        && tstzrange(new.starts_at, new.ends_at, '[)')
  limit 1;

  if v_conflict is not null then
    raise exception
      'El turno se solapa con otro turno publicado del mismo empleado (% a %).',
      v_conflict.starts_at, v_conflict.ends_at
      using errcode = 'exclusion_violation';
  end if;

  return new;
end;
$$;

create trigger shifts_guard_overlap
  before insert or update on shifts
  for each row execute function guard_shift_overlap();

-- ---------------------------------------------------------------------------
-- Publicar un turno registra su versión (§11.3)
-- ---------------------------------------------------------------------------
-- Las tardanzas se miden contra el turno publicado vigente en el momento del
-- fichaje, así que la versión no puede quedar a criterio del cliente.

create or replace function stamp_shift_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published'
     and (old.status is distinct from 'published'
          or old.starts_at is distinct from new.starts_at
          or old.ends_at is distinct from new.ends_at) then
    new.published_at := now();
    new.publication_version := coalesce(old.publication_version, 0) + 1;
  end if;
  return new;
end;
$$;

create trigger shifts_stamp_publication
  before update on shifts
  for each row execute function stamp_shift_publication();

-- ---------------------------------------------------------------------------
-- Un turno publicado no se borra: se cancela (§11.3)
-- ---------------------------------------------------------------------------
-- Cambiar un horario nunca debe alterar por sí solo los fichajes que ya
-- ocurrieron. Si un turno publicado desapareciera, los eventos que lo referencian
-- perderían su contexto y las tardanzas ya calculadas dejarían de ser explicables.

create or replace function guard_published_shift_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'published' then
    raise exception
      'Un turno publicado no se elimina: cámbialo a cancelado para conservar el historial.'
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

create trigger shifts_guard_published_delete
  before delete on shifts
  for each row execute function guard_published_shift_delete();
