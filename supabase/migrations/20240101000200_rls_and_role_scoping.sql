-- Virtual HEMS — Row Level Security, operational-role scoping, and telemetry idempotency
-- Design Section 5.3 (Authorization model), Section 9 (Security/Privacy).
-- Requirements:
--   8.3 — RLS: a pilot may create/update/delete ONLY records whose owner id equals
--         that pilot's id, for that pilot's profile and telemetry records.
--   8.4 — Explicitly authorized operational roles may mutate records beyond their own
--         profile/telemetry, limited to the record scope defined for that role.
--   8.5 — A pilot mutating a record they do not own, holding no authorized role, is
--         rejected and the target row is left unchanged (enforced by the ownership
--         predicate + default-deny RLS; no matching policy => mutation blocked).
--   8.6 — Patient, clinical, and VIRS records are never returned on public
--         (unauthenticated / `anon`) routes.
--   2.7 — Idempotency uniqueness on (pilot_id, session_id, sequence_number) for
--         telemetry; a duplicate frame is treated as idempotent (no duplicate row).
--
-- Model notes:
--   * Identity is established by Supabase Auth. `auth.uid()` is the authenticated
--     user's id, which equals `profiles.id` (the ownership key for the pilot model).
--   * The acting role is resolved explicitly (role expansion must be explicit, design
--     5.3). We honor an optional `user_role` JWT claim (Supabase convention: custom
--     claims travel in the access token) and otherwise fall back to `profiles.role`.
--     Operational roles: DISPATCHER, INSTRUCTOR, ADMIN, SAFETY_REVIEWER. Default PILOT.
--   * RLS is default-deny: with RLS enabled and no permissive policy matching, a
--     statement affects zero rows / is rejected. The `anon` role therefore has no
--     access to any table unless a policy explicitly grants it, satisfying 8.6.
--   * `service_role` bypasses RLS by design (Supabase); server-side service-role
--     operations remain narrowly scoped and audited at the application layer (8.12,
--     req 8.10). No policy is required for it here.

-- =====================================================================
-- 0. Idempotency uniqueness for telemetry (req 2.7).
--    (pilot_id, session_id, sequence_number) uniquely identifies a frame; a replayed
--    duplicate collides on this constraint and is treated as idempotent by the
--    ingestion service rather than inserted twice.
-- =====================================================================
alter table flight_telemetry
  add constraint flight_telemetry_pilot_session_sequence_key
  unique (pilot_id, session_id, sequence_number);

-- =====================================================================
-- 1. Authorization helper functions (private `hems` schema).
--    SECURITY DEFINER + stable so RLS predicates can call them without recursing
--    through profiles' own RLS, and so they are cheap to evaluate per-row.
-- =====================================================================
create schema if not exists hems;

-- The acting user's id (owner key). Null when unauthenticated (anon).
-- SECURITY DEFINER so the predicate can resolve identity without requiring every
-- caller role to hold direct privileges on the auth schema.
create or replace function hems.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = auth, pg_temp
as $$
  select auth.uid();
$$;

-- The acting operational role, resolved explicitly.
--   1) Prefer an explicit `user_role` claim in the verified JWT, when present.
--   2) Otherwise look up profiles.role for the authenticated user.
--   3) Default to 'PILOT' for any authenticated user without a resolvable role.
--   Returns NULL for unauthenticated callers (anon), which grants no role scope.
create or replace function hems.current_role_name()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  claim_role text;
  profile_role text;
begin
  if uid is null then
    return null;  -- anon: no operational role
  end if;

  -- Supabase custom claims are carried on the JWT; treat a `user_role` claim as
  -- an explicit, authoritative role assignment when it is a known role.
  begin
    claim_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'user_role';
  exception when others then
    claim_role := null;
  end;

  if claim_role in ('PILOT', 'DISPATCHER', 'INSTRUCTOR', 'ADMIN', 'SAFETY_REVIEWER') then
    return claim_role;
  end if;

  select role into profile_role from public.profiles where id = uid;
  return coalesce(profile_role, 'PILOT');
end;
$$;

-- Convenience predicates for the explicit operational-role scopes (req 8.4).
--   * Dispatch scope  : DISPATCHER, INSTRUCTOR, ADMIN  — operational mission data.
--   * Clinical scope  : INSTRUCTOR, ADMIN              — clinical/patient-derived data.
--   * Safety scope    : SAFETY_REVIEWER, ADMIN         — VIRS narratives.
--   * Admin scope     : ADMIN                          — full operational administration.
create or replace function hems.has_dispatch_scope()
returns boolean language sql stable as $$
  select hems.current_role_name() in ('DISPATCHER', 'INSTRUCTOR', 'ADMIN');
$$;

create or replace function hems.has_clinical_scope()
returns boolean language sql stable as $$
  select hems.current_role_name() in ('INSTRUCTOR', 'ADMIN');
$$;

create or replace function hems.has_safety_scope()
returns boolean language sql stable as $$
  select hems.current_role_name() in ('SAFETY_REVIEWER', 'ADMIN');
$$;

create or replace function hems.is_admin()
returns boolean language sql stable as $$
  select hems.current_role_name() = 'ADMIN';
