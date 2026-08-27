-- Krealo Shift — Row Level Security (especificación §15)
--
-- RLS es la barrera principal de datos, no la interfaz: ocultar un botón no
-- sustituye una política (§7). Todas las tablas expuestas llevan RLS activo y
-- ninguna política usa `using (true)`.
--
-- El kiosco NO usa estas políticas. Opera con una credencial de dispositivo a
-- través de funciones `security definer`, porque un iPad compartido no puede
-- tener los permisos de un usuario personal (§15).

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------
-- Van en `security definer` porque necesitan leer `organization_memberships`
-- sin quedar atrapadas en la propia política de esa tabla (recursión infinita).
-- `search_path` fijo y vacío: evita que un objeto malicioso en otro esquema
-- secuestre la resolución de nombres.

create or replace function app_is_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function app_role_in(p_organization_id uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;

/**
 * ¿El usuario administra esta ubicación?
 *
 * owner y admin ven la organización completa. El gerente ve SOLO las ubicaciones
 * que tiene asignadas con `can_manage`: es la regla que impide que el gerente de
 * Sede Principal lea Sucursal Demo (§32.7).
 */
create or replace function app_manages_location(p_location_id uuid)
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
     and m.user_id = auth.uid()
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
              and e.user_id = auth.uid()
          )
        )
      )
  );
$$;

/** Registro laboral del usuario actual en una organización, si existe. */
create or replace function app_employee_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.organization_id = p_organization_id
    and e.user_id = auth.uid()
  limit 1;
$$;

/** ¿La fila pertenece al registro laboral del usuario actual? */
create or replace function app_is_self_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.user_id = auth.uid()
  );
$$;

revoke all on function app_is_member(uuid) from public;
revoke all on function app_role_in(uuid, public.app_role[]) from public;
revoke all on function app_manages_location(uuid) from public;
revoke all on function app_employee_id(uuid) from public;
revoke all on function app_is_self_employee(uuid) from public;
grant execute on function app_is_member(uuid) to authenticated;
grant execute on function app_role_in(uuid, public.app_role[]) to authenticated;
grant execute on function app_manages_location(uuid) to authenticated;
grant execute on function app_employee_id(uuid) to authenticated;
grant execute on function app_is_self_employee(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS activo en todo
-- ---------------------------------------------------------------------------

alter table organizations              enable row level security;
alter table profiles                   enable row level security;
alter table organization_memberships   enable row level security;
alter table locations                  enable row level security;
alter table employees                  enable row level security;
alter table employee_location_assignments enable row level security;
alter table job_roles                  enable row level security;
alter table employee_job_roles         enable row level security;
alter table employee_pin_credentials   enable row level security;
alter table kiosk_devices              enable row level security;
alter table kiosk_activation_codes     enable row level security;
alter table shifts                     enable row level security;
alter table shift_publications         enable row level security;
alter table time_events                enable row level security;
alter table work_sessions              enable row level security;
alter table break_intervals            enable row level security;
alter table time_adjustments           enable row level security;
alter table timesheet_periods          enable row level security;
alter table time_edit_requests         enable row level security;
alter table availability_rules         enable row level security;
alter table time_off_requests          enable row level security;
alter table announcements              enable row level security;
alter table push_tokens                enable row level security;
alter table notification_preferences   enable row level security;
alter table audit_logs                 enable row level security;

-- `force` para que ni el dueño de la tabla se salte las políticas por accidente
-- en una migración futura.
alter table employee_pin_credentials   force row level security;
alter table kiosk_activation_codes     force row level security;
alter table time_events                force row level security;
alter table audit_logs                 force row level security;

-- ---------------------------------------------------------------------------
-- Organizaciones y perfiles
-- ---------------------------------------------------------------------------

create policy organizations_select on organizations
  for select to authenticated
  using (app_is_member(id));

create policy organizations_update on organizations
  for update to authenticated
  using (app_role_in(id, array['owner', 'admin']::app_role[]))
  with check (app_role_in(id, array['owner', 'admin']::app_role[]));

create policy profiles_select_self on profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Membresías
-- ---------------------------------------------------------------------------

create policy memberships_select on organization_memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[])
  );

-- Protección contra escalamiento de rol (§15): un empleado no puede darse un rol
-- superior modificando su propia fila, porque no puede escribir en esta tabla.
create policy memberships_write on organization_memberships
  for all to authenticated
  using (app_role_in(organization_id, array['owner', 'admin']::app_role[]))
  with check (app_role_in(organization_id, array['owner', 'admin']::app_role[]));

-- ---------------------------------------------------------------------------
-- Ubicaciones y catálogos
-- ---------------------------------------------------------------------------

create policy locations_select on locations
  for select to authenticated
  using (app_is_member(organization_id));

create policy locations_write on locations
  for all to authenticated
  using (app_role_in(organization_id, array['owner', 'admin']::app_role[]))
  with check (app_role_in(organization_id, array['owner', 'admin']::app_role[]));

