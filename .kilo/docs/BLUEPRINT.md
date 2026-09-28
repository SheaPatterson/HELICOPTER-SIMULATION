# **Virtual HEMS Complete System Architecture Blueprint (BLUEPRINT.md)**

**Document Designation:** BLUEPRINT-SPEC-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Exhaustive Monorepo Architecture, Data Models, Hardware Bridge Logic, Medical Deterioration Engines, and Implementation Pipelines for virtualhems.com

## **1\. Executive Summary & Monorepo Topology**

### **1.1 Architectural Vision**

This document outlines the master blueprint for **Virtual HEMS**, a specialized flight-following, medical simulation, and mission-coordination platform designed for Microsoft Flight Simulator (2020/2024) and X-Plane (11/12). The ecosystem replaces traditional, generic "Virtual Airline" frameworks with a data-linked "simulation-as-a-service" model. It synchronizes real-time simulator flight vectors with cloud-based dispatch logistics, dynamic medical deterioration engines, regional hospital networks across Western Pennsylvania and beyond, and automated performance auditing.  
`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                        VIRTUAL HEMS FULL-STACK ECOSYSTEM                                           |`  
`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                                                                                                       |`  
`|   FLIGHT SIMULATOR RUNTIME ENGINES                                                                                    |`  
`|   ┌───────────────────────────────────────────────┐     ┌──────────────────────────────────────────────────┐         |`  
`|   │ Microsoft Flight Simulator (2020 / 2024) [31] │     │ X-Plane (11 / 12) [28]                           │         |`  
`|   │ - SimConnect C++ API Wrapper [3, 12]          │     │ - FlyWithLua Telemetry Script Engine [3, 12]     │         |`  
`|   └───────────────────────┬───────────────────────┘     └────────────────────────┬─────────────────────────┘         |`  
`|                           │ Direct Shared Memory                                 │ Localhost UDP (Port 8080) [3, 12] |`  
`|                           ▼                                                      ▼                                   |`  
`|   LOCAL DESKTOP BRIDGE CLIENT (Tauri v2 / Rust & Electron Runtime) [3, 4, 12]                                         |`  
`|   ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ |`  
`|   │ - Thread-Safe Ring Buffer & Kinematic State Parser                                                             │ |`  
`|   │ - Adaptive Data Sampler (2 Hz to 10 Hz Telemetry Frame Rate)                                                  │ |`  
`|   │ - Local Failover Buffer (Offline SQLite Ring Buffer)                                                           │ |`  
`|   └──────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┘ |`  
`|                                                          │                                                           |`  
`|                                                          │ TLS Encrypted WebSockets (Port 443)                       |`  
`|                                                          ▼                                                           |`  
`|   CLOUD BACKEND & DATA ENGINE (Supabase / PostgreSQL 15+) [3, 4]                                                      |`  
`|   ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ |`  
`|   │ - Supabase Realtime Channels (Sub-second vector fanout) [3, 12]                                                │ |`  
`|   │ - PostGIS Geospatial Spatial Engine (Boundary Checks, Vector Routing)                                          │ |`  
`|   │ - Ironpine AI Tactical Dispatch & Integrity Engine [3]                                                         │ |`  
`|   │ - "Golden Hour" Clinical Decay Machine (260+ Condition Engine) [3, 12]                                         │ |`  
`|   └──────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┘ |`  
`|                                                          │                                                           |`  
`|                                                          │ Real-Time WebSocket & Server Action Uplink                |`  
`|                                                          ▼                                                           |`  
`|   WEB COMMAND TERMINAL & COCKPIT EFB (virtualhems.com) [3, 4, 12]                                                     |`  
`|   ┌───────────────────────────────────────────────┐     ┌──────────────────────────────────────────────────┐         |`  
`|   │ Live Operations Command Map [3, 12]           │     │ 4-Stage Mission Dispatcher & Cockpit EFB [3, 12] │         |`  
`|   │ - Real-Time Asset Tracking (OpenStreetMap) [3]│     │ - Live Patient Vitals Display [3, 12]            │         |`  
`|   │ - Base & Hospital Overlays [10, 24]           │     │ - Automated After-Action Review (AAR) Audit [3, 12]|`  
`|   └───────────────────────────────────────────────┘     └──────────────────────────────────────────────────┘         |`  
`+-----------------------------------------------------------------------------------------------------------------------+`

### **1.2 Monorepo Directory Layout**

