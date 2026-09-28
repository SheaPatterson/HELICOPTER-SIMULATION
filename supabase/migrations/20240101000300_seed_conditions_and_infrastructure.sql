-- Virtual HEMS — Regional infrastructure and clinical seed data
-- Design Section 5.1 (Core relational entities), Section 12 (Regional/clinical seed datasets),
-- and the project documentation (.kilo/docs/BLUEPRINT.md, Module 4).
--
-- Requirements:
--   4.8 — The medical condition matrix categorizes each condition as exactly one of the eight
--         categories (TRAUMA/CARDIAC/STROKE/NEURO/OB/PEDIATRIC/ENVIRONMENTAL/OTHER), maps each to
--         a baseline GCS range within 3–15, and maps each to exactly one required receiving-facility
--         capability (target_facility_type).
--   5.6 — Regional base/hospital/helipad geometry is stored as GEOGRAPHY(POINT, 4326) so the
--         Recommendation_Service can run indexed PostGIS proximity/radial/elevation queries
--         (GIST indexes are created in 20240101000100_core_schema.sql).
--
-- Modeled on the documented Western Pennsylvania / tri-state HEMS system (STAT MedEvac and
-- AHN LifeFlight), approved fleet EC135/EC145/H135/Bell 407. FAA identifiers and coordinates
-- match the fixtures referenced by the integration tests (e.g. Stat MedEvac 6 / KAXQ,
-- UPMC Presbyterian / PS78).
--
-- Idempotency: this migration is safe to re-run. hems_bases keys off its unique
-- (faa_id, tail_number) constraint; medical_conditions and hospitals (which have no natural
-- unique constraint in the schema) use guarded WHERE NOT EXISTS inserts on their business keys.

begin;

-- =====================================================================
-- medical_conditions (req 4.8)
-- Each row: exactly one category (enum), a valid GCS range within 3–15 with min <= max,
-- an RSI flag, a non-negative per-minute decay rate, and exactly one required
-- receiving-facility capability (target_facility_type).
-- Representative matrix spanning all eight categories.
-- =====================================================================
insert into medical_conditions
  (name, category, icd_code, baseline_gcs_min, baseline_gcs_max, requires_rsi, decay_rate_per_minute, target_facility_type)
select v.name, v.category::medical_condition_category, v.icd_code,
       v.baseline_gcs_min, v.baseline_gcs_max, v.requires_rsi, v.decay_rate_per_minute, v.target_facility_type
