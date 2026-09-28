-- Virtual HEMS — RLS & role-scoping integration test  (task 2.4)
-- ===========================================================================
-- Requirements under test:
--   8.3 / 8.5 — A pilot may mutate ONLY records they own. A mutation of a record
--               owned by another pilot, by a caller holding no authorized role,
--               is rejected and the target row is left unchanged.
--   8.6       — Patient/clinical/VIRS records are NEVER returned on public (anon)
--               routes; reference tables (hems_bases/hospitals) ARE public.
--
-- Mechanism (identical to how Supabase evaluates RLS for a PostgREST request):
--   * `set local role authenticated|anon` selects the policy set.
--   * `set local request.jwt.claims = '{"sub": "<uuid>", "user_role": "..."}'`
--     supplies the verified-JWT context that auth.uid()/hems.current_role_name()
--     read. Everything runs inside ONE transaction; each assertion resets context.
--
-- Assertion style: plain psql. `\set ON_ERROR_STOP on` + RAISE EXCEPTION means the
-- FIRST failed assertion aborts with a non-zero exit and a descriptive message.
-- A run that prints "RLS INTEGRATION TESTS PASSED" completed every assertion.
-- ===========================================================================

\set ON_ERROR_STOP on
\timing off
begin;

-- Fixed fixture identifiers (see 01_test_fixtures.sql).
\set pilot_a '11111111-1111-1111-1111-111111111111'
\set pilot_b '22222222-2222-2222-2222-222222222222'
\set admin_u '33333333-3333-3333-3333-333333333333'
\set mission_a 'aaaaaaaa-0000-0000-0000-000000000001'

-- Helper: become an authenticated user with the given sub + optional role claim.
create or replace function pg_temp.act_as(p_sub text, p_role text default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  if p_role is null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_sub)::text, true);
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_sub, 'user_role', p_role)::text, true);
  end if;
end;
$$;

-- Helper: become the anonymous (public) role — no JWT claims at all.
create or replace function pg_temp.act_as_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Helper: drop back to the bootstrap superuser to reset context between cases.
create or replace function pg_temp.act_as_super()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- =========================================================================
-- CASE 1 (req 8.3): a pilot CAN mutate a record they own.
--   Pilot A updates their own mission's clinical_summary. Expect 1 row affected.
-- =========================================================================
do $$
declare n integer;
begin
  perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');
  update missions
     set clinical_summary = 'owner-edit-ok'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'CASE 1 FAILED (8.3): owner update affected % rows, expected 1', n;
  end if;
  perform pg_temp.act_as_super();
end;
$$;

-- Confirm at the data layer that Case 1 actually wrote.
do $$
declare v text;
begin
  select clinical_summary into v from missions
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v is distinct from 'owner-edit-ok' then
    raise exception 'CASE 1 VERIFY FAILED (8.3): clinical_summary = %, expected owner-edit-ok', v;
  end if;
end;
$$;

-- =========================================================================
-- CASE 2 (req 8.5): a pilot CANNOT mutate a record owned by another pilot and
--   the target row is left UNCHANGED. Pilot B (no authorized role) attempts to
--   update Pilot A's mission. Default-deny RLS => 0 rows match => no change.
-- =========================================================================
do $$
declare n integer;
begin
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
  update missions
     set clinical_summary = 'intruder-edit'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'CASE 2 FAILED (8.5): cross-owner update affected % rows, expected 0', n;
  end if;
  perform pg_temp.act_as_super();
end;
$$;

-- Confirm the target row is UNCHANGED after the rejected cross-owner mutation.
do $$
declare v text;
begin
  select clinical_summary into v from missions
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v is distinct from 'owner-edit-ok' then
    raise exception 'CASE 2 VERIFY FAILED (8.5): target changed to %, expected unchanged owner-edit-ok', v;
  end if;
end;
$$;

-- =========================================================================
-- CASE 2b (req 8.5): Pilot B also cannot DELETE Pilot A's mission. 0 rows.
-- =========================================================================
do $$
declare n integer;
begin
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
  delete from missions where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'CASE 2b FAILED (8.5): cross-owner delete affected % rows, expected 0', n;
  end if;
  perform pg_temp.act_as_super();
end;
$$;