The repository is structured as a Turborepo workspace, maintaining shared type safety across the client, bridge, database, and web layers:  
`virtualhems-monorepo/`  
`├── .github/`  
`│   └── workflows/`  
`│       ├── ci-cd.yml                   # Web application CI/CD pipeline`  
`│       └── bridge-build.yml            # Tauri cross-compilation workflow`  
`├── docs/`  
`│   ├── ARCHITECTURE.md                 # System Architecture & Technical Manual`  
`│   ├── SCHEMATICS.md                   # System Architecture Diagrams`  
`│   ├── TECH-STACK.md                   # Tech Stack Specifications`  
`│   ├── REQUIREMENTS.md                 # System Requirements`  
`│   ├── FRAMEWORK.md                    # Master Framework Specifications`  
`│   ├── TASKS.md                        # Task Index & Action Plan`  
`│   ├── VHOP-01-SOP.md                  # Standard Operating Procedures`  
`│   ├── VHOP-02-SYSTEMS.md              # Airframe Systems & Avionics`  
`│   ├── VHOP-03-DYNAMICS.md             # Helicopter Aerodynamics & Physics`  
`│   └── VHOP-04-CLINICAL.md             # Dispatch & Clinical Protocols`  
`├── apps/`  
`│   ├── web/                            # Next.js 14+ App Router (virtualhems.com)`  
`│   │   ├── src/`  
`│   │   │   ├── app/`  
`│   │   │   │   ├── (auth)/`  
`│   │   │   │   ├── (dashboard)/`  
`│   │   │   │   │   ├── command/        # Live Operations Command Map`  
`│   │   │   │   │   ├── dispatcher/     # 4-Stage Mission Planner`  
`│   │   │   │   │   ├── efb/            # Cockpit Electronic Flight Bag`  
`│   │   │   │   │   ├── logbook/        # Pilot Flight Logs`  
`│   │   │   │   │   ├── archive/        # Historical Mission Audit`  
`│   │   │   │   │   └── sms-report/     # VIRS Incident Reporting`  
`│   │   │   │   └── api/`  
`│   │   │   │       ├── dispatch/ai-briefing/route.ts`  
`│   │   │   │       ├── telemetry/route.ts`  
`│   │   │   │       └── aar/route.ts`  
`│   │   │   ├── components/`  
`│   │   │   │   ├── map/`  
`│   │   │   │   ├── dispatch/`  
`│   │   │   │   └── efb/`  
`│   │   │   ├── hooks/`  
`│   │   │   └── lib/`  
`│   │   ├── package.json`  
`│   │   └── tsconfig.json`  
`│   │`  
`│   └── bridge-desktop/                 # Cross-Platform Desktop Client (Tauri/Rust)`  
`│       ├── src-tauri/`  
`│       │   ├── src/`  
`│       │   │   ├── main.rs             # Tauri Entrypoint & UDP Socket Listener`  
`│       │   │   ├── simconnect/mod.rs   # MSFS Native Interface`  
`│       │   │   ├── xplane_udp/mod.rs   # X-Plane Data Ingestion`  
`│       │   │   └── uploader.rs         # WebSocket Telemetry Publisher`  
`│       │   └── Cargo.toml`  
`│       └── package.json`  
`│`  
`├── packages/`  
`│   ├── database/                       # PostgreSQL Schemas, PostGIS & Seeds`  
`│   │   ├── migrations/`  
`│   │   │   └── 00001_initial_schema.sql`  
`│   │   └── seed/`  
`│   │       ├── bases.seed.sql`  
`│   │       ├── hospitals.seed.sql`  
`│   │       └── conditions.seed.sql`  
`│   │`  
`│   └── shared-types/                   # Shared Universal TypeScript Interfaces`  
`│       ├── index.ts`  
`│       ├── telemetry.ts`  
`│       ├── medical.ts`  
`│       └── dispatch.ts`  
`│`  
`├── turbo.json`  
`└── package.json`

## **2\. Complete Database Schemas & Migrations**

The backend database utilizes **Supabase (PostgreSQL 15+)** with **PostGIS** spatial extensions enabled.

### **2.1 Database Migration (packages/database/migrations/00001\_initial\_schema.sql)**

`-- Enable Extensions`  
`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`  
`CREATE EXTENSION IF NOT EXISTS "postgis";`

`-- Domain Enums`  
`CREATE TYPE user_role AS ENUM ('trainee', 'officer', 'captain', 'instructor', 'admin');`  
`CREATE TYPE mission_type AS ENUM ('scene_call', 'inter_facility_transfer');`  
`CREATE TYPE mission_status AS ENUM ('dispatched', 'en_route_scene', 'on_scene', 'en_route_hospital', 'completed', 'aborted');`  
`CREATE TYPE patient_priority AS ENUM ('priority_1', 'priority_2', 'priority_3');`  
`CREATE TYPE airframe_type AS ENUM ('EC135', 'EC145', 'H135');`

