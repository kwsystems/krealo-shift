-- Shim mínimo de Supabase para poder aplicar y probar las migraciones en un
-- Postgres normal, sin depender de la nube ni del CLI de Supabase.
--
-- Reproduce solo lo que las migraciones usan: el esquema `auth`, su tabla
-- `users`, y las funciones `auth.uid()` / `auth.role()` que leen la misma
-- variable de sesión que usa Supabase (`request.jwt.claims`). Eso permite
-- probar las políticas RLS impersonando usuarios reales.
--
-- NO se aplica en producción: en Supabase todo esto ya existe.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- El `nullif(..., '')` ANTES del cast a jsonb no es adorno: cuando la variable no
-- esta puesta, `current_setting(..., true)` devuelve cadena vacia en vez de null, y
-- ''::jsonb lanza "invalid input syntax for type json". La version real de Supabase
-- tolera ese caso y devuelve null, asi que el shim tambien tiene que hacerlo.
--
-- Se descubrio al añadir comprobaciones de `auth.uid()` a funciones que se llaman
-- desde el camino del kiosco, donde no hay ningun JWT puesto.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
    'anon'
  );
$$;

-- Roles que Supabase crea por defecto y a los que apuntan los `grant`.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privilegios por defecto de Supabase — EL DETALLE QUE HACIA FALSAS LAS PRUEBAS
-- ---------------------------------------------------------------------------
--
-- Supabase deja configurado esto en el esquema `public` al crear el proyecto. Sin
-- ello, este Postgres local NO se parece a produccion en algo que importa mucho.
--
-- Por que importa: en PostgreSQL una funcion nueva nace con `execute` concedido a
-- `PUBLIC`, y `revoke all on function ... from public` lo quita. Pero con estos
-- privilegios por defecto, cada funcion nueva nace ADEMAS con `execute` concedido
-- EXPLICITAMENTE a `anon`, `authenticated` y `service_role`. Y revocar de `PUBLIC`
-- no toca esas concesiones: son otra cosa.
--
-- Resultado: una funcion `security definer` pensada solo para la `service_role`
-- —`submit_time_event`, por ejemplo— queda invocable por RPC desde cualquier sesion
-- con sesion de usuario, aunque su migracion diga `revoke all ... from public`.
--
-- Aqui faltaba, asi que las pruebas daban verde sobre un modelo de permisos que en
-- produccion no existe. Ahora estan, y las pruebas de mas abajo lo comprueban.
alter default privileges in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
