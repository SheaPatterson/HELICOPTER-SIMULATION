-- Virtual HEMS — Deterministic test fixtures for RLS + spatial integration tests
-- ---------------------------------------------------------------------------
-- Runs as the bootstrap superuser AFTER all four migrations. Creates two pilots
-- (each an auth.users row + a profiles row) plus one mission owned by pilot A.
-- These fixed UUIDs are referenced by the RLS assertions so ownership boundaries
-- are unambiguous.
--
-- IDs (stable across runs):
--   Pilot A : 11111111-1111-1111-1111-111111111111  (callsign LIFEFLIGHT-A, role PILOT)
--   Pilot B : 22222222-2222-2222-2222-222222222222  (callsign LIFEFLIGHT-B, role PILOT)
--   Admin   : 33333333-3333-3333-3333-333333333333  (callsign OPS-ADMIN,     role ADMIN)
--   Mission owned by A : aaaaaaaa-0000-0000-0000-000000000001

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pilot-a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'pilot-b@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'admin@example.test')
on conflict (id) do nothing;

insert into profiles (id, callsign, role, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'LIFEFLIGHT-A', 'PILOT', 'Pilot A'),
  ('22222222-2222-2222-2222-222222222222', 'LIFEFLIGHT-B', 'PILOT', 'Pilot B'),
  ('33333333-3333-3333-3333-333333333333', 'OPS-ADMIN',    'ADMIN', 'Ops Admin')
on conflict (id) do nothing;

-- One mission owned by Pilot A (used for cross-owner mutation checks, req 8.3/8.5).
insert into missions (id, mission_code, mission_type, status, pilot_id, schema_version)
values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'TEST-MISSION-A1',
  'SCENE_CALL',
  'DISPATCHED',
  '11111111-1111-1111-1111-111111111111',
  '1.0.0'
) on conflict (id) do nothing;

-- One clinical snapshot on Pilot A's mission (private clinical data, req 8.6).
insert into clinical_snapshots
  (id, mission_id, baseline_gcs, current_gcs, observed_at, schema_version)
values (
  'cccccccc-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  14, 13, now(), '1.0.0'
) on conflict (id) do nothing;

-- One VIRS report filed by Pilot A (private safety data, req 8.6/11.3).
insert into virs_reports
  (id, reporter_id, incident_category, narrative, submitted_at, schema_version)
values (
  'dddddddd-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'NEAR_MISS',
  'Simulation-only test narrative for RLS visibility assertions.',
  now(), '1.0.0'
) on conflict (id) do nothing;