`-- 1. Pilot Profiles Table`  
`CREATE TABLE public.profiles (`  
    `id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,`  
    `full_name TEXT NOT NULL,`  
    `callsign TEXT UNIQUE NOT NULL,`  
    `role user_role DEFAULT 'trainee'::user_role,`  
    `hems_credential_id TEXT UNIQUE NOT NULL,`  
    `total_hours NUMERIC(7, 2) DEFAULT 0.00,`  
    `total_dispatches INT DEFAULT 0,`  
    `home_base_id UUID,`  
    `created_at TIMESTAMPTZ DEFAULT NOW(),`  
    `updated_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 2. HEMS Base Infrastructure Table`  
`CREATE TABLE public.hems_bases (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `base_id TEXT UNIQUE NOT NULL,        -- e.g. "Stat MedEvac 6"`  
    `faa_id TEXT NOT NULL,                -- e.g. "KAXQ"`  
    `provider TEXT NOT NULL,               -- "Stat MedEvac" or "AHN LifeFlight"`  
    `location_name TEXT NOT NULL,         -- "Clarion County Airport"`  
    `elevation_ft INT NOT NULL,`  
    `coordinates GEOGRAPHY(POINT, 4326) NOT NULL,`  
    `primary_aircraft airframe_type NOT NULL,`  
    `tail_number TEXT NOT NULL,`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 3. Medical Emergency Condition Database (260+ Matrix)`  
`CREATE TABLE public.medical_conditions (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `icd_code TEXT UNIQUE,`  
    `condition_name TEXT NOT NULL,`  
    `category TEXT NOT NULL,               -- "Trauma", "Cardiac", "Neuro", etc.`  
    `baseline_gcs INT CHECK (baseline_gcs BETWEEN 3 AND 15),`  
    `requires_rsi BOOLEAN DEFAULT FALSE,`  
    `decay_rate_per_min NUMERIC(4, 2) DEFAULT 0.10,`  
    `target_facility_type TEXT NOT NULL,   -- "Level 1 Trauma Center", etc.`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 4. Regional Hospital Helipads Table`  
`CREATE TABLE public.hospitals (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `hospital_name TEXT NOT NULL,`  
    `faa_id TEXT UNIQUE NOT NULL,          -- e.g. "PS78"`  
    `city TEXT NOT NULL,`  
    `state VARCHAR(2) NOT NULL,`  
    `elevation_ft INT NOT NULL,`  
    `helipad_surface TEXT NOT NULL,        -- "CONCRETE", "ASPHALT", "MAT"`  
    `helipad_placement TEXT NOT NULL,      -- "ROOFTOP", "GROUND"`  
    `dimensions_ft TEXT NOT NULL,          -- "96 X 48"`  
    `coordinates GEOGRAPHY(POINT, 4326) NOT NULL,`  
    `trauma_capability TEXT NOT NULL,      -- "Level 1 Trauma Center", "Level 2", etc.`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 5. Missions Engine Table`  