$$;

-- =====================================================================
-- 2. Enable RLS on every table. Default-deny: `anon` and any role without a
--    matching permissive policy gets no rows. This is the backbone of 8.5 and 8.6.
-- =====================================================================
alter table profiles            enable row level security;
alter table hems_bases          enable row level security;
alter table hospitals           enable row level security;
alter table medical_conditions  enable row level security;
alter table missions            enable row level security;
alter table flight_telemetry    enable row level security;
alter table mission_events      enable row level security;
alter table clinical_snapshots  enable row level security;
alter table tactical_briefings  enable row level security;
alter table aar_reports         enable row level security;
alter table virs_reports        enable row level security;
alter table audit_log           enable row level security;

-- =====================================================================
-- 3. profiles — pilot self-ownership + operational read/admin scope (req 8.3/8.4/8.5).
--    Owner id = profiles.id = auth.uid().
-- =====================================================================
-- Read: own profile always; dispatch/clinical/admin roles may read all profiles
-- (broader operational visibility, design 5.3).
create policy profiles_select on profiles
  for select to authenticated
  using (id = hems.current_user_id() or hems.has_dispatch_scope());

-- Insert: a user may create only their own profile row (id must equal auth.uid()).
create policy profiles_insert on profiles
  for insert to authenticated
  with check (id = hems.current_user_id());

-- Update: a pilot may update only their own profile; ADMIN may update any profile
-- (explicit broader scope, e.g. role assignment). USING gates which rows are
-- visible to update; WITH CHECK prevents re-pointing the row to another owner.
create policy profiles_update on profiles
  for update to authenticated
  using (id = hems.current_user_id() or hems.is_admin())
  with check (id = hems.current_user_id() or hems.is_admin());

-- Delete: a pilot may delete only their own profile; ADMIN may delete any.
create policy profiles_delete on profiles
  for delete to authenticated
  using (id = hems.current_user_id() or hems.is_admin());

-- =====================================================================
-- 4. flight_telemetry — pilot owns rows where pilot_id = auth.uid() (req 8.3/8.5).
--    Telemetry carries no patient/clinical content, so it is not a "private
--    clinical" table for 8.6, but it is still owner-scoped and never anon-readable.
-- =====================================================================
create policy flight_telemetry_select on flight_telemetry
  for select to authenticated
  using (pilot_id = hems.current_user_id() or hems.has_dispatch_scope());

create policy flight_telemetry_insert on flight_telemetry
  for insert to authenticated
  with check (pilot_id = hems.current_user_id() or hems.has_dispatch_scope());

create policy flight_telemetry_update on flight_telemetry
  for update to authenticated
  using (pilot_id = hems.current_user_id() or hems.has_dispatch_scope())
  with check (pilot_id = hems.current_user_id() or hems.has_dispatch_scope());

create policy flight_telemetry_delete on flight_telemetry
  for delete to authenticated
  using (pilot_id = hems.current_user_id() or hems.is_admin());

-- =====================================================================
-- 5. missions — owned by pilot_id; DISPATCHER/INSTRUCTOR/ADMIN have broader
--    operational mutate scope (req 8.4). Missions carry simulated-patient fields,
--    so they are private: authenticated-only, never `anon` (req 8.6).
-- =====================================================================
create policy missions_select on missions
  for select to authenticated
  using (pilot_id = hems.current_user_id() or hems.has_dispatch_scope());

create policy missions_insert on missions
  for insert to authenticated
  with check (pilot_id = hems.current_user_id() or hems.has_dispatch_scope());

create policy missions_update on missions
  for update to authenticated
  using (pilot_id = hems.current_user_id() or hems.has_dispatch_scope())
  with check (pilot_id = hems.current_user_id() or hems.has_dispatch_scope());

create policy missions_delete on missions
  for delete to authenticated
  using (pilot_id = hems.current_user_id() or hems.is_admin());

-- =====================================================================
-- 6. mission_events — scoped by the owning mission's pilot; dispatch scope broadens.
--    Ownership is derived through the parent mission (req 8.3/8.4/8.5).
-- =====================================================================
create policy mission_events_select on mission_events
  for select to authenticated
  using (
    hems.has_dispatch_scope()
    or exists (
      select 1 from missions m
      where m.id = mission_events.mission_id
        and m.pilot_id = hems.current_user_id()
    )
  );

create policy mission_events_insert on mission_events
  for insert to authenticated
  with check (
    hems.has_dispatch_scope()
    or exists (
      select 1 from missions m
      where m.id = mission_events.mission_id
        and m.pilot_id = hems.current_user_id()
    )
  );

create policy mission_events_update on mission_events
  for update to authenticated
  using (hems.has_dispatch_scope())
  with check (hems.has_dispatch_scope());

create policy mission_events_delete on mission_events
  for delete to authenticated
  using (hems.is_admin());

-- =====================================================================
-- 7. clinical_snapshots — PRIVATE clinical data (req 8.6). Authenticated only,
--    scoped to the owning mission's pilot or the clinical operational scope.
-- =====================================================================
create policy clinical_snapshots_select on clinical_snapshots
  for select to authenticated
  using (
    hems.has_clinical_scope()
    or exists (
      select 1 from missions m
      where m.id = clinical_snapshots.mission_id
        and m.pilot_id = hems.current_user_id()
    )
  );