from (values
  -- TRAUMA
  ('Major Blunt Polytrauma',              'TRAUMA',        'T07',    6, 12, true,  0.15, 'TRAUMA_LEVEL_1'),
  ('Penetrating Chest/Abdominal Trauma',  'TRAUMA',        'S27.0',  7, 13, true,  0.18, 'TRAUMA_LEVEL_1'),
  ('Traumatic Amputation',                'TRAUMA',        'S48',    9, 14, false, 0.10, 'TRAUMA_LEVEL_1'),
  ('Severe Burn Injury',                  'TRAUMA',        'T31',    8, 14, true,  0.12, 'BURN_CENTER'),
  ('Isolated Long-Bone Fracture',         'TRAUMA',        'S72',   14, 15, false, 0.02, 'TRAUMA_LEVEL_2'),
  -- CARDIAC
  ('Acute STEMI',                         'CARDIAC',       'I21.3', 13, 15, false, 0.08, 'STEMI_CENTER'),
  ('Cardiogenic Shock',                   'CARDIAC',       'R57.0',  8, 13, true,  0.16, 'STEMI_CENTER'),
  ('Cardiac Arrest (ROSC)',               'CARDIAC',       'I46.9',  3,  8, true,  0.20, 'STEMI_CENTER'),
  ('Unstable Ventricular Tachycardia',    'CARDIAC',       'I47.2', 11, 15, false, 0.10, 'STEMI_CENTER'),
  -- STROKE
  ('Acute Ischemic Stroke (LVO)',         'STROKE',        'I63.9',  9, 14, false, 0.10, 'COMPREHENSIVE_STROKE_CENTER'),
  ('Intracerebral Hemorrhage',            'STROKE',        'I61.9',  6, 12, true,  0.16, 'COMPREHENSIVE_STROKE_CENTER'),
  ('Subarachnoid Hemorrhage',             'STROKE',        'I60.9',  7, 13, true,  0.14, 'COMPREHENSIVE_STROKE_CENTER'),
  -- NEURO
  ('Epidural Hematoma',                   'NEURO',         'S06.4',  5, 11, true,  0.18, 'NEUROSURGICAL_CENTER'),
  ('Severe Traumatic Brain Injury',       'NEURO',         'S06.9',  3,  8, true,  0.20, 'NEUROSURGICAL_CENTER'),
  ('Status Epilepticus',                  'NEURO',         'G41.9',  6, 12, true,  0.12, 'NEUROSURGICAL_CENTER'),
  -- OB
  ('Eclampsia',                           'OB',            'O15.9', 10, 14, false, 0.10, 'SPECIALTY_OB_CENTER'),
  ('Severe Placental Abruption',          'OB',            'O45.9', 11, 15, false, 0.12, 'SPECIALTY_OB_CENTER'),
  ('Postpartum Hemorrhage',               'OB',            'O72.1', 12, 15, false, 0.10, 'SPECIALTY_OB_CENTER'),
  -- PEDIATRIC
  ('Pediatric Major Trauma',              'PEDIATRIC',     'T07',    7, 13, true,  0.16, 'PEDIATRIC_TRAUMA_CENTER'),
  ('Pediatric Respiratory Failure',       'PEDIATRIC',     'J96.00', 8, 13, true,  0.14, 'PEDIATRIC_TRAUMA_CENTER'),
  ('Pediatric Febrile Seizure',           'PEDIATRIC',     'R56.00',12, 15, false, 0.04, 'PEDIATRIC_TRAUMA_CENTER'),
  -- ENVIRONMENTAL
  ('Severe Hypothermia',                  'ENVIRONMENTAL', 'T68',    6, 12, true,  0.10, 'TRAUMA_LEVEL_1'),
  ('Near-Drowning / Submersion',          'ENVIRONMENTAL', 'T75.1',  6, 12, true,  0.14, 'TRAUMA_LEVEL_1'),
  ('Heat Stroke',                         'ENVIRONMENTAL', 'T67.0',  8, 13, false, 0.10, 'TRAUMA_LEVEL_2'),
  -- OTHER
  ('Septic Shock',                        'OTHER',         'R65.21', 9, 13, false, 0.12, 'TRAUMA_LEVEL_2'),
  ('Anaphylaxis',                         'OTHER',         'T78.2', 11, 15, true,  0.10, 'TRAUMA_LEVEL_2'),
  ('Acute Respiratory Distress',          'OTHER',         'J80',    9, 14, true,  0.12, 'TRAUMA_LEVEL_2')
) as v(name, category, icd_code, baseline_gcs_min, baseline_gcs_max, requires_rsi, decay_rate_per_minute, target_facility_type)
where not exists (
  select 1 from medical_conditions mc where mc.name = v.name
);

-- =====================================================================
-- hems_bases (req 5.6)
-- STAT MedEvac and AHN LifeFlight regional base network. Coordinates are stored as
-- GEOGRAPHY(POINT, 4326) (lon, lat). Idempotent on unique (faa_id, tail_number).
-- =====================================================================
insert into hems_bases (provider, faa_id, facility_name, elevation_ft, coordinates, airframe_type, tail_number)
select v.provider, v.faa_id, v.facility_name, v.elevation_ft,
       st_setsrid(st_makepoint(v.lon, v.lat), 4326)::geography, v.airframe_type, v.tail_number
from (values
  ('STAT MedEvac',   '60PN', 'Washington Hospital',                1156.0, -80.2514, 40.1783, 'EC135',    'N527ME'),
  ('STAT MedEvac',   'PA28', 'Air Rescue East (Latrobe)',          1251.0, -79.4042, 40.2742, 'H135',     'N530ME'),
  ('STAT MedEvac',   'PA56', 'UPMC Passavant - Cranberry',         1100.0, -80.0972, 40.6837, 'H135',     'N536ME'),
  ('STAT MedEvac',   'KAGC', 'Allegheny County Airport (HQ)',      1251.0, -79.9302, 40.3544, 'EC145',    'N507ME'),
  ('STAT MedEvac',   'KVVS', 'Joseph A. Hardy Connellsville Apt',  1264.0, -79.6575, 39.9589, 'EC145',    'N307ME'),
  ('STAT MedEvac',   'KAXQ', 'Clarion County Airport',             1457.0, -79.4422, 41.2261, 'H135',     'N533ME'),
  ('STAT MedEvac',   'KLBE', 'Arnold Palmer Regional (Latrobe)',   1199.0, -79.4048, 40.2759, 'Bell 407', 'N540ME'),
  ('AHN LifeFlight', 'PA67', 'Canonsburg Hospital',                1169.0, -80.1910, 40.2470, 'EC135',    'N878LF'),
  ('AHN LifeFlight', '91PA', 'Clarion Hospital',                   1489.0, -79.3208, 41.1925, 'EC145',    'N131LF'),
  ('AHN LifeFlight', 'PN32', 'Indiana Regional Medical Center',    1285.0, -79.1568, 40.6301, 'EC145',    'N474LF'),
  ('AHN LifeFlight', 'KBTP', 'Pittsburgh/Butler Regional Airport', 1248.0, -79.9501, 40.7767, 'EC145',    'N373LF'),
  ('AHN LifeFlight', 'KFWQ', 'Rostraver Airport',                  1228.0, -79.8256, 40.2161, 'EC145',    'N575LF')
) as v(provider, faa_id, facility_name, elevation_ft, lon, lat, airframe_type, tail_number)
where not exists (
  select 1 from hems_bases b where b.faa_id = v.faa_id and b.tail_number = v.tail_number
);