`CREATE TABLE public.missions (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `mission_code TEXT UNIQUE NOT NULL,    -- e.g. "HEMS-295208"`  
    `type mission_type NOT NULL,`  
    `status mission_status DEFAULT 'dispatched'::mission_status,`  
    `priority patient_priority NOT NULL,`  
    `pilot_id UUID REFERENCES public.profiles(id) NOT NULL,`  
    `assigned_base_id UUID REFERENCES public.hems_bases(id) NOT NULL,`  
    `origin_hospital_id UUID REFERENCES public.hospitals(id),`  
    `destination_hospital_id UUID REFERENCES public.hospitals(id) NOT NULL,`  
    `scene_coordinates GEOGRAPHY(POINT, 4326),`  
      
    `-- Clinical Payload Parameters`  
    `patient_age INT NOT NULL,`  
    `patient_gender TEXT NOT NULL,`  
    `patient_weight_lbs INT NOT NULL,`  
    `medical_condition_id UUID REFERENCES public.medical_conditions(id) NOT NULL,`  
    `clinical_summary TEXT NOT NULL,`  
    `interventions TEXT,`  
      
    `-- Timestamps for Golden Hour Logic`  
    `dispatched_at TIMESTAMPTZ DEFAULT NOW(),`  
    `arrived_scene_at TIMESTAMPTZ,`  
    `departed_scene_at TIMESTAMPTZ,`  
    `arrived_hospital_at TIMESTAMPTZ,`  
      
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 6. Real-Time Telemetry Stream Table`  
`CREATE TABLE public.flight_telemetry (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `mission_id UUID REFERENCES public.missions(id) ON DELETE CASCADE,`  
    `pilot_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,`  
    `sim_engine TEXT NOT NULL,             -- "MSFS2020", "MSFS2024", "XPLANE11", "XPLANE12"`  
    `latitude NUMERIC(10, 7) NOT NULL,`  
    `longitude NUMERIC(10, 7) NOT NULL,`  
    `altitude_msl_ft INT NOT NULL,`  
    `altitude_agl_ft INT NOT NULL,`  
    `ground_speed_kts INT NOT NULL,`  
    `heading_deg INT NOT NULL,`  
    `vertical_speed_fpm INT NOT NULL,`  
    `pitch_deg NUMERIC(4, 1) NOT NULL,`  
    `roll_deg NUMERIC(4, 1) NOT NULL,`  
    `fuel_remaining_lbs NUMERIC(6, 1) NOT NULL,`  
    `torque_percent NUMERIC(5, 1) NOT NULL,`  
    `tot_celsius INT NOT NULL,`  
    `timestamp TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- Spatial and Temporal Indexes`  
`CREATE INDEX idx_telemetry_mission ON public.flight_telemetry(mission_id, timestamp DESC);`  
`CREATE INDEX idx_bases_spatial ON public.hems_bases USING GIST(coordinates);`  
`CREATE INDEX idx_hospitals_spatial ON public.hospitals USING GIST(coordinates);`  
`CREATE INDEX idx_missions_spatial ON public.missions USING GIST(scene_coordinates);`

## **3\. Seed Datasets (packages/database/seed)**

### **3.1 Base Stations Seed File (bases.seed.sql)**

`-- STAT MedEvac & AHN LifeFlight Base Infrastructure Network`  
`INSERT INTO public.hems_bases (base_id, faa_id, provider, location_name, elevation_ft, coordinates, primary_aircraft, tail_number) VALUES`  
`('Stat MedEvac 1', '60PN', 'Stat MedEvac', 'Washington Hospital', 1156, ST_SetSRID(ST_MakePoint(-80.2514, 40.1783), 4326), 'EC135', 'N527ME'),`  
`('Stat MedEvac 2', 'PA28', 'Stat MedEvac', 'Air Rescue East (Latrobe)', 1251, ST_SetSRID(ST_MakePoint(-79.4042, 40.2742), 4326), 'H135', 'N530ME'),`  
`('Stat MedEvac 3', 'PA56', 'Stat MedEvac', 'UPMC Passavant - Cranberry', 1100, ST_SetSRID(ST_MakePoint(-80.0972, 40.6837), 4326), 'H135', 'N536ME'),`  
`('Stat MedEvac 4', 'KAGC', 'Stat MedEvac', 'Allegheny County Airport (HQ)', 1251, ST_SetSRID(ST_MakePoint(-79.9302, 40.3544), 4326), 'EC145', 'N507ME'),`  
`('Stat MedEvac 5', 'KVVS', 'Stat MedEvac', 'Joseph A. Hardy Connellsville Apt', 1264, ST_SetSRID(ST_MakePoint(-79.6575, 39.9589), 4326), 'EC145', 'N307ME'),`  
`('Stat MedEvac 6', 'KAXQ', 'Stat MedEvac', 'Clarion County Airport', 1457, ST_SetSRID(ST_MakePoint(-79.4422, 41.2261), 4326), 'H135', 'N533ME'),`  
`('LifeFlight 1', 'PA67', 'AHN LifeFlight', 'Canonsburg Hospital', 1169, ST_SetSRID(ST_MakePoint(-80.1910, 40.2470), 4326), 'EC135', 'N878LF'),`  
`('LifeFlight 2', '91PA', 'AHN LifeFlight', 'Clarion Hospital', 1489, ST_SetSRID(ST_MakePoint(-79.3208, 41.1925), 4326), 'EC145', 'N131LF'),`  
`('LifeFlight 3', 'PN32', 'AHN LifeFlight', 'Indiana Regional Medical Center', 1285, ST_SetSRID(ST_MakePoint(-79.1568, 40.6301), 4326), 'EC145', 'N474LF'),`  
`('LifeFlight 4', 'KBTP', 'AHN LifeFlight', 'Pittsburgh/Butler Regional Airport', 1248, ST_SetSRID(ST_MakePoint(-79.9501, 40.7767), 4326), 'EC145', 'N373LF'),`  
`('LifeFlight 5', 'KFWQ', 'AHN LifeFlight', 'Rostraver Airport', 1228, ST_SetSRID(ST_MakePoint(-79.8256, 40.2161), 4326), 'EC145', 'N575LF');`

### **3.2 Regional Hospitals Seed File (hospitals.seed.sql)**

`-- Regional Hospital Facilities and Helipads`  
`INSERT INTO public.hospitals (hospital_name, faa_id, city, state, elevation_ft, helipad_surface, helipad_placement, dimensions_ft, coordinates, trauma_capability) VALUES`  
`('UPMC Presbyterian', 'PS78', 'PITTSBURGH', 'PA', 1124, 'CONCRETE', 'ROOFTOP', '96 X 48', ST_SetSRID(ST_MakePoint(-79.9600, 40.4423), 4326), 'Level 1 Trauma Center'),[span_15](start_span)[span_15](end_span)[span_16](start_span)[span_16](end_span)`  
`('UPMC Mercy', 'PN23', 'PITTSBURGH', 'PA', 886, 'CONCRETE', 'ROOFTOP', '65 X 65', ST_SetSRID(ST_MakePoint(-79.9856, 40.4361), 4326), 'Level 1 Trauma / Burn Center'),[span_17](start_span)[span_17](end_span)[span_18](start_span)[span_18](end_span)`  
`('UPMC Children''s Hospital of Pittsburgh', '30PN', 'PITTSBURGH', 'PA', 1088, 'CONCRETE', 'ROOFTOP', '45 X 45', ST_SetSRID(ST_MakePoint(-79.9531, 40.4678), 4326), 'Pediatric Level 1 Trauma'),[span_19](start_span)[span_19](end_span)[span_20](start_span)[span_20](end_span)`  
`('Allegheny General Hospital', '42PN', 'PITTSBURGH', 'PA', 804, 'CONCRETE', 'ROOFTOP', '65 X 65', ST_SetSRID(ST_MakePoint(-80.0042, 40.4563), 4326), 'Level 1 Trauma Center'),[span_21](start_span)[span_21](end_span)[span_22](start_span)[span_22](end_span)[span_23](start_span)[span_23](end_span)`  
`('UPMC Hamot', '0PS8', 'ERIE', 'PA', 900, 'CONCRETE', 'ROOFTOP', '60 X 65', ST_SetSRID(ST_MakePoint(-80.0853, 42.1358), 4326), 'Level 2 Trauma Center'),[span_24](start_span)[span_24](end_span)[span_25](start_span)[span_25](end_span)`  
`('UPMC Altoona', '74PN', 'ALTOONA', 'PA', 1259, 'CONCRETE', 'ROOFTOP', '65 X 65', ST_SetSRID(ST_MakePoint(-78.4022, 40.5186), 4326), 'Level 2 Trauma Center'),[span_26](start_span)[span_26](end_span)[span_27](start_span)[span_27](end_span)`  
`('Penn Highlands DuBois', 'PA10', 'DUBOIS', 'PA', 1463, 'CONCRETE', 'GROUND', '32 X 32', ST_SetSRID(ST_MakePoint(-78.7511, 41.1189), 4326), 'Regional Trauma Center'),[span_28](start_span)[span_28](end_span)[span_29](start_span)[span_29](end_span)`  
`('Butler Memorial Hospital', 'PA41', 'BUTLER', 'PA', 1190, 'ASPHALT', 'GROUND', '65 X 65', ST_SetSRID(ST_MakePoint(-79.8925, 40.8672), 4326), 'Acute Care Center'),[span_30](start_span)[span_30](end_span)[span_31](start_span)[span_31](end_span)`  
`('Clarion Hospital', '91PA', 'CLARION', 'PA', 1489, 'CONCRETE', 'GROUND', '50 X 50', ST_SetSRID(ST_MakePoint(-79.3850, 41.1925), 4326), 'Acute Care Center');[span_32](start_span)[span_32](end_span)[span_33](start_span)[span_33](end_span)[span_34](start_span)[span_34](end_span)`

## **4\. Desktop Bridge Runtime Implementation**

The desktop bridge application operates on Windows and macOS, interfacing directly with flight simulation engines.

### **4.1 X-Plane FlyWithLua Data Pipe (plugins/xplane-lua/hems-dispatch-xp.lua)**

`-- Virtual HEMS Telemetry Data Pipe v5.3`  
`-- File Path: X-Plane/Resources/plugins/FlyWithLua/Scripts/hems-dispatch-xp.lua`

`local socket = require("socket")`  
`local host = "127.0.0.1"`  
`local port = 8080`  
`local udp = socket.udp()`  
`udp:settimeout(0)`

`-- Dataref Bindings`  
`DataRef("lat", "sim/flightmodel/position/latitude", "readonly")`  
`DataRef("lon", "sim/flightmodel/position/longitude", "readonly")`  
`DataRef("alt_msl", "sim/flightmodel/position/elevation", "readonly") -- Meters`  
`DataRef("agl", "sim/flightmodel/position/y_agl", "readonly")         -- Meters`  
`DataRef("gs", "sim/flightmodel/position/groundspeed", "readonly")    -- m/s`  
`DataRef("heading", "sim/flightmodel/position/mag_psi", "readonly")`  
`DataRef("vs", "sim/flightmodel/position/vh_ind", "readonly")        -- m/s`  
`DataRef("pitch", "sim/flightmodel/position/theta", "readonly")`  
`DataRef("roll", "sim/flightmodel/position/phi", "readonly")`  
`DataRef("fuel_total", "sim/flightmodel/weight/m_fuel_total", "readonly") -- kg`  
`DataRef("trq", "sim/flightmodel/engine/ENGN_TRQ", "readonly")`

`local last_transmission = 0`

`function stream_telemetry()`  
    `local now = os.clock()`  
    `if now - last_transmission >= 0.5 then -- 2 Hz Target Sampling Rate`  
        `last_transmission = now`  
        `local json_payload = string.format(`  
            `'{"engine":"XPLANE","lat":%.7f,"lon":%.7f,"alt_msl":%d,"agl":%d,"gs":%d,"heading":%d,"vs":%d,"pitch":%.1f,"roll":%.1f,"fuel_lbs":%.1f,"torque":%.1f}',`  
            `lat, lon,`  
            `math.floor(alt_msl * 3.28084), -- Convert M to FT`  
            `math.floor(agl * 3.28084),`  
            `math.floor(gs * 1.94384),     -- Convert m/s to KTS`  
            `math.floor(heading),`  
            `math.floor(vs * 196.85),       -- Convert m/s to FPM`  
            `pitch, roll,`  
            `fuel_total * 2.20462,          -- Convert kg to LBS`  
            `trq`  
        `)`  
        `udp:sendto(json_payload, host, port)`  
    `end`  
`end`

`do_often("stream_telemetry()")`

### **4.2 Tauri Desktop Entrypoint (apps/bridge-desktop/src-tauri/src/main.rs)**

`// Location: apps/bridge-desktop/src-tauri/src/main.rs`  
`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`