-- =========================================================================
-- CASE 2c (req 8.5): Pilot B cannot INSERT a mission owned by Pilot A. The
--   WITH CHECK (pilot_id = auth.uid()) predicate must reject it (error).
-- =========================================================================
do $$
declare failed boolean := false;
begin
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
  begin
    insert into missions (mission_code, mission_type, status, pilot_id, schema_version)
    values ('TEST-SPOOF-B', 'SCENE_CALL', 'DISPATCHED',
            '11111111-1111-1111-1111-111111111111', '1.0.0');
  exception when others then
    failed := true;  -- RLS WITH CHECK violation (expected)
  end;
  perform pg_temp.act_as_super();
  if not failed then
    raise exception 'CASE 2c FAILED (8.5): pilot B inserted a mission owned by pilot A';
  end if;
end;
$$;

-- =========================================================================
-- CASE 3 (req 8.4 companion to 8.3/8.5): an ADMIN role CAN mutate another
--   pilot's mission (explicit broader scope). Confirms the deny in Case 2 is due
--   to lack of authority, not a blanket lock. Uses the user_role JWT claim.
-- =========================================================================
do $$
declare n integer;
begin
  perform pg_temp.act_as('33333333-3333-3333-3333-333333333333', 'ADMIN');
  update missions
     set clinical_summary = 'admin-edit-ok'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'CASE 3 FAILED (8.4): admin update affected % rows, expected 1', n;
  end if;
  perform pg_temp.act_as_super();
end;
$$;

-- Reset the mission's summary so downstream ordering is deterministic.
update missions set clinical_summary = 'owner-edit-ok'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- =========================================================================
-- CASE 4 (req 8.6): anon (public) SELECT returns NOTHING from private tables:
--   missions, clinical_snapshots, virs_reports. Even though fixtures exist.
-- =========================================================================
do $$
declare c_missions integer; c_clin integer; c_virs integer;
begin
  perform pg_temp.act_as_anon();
  select count(*) into c_missions   from missions;
  select count(*) into c_clin       from clinical_snapshots;
  select count(*) into c_virs       from virs_reports;
  perform pg_temp.act_as_super();

  if c_missions <> 0 then
    raise exception 'CASE 4 FAILED (8.6): anon saw % missions rows, expected 0', c_missions;
  end if;
  if c_clin <> 0 then
    raise exception 'CASE 4 FAILED (8.6): anon saw % clinical_snapshots rows, expected 0', c_clin;
  end if;
  if c_virs <> 0 then
    raise exception 'CASE 4 FAILED (8.6): anon saw % virs_reports rows, expected 0', c_virs;
  end if;
end;
$$;

-- =========================================================================
-- CASE 4b (req 8.6 / 8.7): anon CAN read the public reference tables
--   (hems_bases, hospitals). These carry no private data and back public routes.
-- =========================================================================
do $$
declare c_bases integer; c_hosp integer;
begin
  perform pg_temp.act_as_anon();
  select count(*) into c_bases from hems_bases;
  select count(*) into c_hosp  from hospitals;
  perform pg_temp.act_as_super();

  if c_bases < 1 then
    raise exception 'CASE 4b FAILED (8.6/8.7): anon saw % hems_bases rows, expected >= 1', c_bases;
  end if;
  if c_hosp < 1 then
    raise exception 'CASE 4b FAILED (8.6/8.7): anon saw % hospitals rows, expected >= 1', c_hosp;
  end if;
end;
$$;

-- =========================================================================
-- CASE 4c (req 8.6): anon cannot mutate reference data either (write is
--   ADMIN-scoped). A no-op/blocked insert must not add a public base.
-- =========================================================================
do $$
declare failed boolean := false; before_n integer; after_n integer;
begin
  perform pg_temp.act_as_super();
  select count(*) into before_n from hems_bases;

  perform pg_temp.act_as_anon();
  begin
    insert into hems_bases (provider, faa_id, facility_name, elevation_ft,
                            coordinates, airframe_type, tail_number)
    values ('ROGUE', 'ZZZZ', 'Rogue Base', 100.0,
            st_setsrid(st_makepoint(-80, 40), 4326)::geography, 'EC135', 'N000XX');
  exception when others then
    failed := true;  -- blocked by RLS/GRANT (expected)
  end;
  perform pg_temp.act_as_super();

  select count(*) into after_n from hems_bases;
  if after_n <> before_n then
    raise exception 'CASE 4c FAILED (8.6): anon inserted into hems_bases (% -> %)', before_n, after_n;
  end if;
end;
$$;

