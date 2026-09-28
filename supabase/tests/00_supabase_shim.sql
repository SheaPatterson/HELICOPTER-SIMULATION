-- Virtual HEMS — Supabase compatibility shim for a plain PostGIS instance
-- ---------------------------------------------------------------------------
-- The migrations under supabase/migrations/ are authored for the Supabase
-- managed Postgres image, which ships:
--   * the roles `anon`, `authenticated`, `service_role` (and `authenticator`),
--   * the `auth` schema with `auth.users` and the `auth.uid()` helper,
--   * a GUC-driven request context (`request.jwt.claims`) that `auth.uid()` reads.
--
-- A stock `postgis/postgis:15-3.4` container has NONE of these. This shim
-- reproduces exactly the surface the migrations depend on so the four project
-- migrations apply and enforce RLS identically to the Supabase runtime. It is a
-- TEST HARNESS ONLY file — it is never applied to a real Supabase database
-- (Supabase already provides all of this).
--
-- What we reproduce, and why it matches production behavior:
--   * auth.uid() resolves the acting user's id from the verified JWT claims. In
--     Supabase this is `(request.jwt.claims ->> 'sub')::uuid`. We implement the
--     same so hems.current_user_id() (which wraps auth.uid()) behaves identically.
--   * `request.jwt.claims` is a per-transaction GUC set with
--     `set local request.jwt.claims = '{...}'`. Setting the role with
--     `set local role authenticated|anon` selects which RLS policies apply. This
--     is precisely how Supabase evaluates RLS for PostgREST requests.

-- ---------------------------------------------------------------------------
-- Supabase roles. `nologin` group roles are sufficient for `set local role`.
-- ---------------------------------------------------------------------------
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
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'postgres';
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
-- The bootstrap superuser must be able to `set role` into these for test setup.
grant anon, authenticated, service_role to current_user;

-- ---------------------------------------------------------------------------
-- Minimal `auth` schema: `auth.users` (referenced by profiles.id FK) and
-- `auth.uid()` (read by hems.current_user_id()).
-- ---------------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Supabase's auth.uid(): the `sub` claim of the verified JWT, as uuid.
-- `true` => missing_ok, so an unset GUC (anon, no claims) yields NULL.
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

-- Grant the shim schema so `authenticated`/`anon` can resolve identity, mirroring
-- Supabase's default grants on the auth helpers.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- PostgREST/Supabase grant the API roles table privileges; RLS then narrows them.
-- Without base privileges, RLS would be moot (default deny at the GRANT layer).
-- We grant broad table DML to anon/authenticated on the public schema so that the
-- RLS policies — not missing GRANTs — are what actually gate access in these tests.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