`use serde::{Serialize, Deserialize};`  
`use tokio::net::UdpSocket;`

`#[derive(Debug, Serialize, Deserialize, Clone)]`  
`pub struct TelemetryPacket {`  
    `pub engine: String,`  
    `pub lat: f64,`  
    `pub lon: f64,`  
    `pub alt_msl: i32,`  
    `pub agl: i32,`  
    `pub gs: i32,`  
    `pub heading: i32,`  
    `pub vs: i32,`  
    `pub pitch: f32,`  
    `pub roll: f32,`  
    `pub fuel_lbs: f32,`  
    `pub torque: f32,`  
`}`

`#[tauri::command]`  
`async fn start_udp_listener() -> Result<(), String> {`  
    `let socket = UdpSocket::bind("127.0.0.1:8080").await.map_err(|e| e.to_string())?;`  
    `let mut buffer = [0u8; 1024];`

    `tokio::spawn(async move {`  
        `loop {`  
            `if let Ok((len, _)) = socket.recv_from(&mut buffer).await {`  
                `if let Ok(data_str) = std::str::from_utf8(&buffer[..len]) {`  
                    `if let Ok(packet) = serde_json::from_str::<TelemetryPacket>(data_str) {`  
                        `// Forward packet to Supabase Realtime WebSocket channel`  
                    `}`  
                `}`  
            `}`  
        `}`  
    `});`

    `Ok(())`  