-- =========================================================================
-- CASE 5 (req 8.6 / 11.3): a non-owning, non-safety pilot cannot read another
--   pilot's VIRS narrative; the safety reviewer / admin scope can.
-- =========================================================================
do $$
declare c_as_b integer; c_as_safety integer;
begin
  -- Pilot B (not the reporter, no safety scope) sees the VIRS report as invisible.
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
  select count(*) into c_as_b from virs_reports
   where id = 'dddddddd-0000-0000-0000-000000000001';
  perform pg_temp.act_as_super();
  if c_as_b <> 0 then
    raise exception 'CASE 5 FAILED (8.6/11.3): non-safety pilot B saw % VIRS rows, expected 0', c_as_b;
  end if;

  -- A SAFETY_REVIEWER can retrieve it.
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222', 'SAFETY_REVIEWER');
  select count(*) into c_as_safety from virs_reports
   where id = 'dddddddd-0000-0000-0000-000000000001';
  perform pg_temp.act_as_super();
  if c_as_safety <> 1 then
    raise exception 'CASE 5 FAILED (11.3): safety reviewer saw % VIRS rows, expected 1', c_as_safety;
  end if;
end;
$$;

-- =========================================================================
-- CASE 6 (req 8.3/8.4/8.5) — RLS ROLE MATRIX (task 19.2 end-to-end coverage).
--   The role matrix is enforced in Postgres (this is where RLS lives), so the
--   19.2 role-matrix coverage extends this SQL harness rather than being modeled
--   in TypeScript. Cases 1–5 already exercised PILOT-owner, PILOT-intruder,
--   ADMIN, anon, and SAFETY_REVIEWER against a mission / private tables. This
--   case fills the remaining operational-scope slice: the DISPATCHER role, whose
--   `has_dispatch_scope()` grants broader mission mutate access (req 8.4) — the
--   same broadening that Case 2's PILOT lacked (req 8.5).
--
--   Matrix asserted for a mission owned by Pilot A:
--     role            | cross-owner mission UPDATE | expected rows
--     ----------------+----------------------------+--------------
--     PILOT  (pilot B) | denied (no scope)          | 0   (Case 2)
--     DISPATCHER       | permitted (dispatch scope) | 1   (this case)
--     ADMIN            | permitted (admin scope)    | 1   (Case 3)
-- =========================================================================

-- 6a: a DISPATCHER (broader operational scope) CAN update another pilot's
--     mission — confirms the 8.4 broadening applies to the dispatch role, not
--     only ADMIN. Pilot B's id carries an explicit DISPATCHER role claim.
do $$
declare n integer;
begin
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222', 'DISPATCHER');
  update missions
     set clinical_summary = 'dispatcher-edit-ok'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'CASE 6a FAILED (8.4): dispatcher update affected % rows, expected 1', n;
  end if;
  perform pg_temp.act_as_super();
end;
$$;

-- 6b: the SAME identity WITHOUT the dispatch-scope role (plain PILOT) is denied
--     the same cross-owner update — proving the allow in 6a is due to the role
--     claim, not the identity (req 8.5). 0 rows, target left unchanged.
do $$
declare n integer; v text;
begin
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');  -- no role claim => PILOT
  update missions
     set clinical_summary = 'pilot-no-scope-edit'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'CASE 6b FAILED (8.5): unscoped pilot update affected % rows, expected 0', n;
  end if;
  perform pg_temp.act_as_super();

  -- The target still carries the dispatcher's edit from 6a — unchanged by 6b.
  select clinical_summary into v from missions
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v is distinct from 'dispatcher-edit-ok' then
    raise exception 'CASE 6b VERIFY FAILED (8.5): target changed to %, expected dispatcher-edit-ok', v;
  end if;
end;
$$;

-- 6c: a DISPATCHER (dispatch scope, NOT clinical/safety scope) still CANNOT read
--     private VIRS narratives — role broadening is scoped per table, so dispatch
--     scope does not leak into safety-scoped data (req 8.4 "limited to the record
--     scope defined for that role", req 8.6).
do $$
declare c integer;
begin
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222', 'DISPATCHER');
  select count(*) into c from virs_reports
   where id = 'dddddddd-0000-0000-0000-000000000001';
  perform pg_temp.act_as_super();
  if c <> 0 then
    raise exception 'CASE 6c FAILED (8.4/8.6): dispatcher saw % VIRS rows, expected 0 (scope is per-table)', c;
  end if;
end;
$$;

-- Reset the mission summary so downstream scripts see a deterministic value.
update missions set clinical_summary = 'owner-edit-ok'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- =========================================================================
-- All assertions passed if we reach here.
-- =========================================================================
do $$
begin
  raise notice '================================================';
  raise notice 'RLS INTEGRATION TESTS PASSED (req 8.3, 8.4, 8.5, 8.6)';
  raise notice '================================================';
end;
$$;

rollback;  -- leave the database pristine for any following test script.
