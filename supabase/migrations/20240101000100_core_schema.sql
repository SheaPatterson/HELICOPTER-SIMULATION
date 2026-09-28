-- Virtual HEMS — Core relational schema
-- Design Section 5.1 (Core relational entities), Section 5.2 (Spatial and temporal rules).
-- Requirements: 1.7 (source vs cloud-receive timestamps recorded separately),
--               5.6 (schema supports the authorization/ownership model).
--
-- Conventions (design 5.2):
--   * Geographic points are PostGIS GEOGRAPHY(POINT, 4326).
--   * All timestamps are timestamptz (stored/compared in UTC).
--   * Source/observed timestamps are kept separate from cloud-receive timestamps.
--   * Explicit schema_version columns record the governing @virtualhems/contracts version.
--   * Column names align with the shared telemetry/mission/clinical contracts.
--
-- RLS policies (task 2.2), idempotency uniqueness, and seed data (task 2.3) are
-- authored in later migrations; this migration establishes structure only.

-- =====================================================================
-- profiles: authenticated pilot identity (design 5.1)
-- Row ownership keys off the Supabase Auth user id for the RLS model (req 5.6).
-- =====================================================================
create table profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  callsign       text not null unique,
  role           text not null default 'PILOT',
  full_name      text,
  hems_credential_ref text,
  flight_hours   numeric(10, 1) not null default 0 check (flight_hours >= 0),
  dispatch_count integer not null default 0 check (dispatch_count >= 0),
  home_base_id   uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- =====================================================================
-- hems_bases: provider base + airframe (design 5.1)
-- =====================================================================
create table hems_bases (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null,
  faa_id         text not null,
  facility_name  text not null,
  elevation_ft   numeric(8, 1) not null,
  coordinates    geography(point, 4326) not null,
  airframe_type  text not null,
  tail_number    text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (faa_id, tail_number)
);

-- profiles.home_base_id references a base; added after hems_bases exists.
alter table profiles
  add constraint profiles_home_base_id_fkey
  foreign key (home_base_id) references hems_bases (id) on delete set null;