`}`

`fn main() {`  
    `tauri::Builder::default()`  
        `.invoke_handler(tauri::generate_handler![start_udp_listener])`  
        `.run(tauri::generate_context!())`  
        `.expect("Error launching Virtual HEMS Bridge client");`  
`}`

## **5\. Web UI & EFB Application Components**

### **5.1 4-Stage Mission Dispatch Planner (apps/web/src/components/dispatch/Step3PatientInfo.tsx)**

`// Location: apps/web/src/components/dispatch/Step3PatientInfo.tsx`  
`'use client';`

`import React, { useState } from 'react';`

`interface PatientInfoProps {`  
  `onNext: (data: any) => void;`  
  `onBack: () => void;`  
`}`

`export const Step3PatientInfo: React.FC<PatientInfoProps> = ({ onNext, onBack }) => {`  
  `const [age, setAge] = useState<number>(43);`  
  `const [gender, setGender] = useState<string>('Female');`  
  `const [weight, setWeight] = useState<number>(176);`  
  `const [summary, setSummary] = useState<string>('MVA, Crushed Leg, and Arm');`  
  `const [interventions, setInterventions] = useState<string>(`  
    `'Trapped, Extraction in progress, IV Started, Fentanyl for pain, Significant Blood Loss'`  
  `);`  
  `const [isAiLoading, setIsAiLoading] = useState<boolean>(false);`

  `const handleAiBriefing = async () => {`  
    `setIsAiLoading(true);`  
    `try {`  
      `const res = await fetch('/api/dispatch/ai-briefing', {`  
        `method: 'POST',`  
        `headers: { 'Content-Type': 'application/json' },`  
        `body: JSON.stringify({ age, gender, weight, summary, interventions }),`  
      `});`  
      `const data = await res.json();`  
      `if (data.recommendedFacility) {`  
        ``setInterventions((prev) => `${prev} | AI Rec: ${data.recommendedFacility}`);``  
      `}`  
    `} catch (err) {`  
      `console.error('Failed to generate AI tactical briefing', err);`  
    `} finally {`  
      `setIsAiLoading(false);`  
    `}`  
  `};`

  `return (`  
    `<div className="w-full max-w-4xl mx-auto bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-white shadow-2xl">`  
      `<div className="flex items-center space-x-3 mb-6">`  
        `<span className="text-amber-500 font-bold text-xl">⚡ Clinical Data Management</span>`  
      `</div>`

      `<button`  
        `onClick={handleAiBriefing}`  
        `disabled={isAiLoading}`  
        `className="w-full py-3 mb-6 bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded-lg tracking-wider transition-all flex items-center justify-center space-x-2"`  
      `>`  
        `<span>⚡ {isAiLoading ? 'GENERATING TACTICAL BRIEFING...' : 'REQUEST AI TACTICAL DISPATCH BRIEFING'}</span>`  
      `</button>`

      `<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">`  
        `<div>`  
          `<label className="block text-xs uppercase text-zinc-400 mb-1 font-semibold">Age</label>`  
          `<input`  
            `type="number"`  
            `value={age}`  
            `onChange={(e) => setAge(Number(e.target.value))}`  
            `className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-amber-500 outline-none"`  
          `/>`  
        `</div>`  
        `<div>`  
          `<label className="block text-xs uppercase text-zinc-400 mb-1 font-semibold">Gender</label>`  
          `<select`  
            `value={gender}`  
            `onChange={(e) => setGender(e.target.value)}`  
            `className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-amber-500 outline-none"`  
          `>`  
            `<option value="Female">Female</option>`  
            `<option value="Male">Male</option>`  
            `<option value="Other">Other</option>`  
          `</select>`  
        `</div>`  
        `<div>`  
          `<label className="block text-xs uppercase text-zinc-400 mb-1 font-semibold">Weight (LB)</label>`  
          `<input`  
            `type="number"`  
            `value={weight}`  
            `onChange={(e) => setWeight(Number(e.target.value))}`  
            `className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-amber-500 outline-none"`  
          `/>`  
        `</div>`  
      `</div>`

      `<div className="mb-6">`  
        `<label className="block text-xs uppercase text-zinc-400 mb-1 font-semibold">Clinical Summary / Mechanism</label>`  
        `<textarea`  
          `rows={3}`  
          `value={summary}`  
          `onChange={(e) => setSummary(e.target.value)}`  
          `className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-amber-500 outline-none resize-none"`  
        `/>`  
      `</div>`

      `<div className="mb-8">`  
        `<label className="block text-xs uppercase text-zinc-400 mb-1 font-semibold">Stabilizing Interventions</label>`  
        `<textarea`  
          `rows={3}`  
          `value={interventions}`  
          `onChange={(e) => setInterventions(e.target.value)}`  
          `className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-amber-500 outline-none resize-none"`  
        `/>`  
      `</div>`

      `<div className="flex justify-between">`  
        `<button`  
          `onClick={onBack}`  
          `className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-bold transition-all"`  
        `>`  
          `← Back`  
        `</button>`  
        `<button`  
          `onClick={() => onNext({ age, gender, weight, summary, interventions })}`  
          `className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded-lg tracking-wider transition-all"`  
        `>`  
          `Next: Performance Specs →`  
        `</button>`  
      `</div>`  
    `</div>`  
  `);`  