-- =====================================================================
-- hospitals (req 5.6)
-- Western PA regional receiving facilities and helipads. Coordinates are stored as
-- GEOGRAPHY(POINT, 4326) (lon, lat). helipad_surface/helipad_placement use the schema enums.
-- Idempotent on the business key (faa_id, facility_name).
-- =====================================================================
insert into hospitals
  (facility_name, faa_id, city, state, elevation_ft, coordinates,
   helipad_surface, helipad_placement, helipad_dimensions_ft, helipad_elevation_ft, trauma_capability)
select v.facility_name, v.faa_id, v.city, v.state, v.elevation_ft,
       st_setsrid(st_makepoint(v.lon, v.lat), 4326)::geography,
       v.helipad_surface::helipad_surface, v.helipad_placement::helipad_placement,
       v.helipad_dimensions_ft, v.helipad_elevation_ft, v.trauma_capability
from (values
  ('UPMC Presbyterian',                    'PS78', 'PITTSBURGH', 'PA', 1124.0, -79.9600, 40.4423, 'CONCRETE', 'ROOFTOP', '96 X 48', 1180.0, 'TRAUMA_LEVEL_1'),
  ('UPMC Mercy',                           'PN23', 'PITTSBURGH', 'PA',  886.0, -79.9856, 40.4361, 'CONCRETE', 'ROOFTOP', '65 X 65',  950.0, 'BURN_CENTER'),
  ('UPMC Children''s Hospital of Pittsburgh','30PN','PITTSBURGH','PA', 1088.0, -79.9531, 40.4678, 'CONCRETE', 'ROOFTOP', '45 X 45', 1140.0, 'PEDIATRIC_TRAUMA_CENTER'),
  ('Allegheny General Hospital',           '42PN', 'PITTSBURGH', 'PA',  804.0, -80.0042, 40.4563, 'CONCRETE', 'ROOFTOP', '65 X 65',  870.0, 'COMPREHENSIVE_STROKE_CENTER'),
  ('UPMC Presbyterian STEMI Cath Hub',     'PS79', 'PITTSBURGH', 'PA', 1124.0, -79.9602, 40.4420, 'CONCRETE', 'ROOFTOP', '96 X 48', 1180.0, 'STEMI_CENTER'),
  ('UPMC Hamot',                           '0PS8', 'ERIE',       'PA',  900.0, -80.0853, 42.1358, 'CONCRETE', 'ROOFTOP', '60 X 65',  960.0, 'TRAUMA_LEVEL_2'),
  ('UPMC Altoona',                         '74PN', 'ALTOONA',    'PA', 1259.0, -78.4022, 40.5186, 'CONCRETE', 'ROOFTOP', '65 X 65', 1320.0, 'TRAUMA_LEVEL_2'),
  ('Penn Highlands DuBois',                'PA10', 'DUBOIS',     'PA', 1463.0, -78.7511, 41.1189, 'CONCRETE', 'GROUND',  '32 X 32', 1463.0, 'TRAUMA_LEVEL_2'),
  ('Butler Memorial Hospital',             'PA41', 'BUTLER',     'PA', 1190.0, -79.8925, 40.8672, 'ASPHALT',  'GROUND',  '65 X 65', 1190.0, 'ACUTE_CARE'),
  ('Clarion Hospital',                     '91PA', 'CLARION',    'PA', 1489.0, -79.3850, 41.1925, 'CONCRETE', 'GROUND',  '50 X 50', 1489.0, 'ACUTE_CARE'),
  ('West Penn Hospital',                   'WP01', 'PITTSBURGH', 'PA',  942.0, -79.9469, 40.4681, 'CONCRETE', 'ROOFTOP', '60 X 60', 1000.0, 'SPECIALTY_OB_CENTER')
) as v(facility_name, faa_id, city, state, elevation_ft, lon, lat,
       helipad_surface, helipad_placement, helipad_dimensions_ft, helipad_elevation_ft, trauma_capability)
where not exists (
  select 1 from hospitals h where h.faa_id = v.faa_id and h.facility_name = v.facility_name
);

commit;