create policy job_roles_select on job_roles
  for select to authenticated
  using (app_is_member(organization_id));

create policy job_roles_write on job_roles
  for all to authenticated
  using (app_role_in(organization_id, array['owner', 'admin']::app_role[]))
  with check (app_role_in(organization_id, array['owner', 'admin']::app_role[]));

-- ---------------------------------------------------------------------------
-- Empleados
-- ---------------------------------------------------------------------------

-- El empleado ve solo su propio registro laboral. El gerente, solo la gente de
-- las ubicaciones que administra.
create policy employees_select on employees
  for select to authenticated
  using (
    user_id = auth.uid()
    or app_role_in(organization_id, array['owner', 'admin']::app_role[])
    or exists (
      select 1 from employee_location_assignments a
      where a.employee_id = employees.id
        and app_manages_location(a.location_id)
    )
  );

create policy employees_write on employees
  for all to authenticated
  using (
    app_role_in(organization_id, array['owner', 'admin']::app_role[])
    or exists (
      select 1 from employee_location_assignments a
      where a.employee_id = employees.id
        and app_manages_location(a.location_id)
    )
  )
  with check (app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[]));

create policy employee_locations_select on employee_location_assignments
  for select to authenticated
  using (app_is_self_employee(employee_id) or app_manages_location(location_id));

create policy employee_locations_write on employee_location_assignments
  for all to authenticated
  using (app_manages_location(location_id))
  with check (app_manages_location(location_id));

create policy employee_job_roles_select on employee_job_roles
  for select to authenticated
  using (
    app_is_self_employee(employee_id)
    or exists (
      select 1 from employee_location_assignments a
      where a.employee_id = employee_job_roles.employee_id
        and app_manages_location(a.location_id)
    )
  );

create policy employee_job_roles_write on employee_job_roles
  for all to authenticated
  using (
    exists (
      select 1 from employee_location_assignments a
      where a.employee_id = employee_job_roles.employee_id
        and app_manages_location(a.location_id)
    )
  )
  with check (
    exists (
      select 1 from employee_location_assignments a
      where a.employee_id = employee_job_roles.employee_id
        and app_manages_location(a.location_id)
    )
  );

-- ---------------------------------------------------------------------------
-- PIN, kioscos y códigos: sin acceso desde clientes
-- ---------------------------------------------------------------------------
-- No se crea NINGUNA política de select para estas tres tablas. Con RLS activo y
-- sin política, un cliente autenticado no lee ni una fila. Solo las funciones
-- `security definer` y la `service_role` de las Edge Functions llegan aquí.
-- Es lo que impide leer `pin_hash`, `credential_hash` o un código de activación.

revoke all on employee_pin_credentials from anon, authenticated;
revoke all on kiosk_activation_codes from anon, authenticated;

-- De los kioscos, el administrador sí necesita ver el inventario para revocarlos
-- (§11.6), pero nunca la columna del secreto: eso se resuelve con la vista
-- `kiosk_devices_admin` de la migración de funciones, que no expone el hash.
revoke all on kiosk_devices from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Turnos
-- ---------------------------------------------------------------------------

-- El empleado ve solo sus turnos PUBLICADOS: un borrador es trabajo en curso del
-- administrador y mostrarlo generaría reclamos por turnos que aún no existen.
create policy shifts_select on shifts
  for select to authenticated
  using (
    (app_is_self_employee(employee_id) and status = 'published')
    or app_manages_location(location_id)
  );

create policy shifts_write on shifts
  for all to authenticated
  using (app_manages_location(location_id))
  with check (app_manages_location(location_id));

create policy shift_publications_select on shift_publications
  for select to authenticated
  using (app_manages_location(location_id));

create policy shift_publications_insert on shift_publications
  for insert to authenticated
  with check (app_manages_location(location_id));

-- ---------------------------------------------------------------------------
-- Eventos de tiempo
-- ---------------------------------------------------------------------------

create policy time_events_select on time_events
  for select to authenticated
  using (app_is_self_employee(employee_id) or app_manages_location(location_id));

-- Sin política de insert: el empleado NO puede insertar un evento directo (§15).
-- Los eventos entran por `submit_time_event`, que valida credencial del kiosco,
-- token de acción, estado, tienda e idempotencia.
-- Sin política de update ni delete: además los triggers lo prohíben en la base.

-- ---------------------------------------------------------------------------
-- Sesiones, descansos y correcciones
-- ---------------------------------------------------------------------------

create policy work_sessions_select on work_sessions
  for select to authenticated
  using (app_is_self_employee(employee_id) or app_manages_location(location_id));

create policy work_sessions_manager_write on work_sessions
  for update to authenticated
  using (app_manages_location(location_id))
  with check (app_manages_location(location_id));