`};`

### **5.2 Dynamic "Golden Hour" Clinical Decay Hook (apps/web/src/hooks/useGoldenHour.ts)**

`// Location: apps/web/src/hooks/useGoldenHour.ts`

`import { useState, useEffect } from 'react';`  
`import { PatientState } from '@virtualhems/shared-types';`

`export const useGoldenHour = (initialPatient: PatientState, isTimerActive: boolean) => {`  
  `const [patient, setPatient] = useState<PatientState>(initialPatient);`

  `useEffect(() => {`  
    `if (!isTimerActive) return;`

    `const interval = setInterval(() => {`  
      `setPatient((prev) => {`  
        `const newElapsedSeconds = prev.elapsed_scene_seconds + 1;`  
        `const minutesElapsed = newElapsedSeconds / 60;`  
          
        `-- Calculate GCS deterioration based on condition decay rate`  
        `const gcsPenalty = Math.floor(minutesElapsed * prev.decay_rate_per_min);`  
        `const updatedGcs = Math.max(3, prev.baseline_gcs - gcsPenalty);`

        `return {`  
          `...prev,`  
          `elapsed_scene_seconds: newElapsedSeconds,`  
          `current_gcs: updatedGcs,`  
          `deteriorated: updatedGcs < prev.baseline_gcs,`  
        `};`  
      `});`  
    `}, 1000);`

    `return () => clearInterval(interval);`  
  `}, [isTimerActive]);`

  `return patient;`  