-- =====================================================================
-- hospitals: receiving facility + helipad (design 5.1)
-- =====================================================================
create table hospitals (
  id                 uuid primary key default gen_random_uuid(),
  facility_name      text not null,
  faa_id             text,
  city               text,
  state              text,
  elevation_ft       numeric(8, 1),
  coordinates        geography(point, 4326) not null,
  helipad_surface    helipad_surface,
  helipad_placement  helipad_placement,
  helipad_dimensions_ft text,
  helipad_elevation_ft numeric(8, 1),
  trauma_capability  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- =====================================================================
-- medical_conditions: deterioration/condition matrix (design 5.1)
-- =====================================================================
create table medical_conditions (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  category              medical_condition_category not null,
  icd_code              text,
  baseline_gcs_min      smallint not null check (baseline_gcs_min between 3 and 15),
  baseline_gcs_max      smallint not null check (baseline_gcs_max between 3 and 15),
  requires_rsi          boolean not null default false,
  decay_rate_per_minute numeric(8, 4) not null default 0 check (decay_rate_per_minute >= 0),
  target_facility_type  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (baseline_gcs_min <= baseline_gcs_max)
);

-- =====================================================================
-- missions: dispatch package + lifecycle (design 5.1)
-- pilot_id is the ownership key for the RLS model (req 5.6).
-- =====================================================================
create table missions (
  id                     uuid primary key default gen_random_uuid(),
  mission_code           text not null unique,
  mission_type           mission_type not null,
  status                 mission_status not null default 'DISPATCHED',
  priority               patient_priority,
  pilot_id               uuid not null references profiles (id) on delete restrict,
  assigned_base_id       uuid references hems_bases (id) on delete restrict,
  origin_hospital_id     uuid references hospitals (id) on delete restrict,
  destination_hospital_id uuid references hospitals (id) on delete restrict,
  scene_coordinates      geography(point, 4326),
  -- Simulated patient fields (contracts: PatientInput).
  simulated_patient_id   uuid,
  patient_age_years      smallint check (patient_age_years is null or patient_age_years >= 0),
  patient_gender         text,
  patient_weight_lbs     numeric(6, 1) check (patient_weight_lbs is null or patient_weight_lbs > 0),
  condition_id           uuid references medical_conditions (id) on delete restrict,
  baseline_gcs           smallint check (baseline_gcs is null or baseline_gcs between 3 and 15),
  clinical_summary       text,
  interventions          text,
  authorization_code     text,
  -- Lifecycle timestamps (UTC).
  dispatched_at          timestamptz,
  en_route_scene_at      timestamptz,
  on_scene_at            timestamptz,
  en_route_hospital_at   timestamptz,
  completed_at           timestamptz,
  aborted_at             timestamptz,
  schema_version         text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (origin_hospital_id is null
         or destination_hospital_id is null
         or origin_hospital_id <> destination_hospital_id)
);

-- =====================================================================
-- flight_telemetry: persisted normalized frames (design 5.1, contracts: TelemetryFrame)
-- Timestamp separation (design 5.2, req 1.7):
--   source_observed_at -> when the simulator produced the sample (observed_at)
--   received_at        -> when the cloud accepted/persisted the frame
-- =====================================================================
create table flight_telemetry (
  frame_id            uuid primary key default gen_random_uuid(),
  mission_id          uuid references missions (id) on delete cascade,
  pilot_id            uuid not null references profiles (id) on delete cascade,
  session_id          uuid not null,
  source_engine       simulator_engine not null,
  source_sequence     bigint not null check (source_sequence >= 0),
  sequence_number     bigint not null check (sequence_number >= 0),
  -- Position vector (contracts: PositionVector).
  latitude_deg        double precision not null check (latitude_deg between -90 and 90),
  longitude_deg       double precision not null check (longitude_deg between -180 and 180),
  altitude_msl_ft     double precision not null,
  altitude_agl_ft     double precision not null,
  -- Flight vector (contracts: FlightVector).
  ground_speed_kts    double precision not null,
  heading_deg         double precision not null check (heading_deg >= 0 and heading_deg < 360),
  vertical_speed_fpm  double precision not null,
  pitch_deg           double precision not null,
  roll_deg            double precision not null,
  -- Systems vector (contracts: SystemsVector).
  fuel_remaining_lbs  double precision not null,
  engine_torque_pct   double precision not null,
  tot_celsius         double precision,
  rotor_rpm_pct       double precision,
  outside_air_temp_c  double precision,
  -- Derived geography point for spatial audit/proximity checks.
  position            geography(point, 4326) not null,
  is_delta            boolean not null default false,
  -- Temporal separation (design 5.2, req 1.7): source/observed vs cloud-receive.
  source_observed_at  timestamptz not null,
  received_at         timestamptz not null default now(),
  schema_version      text not null
);

-- =====================================================================
-- mission_events: append-only lifecycle/checklist/comms/authorization (design 5.1)
-- =====================================================================
create table mission_events (
  id            uuid primary key default gen_random_uuid(),
  mission_id    uuid not null references missions (id) on delete cascade,
  pilot_id      uuid references profiles (id) on delete set null,
  event_type    clinical_event_type not null,
  source        clinical_event_source not null,
  metadata      jsonb not null default '{}'::jsonb,
  -- Temporal separation (design 5.2, req 1.7).
  occurred_at   timestamptz not null,
  received_at   timestamptz not null default now(),
  schema_version text not null
);

-- =====================================================================
-- clinical_snapshots: derived patient state at event/cadence (design 5.1, contracts: PatientState)
-- =====================================================================
create table clinical_snapshots (
  id                          uuid primary key default gen_random_uuid(),
  mission_id                  uuid not null references missions (id) on delete cascade,
  mission_event_id            uuid references mission_events (id) on delete set null,
  baseline_gcs                smallint not null check (baseline_gcs between 3 and 15),
  current_gcs                 smallint not null check (current_gcs between 3 and 15),
  elapsed_golden_hour_seconds integer not null default 0 check (elapsed_golden_hour_seconds >= 0),
  elapsed_scene_seconds       integer not null default 0 check (elapsed_scene_seconds >= 0),
  physiological_flags         jsonb not null default '[]'::jsonb,
  deteriorated                boolean not null default false,
  -- Temporal separation (design 5.2, req 1.7): when state applied vs stored.
  observed_at                 timestamptz not null,
  received_at                 timestamptz not null default now(),
  schema_version              text not null
);

-- =====================================================================
-- tactical_briefings: generated recommendations + provenance/override (design 5.1)
-- =====================================================================
create table tactical_briefings (
  id                    uuid primary key default gen_random_uuid(),
  mission_id            uuid not null references missions (id) on delete cascade,
  recommended_facility_id uuid references hospitals (id) on delete set null,
  recommended_lz        geography(point, 4326),
  warnings              jsonb not null default '[]'::jsonb,
  assumptions           jsonb not null default '[]'::jsonb,
  input_snapshot_hash   text not null,
  provenance            text not null,
  -- Reviewer/override metadata.
  reviewed_by           uuid references profiles (id) on delete set null,
  reviewed_at           timestamptz,
  overridden            boolean not null default false,
  override_reason       text,
  -- Temporal separation (design 5.2, req 1.7).
  generated_at          timestamptz not null,
  received_at           timestamptz not null default now(),
  schema_version        text not null
);

-- =====================================================================
-- aar_reports: immutable versioned after-action report (design 5.1, contracts: AARReport)
-- =====================================================================
create table aar_reports (
  id                       uuid primary key default gen_random_uuid(),
  mission_id               uuid not null references missions (id) on delete cascade,
  version                  integer not null default 1 check (version >= 1),
  telemetry_coverage       numeric(5, 4) not null check (telemetry_coverage between 0 and 1),
  route_efficiency_percent numeric(6, 2) not null,
  max_pitch_deg            numeric(6, 2) not null,
  max_roll_deg             numeric(6, 2) not null,
  touchdown_g_force        numeric(6, 2),
  reserve_fuel_minutes     numeric(6, 1) not null,
  scene_time_minutes       numeric(6, 1) not null,
  clinical_outcome_summary text not null,
  compliance_findings      jsonb not null default '[]'::jsonb,
  score                    numeric(6, 2) not null,
  -- Temporal separation (design 5.2, req 1.7).
  generated_at             timestamptz not null,
  received_at              timestamptz not null default now(),
  schema_version           text not null,
  unique (mission_id, version)
);

-- =====================================================================
-- virs_reports: non-punitive incident reports w/ access control + redaction (design 5.1)
-- =====================================================================
create table virs_reports (
  id                 uuid primary key default gen_random_uuid(),
  reporter_id        uuid references profiles (id) on delete set null,
  mission_id         uuid references missions (id) on delete set null,
  incident_category  text not null,
  narrative          text not null check (char_length(narrative) between 1 and 10000),
  is_redacted        boolean not null default false,
  redacted_at        timestamptz,
  redacted_by        uuid references profiles (id) on delete set null,
  -- access_control attribute constrains retrieval to authorized safety-reviewer role.
  access_control     text not null default 'SAFETY_REVIEWER',
  -- Temporal separation (design 5.2, req 1.7).
  submitted_at       timestamptz not null,
  received_at        timestamptz not null default now(),
  schema_version     text not null
);

-- =====================================================================
-- audit_log: actor/action/target trail (design 5.1)
-- =====================================================================
create table audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid references profiles (id) on delete set null,
  action         text not null,
  target_type    text not null,
  target_id      uuid,
  correlation_id uuid,
  before_state   jsonb,
  after_state    jsonb,
  -- Temporal separation (design 5.2, req 1.7).
  occurred_at    timestamptz not null,
  received_at    timestamptz not null default now(),
  schema_version text not null
);

