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

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''),
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