`};`

## **6\. Deployment & CI/CD Pipelines**

### **6.1 GitHub Actions Workflow (.github/workflows/ci-cd.yml)**

`name: Virtual HEMS Production Build & Deploy`

`on:`  
  `push:`  
    `branches: [ main ]`

`jobs:`  
  `audit-and-build:`  
    `runs-on: ubuntu-latest`  
    `steps:`  
      `- name: Checkout Code Repository`  
        `uses: actions/checkout@v4`

      `- name: Setup Node.js Environment`  
        `uses: actions/setup-node@v4`  
        `with:`  
          `node-version: 20`  
          `cache: 'npm'`

      `- name: Install Monorepo Dependencies`  
        `run: npm ci`

      `- name: Execute Typechecks and Linter`  
        `run: npx turbo run lint typecheck`

      `- name: Build Web Application`  
        `run: npx turbo run build --filter=@virtualhems/web`  
        `env:`  
          `NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}`  
          `NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}`

  `build-desktop-bridge:`  
    `runs-on: windows-latest`  
    `steps:`  
      `- name: Checkout Code Repository`  
        `uses: actions/checkout@v4`

      `- name: Setup Rust Toolchain`  
        `uses: dtolnay/rust-toolchain@stable`

      `- name: Build Tauri Desktop Client`  
        `run: |`  
          `cd apps/bridge-desktop`  
          `npm ci`  
          `npm run tauri build`

## **7\. Master Verification & Acceptance Matrix**

`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                        SYSTEM ACCEPTANCE VERIFICATION MATRIX                                          |`  
`+-------------------+-----------------------------------+---------------------------------------------------------------+`  
`| System Component  | Verification Method               | Acceptance Target Condition                                   |`  
`+-------------------+-----------------------------------+---------------------------------------------------------------+`  
`| Database Engine   | PostGIS Spatial Radius Audit      | Valid distance calculation between PS78 and KAXQ[span_38](start_span)[span_38](end_span)[span_39](start_span)[span_39](end_span)  |`  
`| Desktop Bridge    | Hardware Ingestion Stress Test    | Sub-second WebSocket transmission from MSFS & X-Plane[span_40](start_span)[span_40](end_span)[span_41](start_span)[span_41](end_span)|`  
`| Dispatch Planner  | 4-Stage Dispatch Execution        | Generates active mission record & pushes to cockpit EFB[span_42](start_span)[span_42](end_span)|`  
`| Clinical Engine   | 20-minute On-Scene Delay Run      | Triggers dynamic GCS decay & updates patient vitals[span_43](start_span)[span_43](end_span) |`  
``| AI Dispatcher     | POST `/api/dispatch/ai-briefing`  | Issues valid receiving facility & LZ recommendations[span_44](start_span)[span_44](end_span) |``  
`| Post-Flight AAR   | Hospital Touchdown Event          | Audits touchdown G-force, fuel reserves & logs history[span_45](start_span)[span_45](end_span) |`  
`+-------------------+-----------------------------------+---------------------------------------------------------------+`

**Authored By:** Chief Technical Architect & Lead Software Engineer, Virtual HEMS **Approved By:** Directorate of Technology & Flight Operations, Virtual HEMS Council **Repository Target:** virtualhems-monorepo/BLUEPRINT.md