-- Mutation of derived clinical state is an operational (clinical-scope) action;
-- pilots do not directly author clinical snapshots.
create policy clinical_snapshots_insert on clinical_snapshots
  for insert to authenticated
  with check (hems.has_clinical_scope());

create policy clinical_snapshots_update on clinical_snapshots
  for update to authenticated
  using (hems.has_clinical_scope())
  with check (hems.has_clinical_scope());

create policy clinical_snapshots_delete on clinical_snapshots
  for delete to authenticated
  using (hems.is_admin());

-- =====================================================================
-- 8. tactical_briefings — operational recommendation data. Authenticated only;
--    owning pilot may read, dispatch/clinical scope may read and mutate.
-- =====================================================================
create policy tactical_briefings_select on tactical_briefings
  for select to authenticated
  using (
    hems.has_dispatch_scope()
    or exists (
      select 1 from missions m
      where m.id = tactical_briefings.mission_id
        and m.pilot_id = hems.current_user_id()
    )
  );

create policy tactical_briefings_insert on tactical_briefings
  for insert to authenticated
  with check (hems.has_dispatch_scope());

create policy tactical_briefings_update on tactical_briefings
  for update to authenticated
  using (hems.has_dispatch_scope())
  with check (hems.has_dispatch_scope());

create policy tactical_briefings_delete on tactical_briefings
  for delete to authenticated
  using (hems.is_admin());

-- =====================================================================
-- 9. aar_reports — immutable after-action reports. Owning pilot may read theirs;
--    dispatch/clinical scope may read all. Reports are written server-side
--    (service_role, bypassing RLS) and are immutable (no update/delete policy =>
--    blocked for authenticated users).
-- =====================================================================
create policy aar_reports_select on aar_reports
  for select to authenticated
  using (
    hems.has_dispatch_scope()
    or exists (
      select 1 from missions m
      where m.id = aar_reports.mission_id
        and m.pilot_id = hems.current_user_id()
    )
  );

-- Allow authorized clinical/admin scope to author reports when not using service_role.
create policy aar_reports_insert on aar_reports
  for insert to authenticated
  with check (hems.has_clinical_scope());

-- No update/delete policies: aar_reports are immutable for all non-service roles.

-- =====================================================================
-- 10. virs_reports — non-punitive safety reports. PRIVATE (req 8.6). Narrative
--     retrieval is restricted to the safety-reviewer scope (req 11.3); a reporter
--     may create a report and read back their own submissions, but general
--     narrative retrieval is safety-scope only.
-- =====================================================================
create policy virs_reports_select on virs_reports
  for select to authenticated
  using (
    hems.has_safety_scope()
    or reporter_id = hems.current_user_id()
  );

-- Any authenticated user may file a report; the report is attributed to them.
create policy virs_reports_insert on virs_reports
  for insert to authenticated
  with check (
    reporter_id = hems.current_user_id() or reporter_id is null
  );

-- Only the safety scope may update (e.g. redaction workflow).
create policy virs_reports_update on virs_reports
  for update to authenticated
  using (hems.has_safety_scope())
  with check (hems.has_safety_scope());

create policy virs_reports_delete on virs_reports
  for delete to authenticated
  using (hems.is_admin());

-- =====================================================================
-- 11. audit_log — append-only trail. Only ADMIN may read; audit rows are written
--     server-side (service_role) alongside the audited action. No update/delete
--     policy => the log is immutable for non-service roles.
-- =====================================================================
create policy audit_log_select on audit_log
  for select to authenticated
  using (hems.is_admin());

-- =====================================================================
-- 12. Reference infrastructure and the clinical condition matrix.
--     hems_bases / hospitals / medical_conditions are non-private reference data:
--     they contain NO patient, clinical (patient-derived), or VIRS content, so they
--     may be exposed to public/aggregate surfaces. We grant read to both `anon` and
--     `authenticated`; mutation is restricted to the ADMIN operational scope.
--     (This satisfies 8.7's "aggregate/de-identified only" without leaking any
--     private record, and keeps 8.6 intact because no private table is anon-readable.)
-- =====================================================================
create policy hems_bases_select on hems_bases
  for select to anon, authenticated
  using (true);

create policy hems_bases_write on hems_bases
  for all to authenticated
  using (hems.is_admin())
  with check (hems.is_admin());

create policy hospitals_select on hospitals
  for select to anon, authenticated
  using (true);

create policy hospitals_write on hospitals
  for all to authenticated
  using (hems.is_admin())
  with check (hems.is_admin());

-- The condition matrix defines simulated clinical categories/thresholds but holds
-- no individual patient data; expose read to authenticated users, restrict mutate
-- to ADMIN. It is intentionally NOT granted to `anon` (kept out of public routes).
create policy medical_conditions_select on medical_conditions
  for select to authenticated
  using (true);

create policy medical_conditions_write on medical_conditions
  for all to authenticated
  using (hems.is_admin())
  with check (hems.is_admin());
