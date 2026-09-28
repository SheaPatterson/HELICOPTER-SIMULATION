-- Virtual HEMS — Extensions and domain enum types
-- Design Section 5.1 (Core relational entities), Section 5.2 (Spatial/temporal rules).
--
-- Enum values are kept 1:1 with the shared contract package (@virtualhems/contracts):
--   SIMULATOR_ENGINES            -> packages/contracts/src/telemetry.ts
--   MISSION_TYPES / MISSION_STATUSES / PATIENT_PRIORITIES / PAVE_DISPOSITIONS
--                                -> packages/contracts/src/mission.ts
--   MEDICAL_CONDITION_CATEGORIES / CLINICAL_EVENT_TYPES / CLINICAL_EVENT_SOURCES
--                                -> packages/contracts/src/clinical.ts
--   HELIPAD_SURFACES / HELIPAD_PLACEMENTS
--                                -> packages/contracts/src/infrastructure.ts
-- Keep these in sync when the contracts change.

-- PostGIS provides GEOGRAPHY(POINT, 4326) and GIST spatial indexing (design 5.2).
create extension if not exists postgis;
-- pgcrypto supplies gen_random_uuid() for primary keys.
create extension if not exists pgcrypto;

-- Simulator engines (contracts: SIMULATOR_ENGINES).
create type simulator_engine as enum (
  'MSFS2020',
  'MSFS2024',
  'XPLANE11',
  'XPLANE12'
);

-- Mission classification (contracts: MISSION_TYPES).
create type mission_type as enum (
  'SCENE_CALL',
  'INTER_FACILITY_TRANSFER'
);

-- Mission lifecycle status (contracts: MISSION_STATUSES).
create type mission_status as enum (
  'DISPATCHED',
  'EN_ROUTE_SCENE',
  'ON_SCENE',
  'EN_ROUTE_HOSPITAL',
  'COMPLETED',
  'ABORTED'
);

-- Patient triage priority (contracts: PATIENT_PRIORITIES).
create type patient_priority as enum (
  'PRIORITY_1',
  'PRIORITY_2',
  'PRIORITY_3'
);

-- PAVE risk disposition (contracts: PAVE_DISPOSITIONS).
create type pave_disposition as enum (
  'GO',
  'CONDITIONAL',
  'NO_GO'
);

-- Medical condition category (contracts: MEDICAL_CONDITION_CATEGORIES).
create type medical_condition_category as enum (
  'TRAUMA',
  'CARDIAC',
  'STROKE',
  'NEURO',
  'OB',
  'PEDIATRIC',
  'ENVIRONMENTAL',
  'OTHER'
);

-- Clinical/lifecycle event type (contracts: CLINICAL_EVENT_TYPES).
create type clinical_event_type as enum (
  'DISPATCHED',
  'ARRIVED_SCENE',
  'DEPARTED_SCENE',
  'INTERVENTION',
  'TOUCHDOWN',
  'ABORTED'
);

-- Origin of a recorded clinical/lifecycle event (contracts: CLINICAL_EVENT_SOURCES).
create type clinical_event_source as enum (
  'USER',
  'TELEMETRY',
  'SYSTEM'
);

-- Helipad surface material (contracts: HELIPAD_SURFACES).
create type helipad_surface as enum (
  'CONCRETE',
  'ASPHALT',
  'MAT',
  'OTHER'
);

-- Helipad placement (contracts: HELIPAD_PLACEMENTS).
create type helipad_placement as enum (
  'ROOFTOP',
  'GROUND'
);