-- =====================================================================
-- Spatial indexes (design 5.2): GIST on base/hospital/scene geometry.
-- =====================================================================
create index hems_bases_coordinates_gist on hems_bases using gist (coordinates);
create index hospitals_coordinates_gist on hospitals using gist (coordinates);
create index missions_scene_coordinates_gist on missions using gist (scene_coordinates);
create index flight_telemetry_position_gist on flight_telemetry using gist (position);
create index tactical_briefings_recommended_lz_gist on tactical_briefings using gist (recommended_lz);

-- =====================================================================
-- Telemetry access index (design 5.2): by mission and descending timestamp.
-- =====================================================================
create index flight_telemetry_mission_observed_at_desc_idx
  on flight_telemetry (mission_id, source_observed_at desc);

-- Supporting foreign-key / lookup indexes for common joins.
create index missions_pilot_id_idx on missions (pilot_id);
create index flight_telemetry_pilot_id_idx on flight_telemetry (pilot_id);
create index flight_telemetry_session_id_idx on flight_telemetry (session_id);
create index mission_events_mission_id_occurred_at_idx on mission_events (mission_id, occurred_at desc);
create index clinical_snapshots_mission_id_observed_at_idx on clinical_snapshots (mission_id, observed_at desc);
create index tactical_briefings_mission_id_idx on tactical_briefings (mission_id);
create index aar_reports_mission_id_idx on aar_reports (mission_id);
create index virs_reports_reporter_id_idx on virs_reports (reporter_id);
create index audit_log_target_idx on audit_log (target_type, target_id);
create index audit_log_correlation_id_idx on audit_log (correlation_id);