create policy break_intervals_select on break_intervals
  for select to authenticated
  using (
    exists (
      select 1 from work_sessions s
      where s.id = break_intervals.work_session_id
        and (app_is_self_employee(s.employee_id) or app_manages_location(s.location_id))
    )
  );

create policy time_adjustments_select on time_adjustments
  for select to authenticated
  using (
    exists (
      select 1 from work_sessions s
      where s.id = time_adjustments.work_session_id
        and (app_is_self_employee(s.employee_id) or app_manages_location(s.location_id))
    )
    or app_role_in(organization_id, array['owner', 'admin']::app_role[])
  );

create policy time_adjustments_insert on time_adjustments
  for insert to authenticated
  with check (
    exists (
      select 1 from work_sessions s
      where s.id = time_adjustments.work_session_id
        and app_manages_location(s.location_id)
    )
  );
-- Sin update ni delete: los triggers de la base ya lo impiden, y aquí tampoco
-- hay política que lo permita.

create policy timesheet_periods_select on timesheet_periods
  for select to authenticated
  using (
    app_is_member(organization_id)
    and (location_id is null or app_manages_location(location_id))
  );

create policy timesheet_periods_write on timesheet_periods
  for all to authenticated
  using (
    location_id is null
      and app_role_in(organization_id, array['owner', 'admin']::app_role[])
    or location_id is not null and app_manages_location(location_id)
  )
  with check (
    location_id is null
      and app_role_in(organization_id, array['owner', 'admin']::app_role[])
    or location_id is not null and app_manages_location(location_id)
  );

-- ---------------------------------------------------------------------------
-- Solicitudes
-- ---------------------------------------------------------------------------

create policy time_edit_requests_select on time_edit_requests
  for select to authenticated
  using (app_is_self_employee(employee_id) or app_manages_location(location_id));

create policy time_edit_requests_insert on time_edit_requests
  for insert to authenticated
  with check (app_is_self_employee(employee_id) or app_manages_location(location_id));

-- Solo un gerente resuelve una solicitud. El empleado no puede aprobarse la suya:
-- eso convertiría "Olvidé marcar" en una edición directa de la hoja de tiempo.
create policy time_edit_requests_review on time_edit_requests
  for update to authenticated
  using (app_manages_location(location_id))
  with check (app_manages_location(location_id));

create policy availability_rules_select on availability_rules
  for select to authenticated
  using (
    app_is_self_employee(employee_id)
    or app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[])
  );

create policy time_off_requests_select on time_off_requests
  for select to authenticated
  using (
    app_is_self_employee(employee_id)
    or app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[])
  );

-- ---------------------------------------------------------------------------
-- Anuncios y notificaciones
-- ---------------------------------------------------------------------------

create policy announcements_select on announcements
  for select to authenticated
  using (
    app_is_member(organization_id)
    and (location_id is null or app_is_member(organization_id))
  );

create policy announcements_write on announcements
  for all to authenticated
  using (app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[]))
  with check (app_role_in(organization_id, array['owner', 'admin', 'manager']::app_role[]));

create policy push_tokens_own on push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notification_preferences_own on notification_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------

-- Solo lectura, y solo para propietarios y administradores (§14).
create policy audit_logs_select on audit_logs
  for select to authenticated
  using (app_role_in(organization_id, array['owner', 'admin']::app_role[]));
-- Sin insert desde cliente: la escriben las funciones seguras.

-- ---------------------------------------------------------------------------
-- Permisos de tabla
-- ---------------------------------------------------------------------------
-- RLS filtra filas, pero el `grant` decide si la tabla se puede tocar. Los dos
-- niveles tienen que estar bien: RLS sin `revoke` deja pasar un `delete` masivo
-- sobre las filas que el usuario sí ve.

grant usage on schema public to anon, authenticated;

grant select on organizations, locations, job_roles, employees,
  employee_location_assignments, employee_job_roles, shifts, shift_publications,
  time_events, work_sessions, break_intervals, time_adjustments,
  timesheet_periods, time_edit_requests, availability_rules, time_off_requests,
  announcements, audit_logs, organization_memberships
  to authenticated;

grant insert, update on shifts, shift_publications, timesheet_periods,
  time_edit_requests, employees, employee_location_assignments,
  employee_job_roles, locations, job_roles, announcements,
  organization_memberships
  to authenticated;

grant insert on time_adjustments to authenticated;
grant update on work_sessions to authenticated;
grant all on push_tokens, notification_preferences to authenticated;
grant update on organizations to authenticated;
grant select, update on profiles to authenticated;

-- Borrar turnos en borrador es parte normal del trabajo del administrador; el
-- resto de las tablas no se borra desde el cliente.
grant delete on shifts, employee_location_assignments, employee_job_roles to authenticated;

-- Nada para `anon`: la app siempre actúa autenticada o a través de una función
-- del kiosco con credencial de dispositivo.
revoke all on all tables in schema public from anon;
