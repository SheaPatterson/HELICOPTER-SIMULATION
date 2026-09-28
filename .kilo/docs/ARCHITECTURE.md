# **Technical Architecture & Implementation Blueprint (ARCHITECTURE.md)**

**Document Designation:** ARCH-SPEC-01 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Full Stack System Architecture, Database Schemas, Telemetry Mechanics, Data Models, and Deployment Pipelines for Virtual HEMS (virtualhems.com)

## **1\. System Overview & Monorepo Topology**

### **1.1 Architectural Philosophy**

The Virtual HEMS platform is engineered to bridge raw flight simulator physics engines (Microsoft Flight Simulator 2020/2024 and X-Plane 11/12) with a real-time, cloud-native critical care transport ecosystem. The platform consists of four primary subsystems:

> 1. **Simulator Telemetry Ingestion Layer:** Native C++ / C\# SimConnect bindings for MSFS and FlyWithLua local socket UDP streams for X-Plane.  
> 2. **Local Desktop Bridge (Tauri / Rust):** Low-overhead, cross-platform client that samples flight dynamics vectors, applies delta compression, and streams encrypted payload packets via WebSockets.  
> 3. **Cloud Backend & Data Engine (Supabase / PostgreSQL 15+):** Cloud infrastructure hosting spatio-temporal telemetry streams, the "Ironpine" AI tactical dispatch engine, dynamic clinical deterioration state engines, and historical mission logs.  
> 4. **Web Command Terminal & Cockpit EFB (apps/web):** Next.js 14+ interface providing high-resolution live asset tracking, a 4-stage mission planner, patient vital displays, and post-flight After-Action Reviews (AAR).

### **1.2 Monorepo Directory Topology**

The system repository is structured as a Turborepo workspace ensuring shared type safety across client, bridge, and backend layers:  
`virtualhems-monorepo/`  
`├── .github/`  
`│   └── workflows/`  
`│       ├── ci-cd.yml                   # Automated Next.js & Supabase deployment`  
`│       └── bridge-build.yml            # Tauri cross-compilation pipeline`  
`├── docs/`  
`│   ├── ARCHITECTURE.md                 # System Architecture & Technical Manual`  
`│   ├── VHOP-01-SOP.md                  # Standard Operating Procedures[span_17](start_span)[span_17](end_span)`  
`│   ├── VHOP-02-SYSTEMS.md              # Airframe Systems & Avionics`  
`│   ├── VHOP-03-DYNAMICS.md             # Helicopter Aerodynamics & Physics`  
`│   └── VHOP-04-CLINICAL.md             # Dispatch & Clinical Engine Protocols`  
`├── apps/`  
`│   ├── web/                            # Next.js 14+ App Router (virtualhems.com)`  
`│   │   ├── src/`  
`│   │   │   ├── app/`  
`│   │   │   │   ├── (auth)/`  
`│   │   │   │   ├── (dashboard)/`  
`│   │   │   │   │   ├── command/        # Global Operations Center Map`  
`│   │   │   │   │   ├── dispatcher/     # 4-Stage Mission Planning Interface[span_18](start_span)[span_18](end_span)`  
`│   │   │   │   │   ├── efb/            # In-Cockpit Electronic Flight Bag`  
`│   │   │   │   │   └── aar/            # After-Action Review & Flight Auditing`  
`│   │   │   │   └── api/`  
`│   │   │   ├── components/`  
`│   │   │   ├── hooks/`  
`│   │   │   └── lib/`  
`│   │   ├── package.json`  
`│   │   └── tsconfig.json`  
`│   │`  
`│   └── bridge-desktop/                 # Cross-Platform Desktop Client (Tauri/Rust)`  
`│       ├── src-tauri/`  
`│       │   ├── src/`  
`│       │   │   ├── main.rs`  
`│       │   │   ├── simconnect/         # MSFS 2020/2024 Native Bridge[span_19](start_span)[span_19](end_span)[span_20](start_span)[span_20](end_span)`  
`│       │   │   ├── xplane_udp/         # X-Plane 11/12 Local Socket Listener[span_21](start_span)[span_21](end_span)[span_22](start_span)[span_22](end_span)`  
`│       │   │   └── uploader.rs         # Supabase Realtime WebSocket Publisher`  
`│       │   └── Cargo.toml`  
`│       └── package.json`  
`│`  
`├── packages/`  
`│   ├── database/                       # PostgreSQL Schemas, Migrations & Seeds`  
`│   │   ├── migrations/`  
`│   │   │   ├── 00001_initial_schema.sql`  
`│   │   │   ├── 00002_medical_conditions.sql`  
`│   │   │   └── 00003_regional_infrastructure.sql`  
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
`└── README.md`

## **2\. End-to-End System Data Flow Architecture**

`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                           END-TO-END SYSTEM DATA FLOW                                                 |`  
`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                                                                                                       |`  
`|  [ FLIGHT SIMULATOR ENGINES ]                                                                                        |`  
`|  ┌───────────────────────────────────────────────┐     ┌──────────────────────────────────────────────────┐         |`  
`|  │ Microsoft Flight Simulator (2020 / 2024) [9]   │     │ X-Plane (11 / 12) [15]                           │         |`  
`|  │ - SimConnect C++ DLL Interface [16]           │     │ - FlyWithLua Script Engine [16]                  │         |`  
`|  └───────────────────────┬───────────────────────┘     └────────────────────────┬─────────────────────────┘         |`  
`|                          │ C++ Shared Memory                                    │ UDP Sockets (Port 8080) [16]      |`  
`|                          ▼                                                      ▼                                   |`  
`|  [ LOCAL DESKTOP BRIDGE (Tauri / Rust Runtime) ] [12, 16]                                                             |`  
`|  ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ |`  
`|  │ - High-Rate Data Sampler (2 Hz to 10 Hz Adaptive Rate) [16]                                                    │ |`  
`|  │ - Delta-Compression Filter & Kinematic State Parser                                                            │ |`  
`|  │ - Local Failover Buffer (SQLite ring-buffer for offline recovery) [16]                                         │ |`  
`|  └──────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┘ |`  
`|                                                         │                                                           |`  
`|                                                         │ Encrypted Secure WebSockets / TLS [16]                    |`  
`|                                                         ▼                                                           |`  
`|  [ CLOUD BACKEND & DATA ENGINE (Supabase / PostgreSQL 15+) ] [4, 16]                                                  |`  
`|  ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ |`  
`|  │ - Realtime Broadcast Channels (Sub-second vector fanout) [16]                                                  │ |`  
`|  │ - PostGIS Geospatial Engine (Proximity, LZ boundaries, vector routing) [16]                                   │ |`  
`|  │ - Dynamic "Golden Hour" Medical Deterioration State Machine [4, 16]                                            │ |`  
`|  │ - Ironpine AI Tactical Dispatch & Automated Flight Auditor [16]                                                │ |`  
`|  └──────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┘ |`  
`|                                                         │                                                           |`  
`|                                                         │ WebSockets / Next.js Server Actions [16]                  |`  
`|                                                         ▼                                                           |`  
`|  [ WEB COMMAND TERMINAL & COCKPIT EFB (virtualhems.com) ] [4, 16]                                                     |`  
`|  ┌───────────────────────────────────────────────┐     ┌──────────────────────────────────────────────────┐         |`  
`|  │ Live Operations Map (Leaflet/Mapbox GL) [16]  │     │ 4-Stage Dispatcher & Cockpit EFB [16]            │         |`  
`|  │ - Asset Tracking & LZ Overlays                │     │ - Real-Time Patient Vitals & Triage [4, 16]      │         |`  
`|  │ - Base Station & Hospital Helipad Vectors     │     │ - Post-Flight After Action Review (AAR) [4, 16]  │         |`  
`|  └───────────────────────────────────────────────┘     └──────────────────────────────────────────────────┘         |`  
`+-----------------------------------------------------------------------------------------------------------------------+`

## **3\. Database Schemas & Migrations (packages/database)**

### **3.1 Migration 00001\_initial\_schema.sql**

`-- Enable PostGIS and UUID Generation Extensions`  
`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`  
`CREATE EXTENSION IF NOT EXISTS "postgis";`

`-- Domain Enums`  
`CREATE TYPE user_role AS ENUM ('trainee', 'officer', 'captain', 'instructor', 'admin');`  
`CREATE TYPE mission_type AS ENUM ('scene_call', 'inter_facility_transfer');`  
`CREATE TYPE mission_status AS ENUM ('dispatched', 'en_route_scene', 'on_scene', 'en_route_hospital', 'completed', 'aborted');`  
`CREATE TYPE patient_priority AS ENUM ('priority_1', 'priority_2', 'priority_3');`  
`CREATE TYPE airframe_type AS ENUM ('EC135', 'EC145', 'H135');`

`-- 1. Pilot Profiles`  
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

`-- 2. Regional Base Infrastructure`  
`CREATE TABLE public.hems_bases (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `base_identifier TEXT UNIQUE NOT NULL, -- e.g., "STAT MedEvac 6"`  
    `faa_id TEXT NOT NULL,                  -- e.g., "KAXQ"`  
    `provider TEXT NOT NULL,                -- "STAT MedEvac" or "AHN LifeFlight"`  
    `facility_name TEXT NOT NULL,           -- "Clarion County Airport"`  
    `elevation_ft INT NOT NULL,`  
    `coordinates GEOGRAPHY(POINT, 4326) NOT NULL,`  
    `default_airframe airframe_type NOT NULL,`  
    `tail_number TEXT NOT NULL,`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 3. Medical Emergency Condition Database`  
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

`-- 4. Regional Hospital Helipads`  
`CREATE TABLE public.hospitals (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `hospital_name TEXT NOT NULL,`  
    `faa_id TEXT UNIQUE NOT NULL,          -- e.g., "PS78"`  
    `city TEXT NOT NULL,`  
    `state VARCHAR(2) NOT NULL,`  
    `elevation_ft INT NOT NULL,`  
    `helipad_surface TEXT NOT NULL,        -- "CONCRETE", "ASPHALT", "MAT"`  
    `helipad_placement TEXT NOT NULL,      -- "ROOFTOP", "GROUND"`  
    `dimensions_ft TEXT NOT NULL,          -- "96 X 48"`  
    `coordinates GEOGRAPHY(POINT, 4326) NOT NULL,`  
    `trauma_capability TEXT NOT NULL,      -- "Level 1 Trauma", "Level 2", "Comprehensive Stroke"`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 5. Active and Historical Missions`  
`CREATE TABLE public.missions (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `mission_code TEXT UNIQUE NOT NULL,    -- e.g., "HEMS-89210"`  
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
    `condition_id UUID REFERENCES public.medical_conditions(id) NOT NULL,`  
    `clinical_summary TEXT NOT NULL,`  
    `interventions TEXT,`  
      
    `-- Timestamps for Clinical Timer Logic`  
    `dispatched_at TIMESTAMPTZ DEFAULT NOW(),`  
    `arrived_scene_at TIMESTAMPTZ,`  
    `departed_scene_at TIMESTAMPTZ,`  
    `arrived_hospital_at TIMESTAMPTZ,`  
      
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 6. Real-Time Telemetry Stream Logs`  
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
    `engine_torque_percent NUMERIC(5, 1) NOT NULL,`  
    `tot_celsius INT NOT NULL,`  
    `timestamp TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- Geospatial and Temporal Indexes`  
`CREATE INDEX idx_telemetry_mission ON public.flight_telemetry(mission_id, timestamp DESC);`  
`CREATE INDEX idx_bases_spatial ON public.hems_bases USING GIST(coordinates);`  
`CREATE INDEX idx_hospitals_spatial ON public.hospitals USING GIST(coordinates);`  
`CREATE INDEX idx_missions_spatial ON public.missions USING GIST(scene_coordinates);`

## **4\. Hardware Bridge Telemetry Pipelines**

### **4.1 X-Plane FlyWithLua Telemetry Pipe (hems-dispatch-xp.lua)**

`-- Virtual HEMS X-Plane Telemetry Pipe v5.3`  
`-- Location: plugins/xplane-lua/hems-dispatch-xp.lua`

`local socket = require("socket")`  
`local host = "127.0.0.1"`  
`local port = 8080`  
`local udp = socket.udp()`  
`udp:settimeout(0)`

`-- Dataref Subscriptions`  
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

`local last_send = 0`

`function send_telemetry()`  
    `local now = os.clock()`  
    `if now - last_send >= 0.5 then -- 2 Hz Sampling Rate`  
        `last_send = now`  
        `local payload = string.format(`  
            `'{"engine":"XPLANE","lat":%.7f,"lon":%.7f,"alt_msl":%d,"agl":%d,"gs":%d,"heading":%d,"vs":%d,"pitch":%.1f,"roll":%.1f,"fuel_lbs":%.1f,"torque":%.1f}',`  
            `lat, lon,`  
            `math.floor(alt_msl * 3.28084),`  
            `math.floor(agl * 3.28084),`  
            `math.floor(gs * 1.94384),`  
            `math.floor(heading),`  
            `math.floor(vs * 196.85),`  
            `pitch, roll,`  
            `fuel_total * 2.20462,`  
            `trq`  
        `)`  
        `udp:sendto(payload, host, port)`  
    `end`  
`end`

`do_often("send_telemetry()")`

### **4.2 Rust Tauri Desktop SimConnect Processor (src-tauri/src/simconnect/mod.rs)**

`// Location: apps/bridge-desktop/src-tauri/src/simconnect/mod.rs`

`use serde::{Serialize, Deserialize};`  
`use std::time::Duration;`  
`use tokio::sync::mpsc;`

`#[derive(Debug, Serialize, Deserialize, Clone)]`  
`pub struct FlightVectorPayload {`  
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

`pub struct SimConnectEngine {`  
    `pub is_active: bool,`  
    `pub tx: mpsc::Sender<FlightVectorPayload>,`  
`}`

`impl SimConnectEngine {`  
    `pub fn new(tx: mpsc::Sender<FlightVectorPayload>) -> Self {`  
        `Self { is_active: false, tx }`  
    `}`

    `pub async fn start_polling(&mut self) {`  
        `self.is_active = true;`  
        `let tx = self.tx.clone();`  
          
        `tokio::spawn(async move {`  
            `while let Ok(_) = tokio::time::sleep(Duration::from_millis(500)).await {`  
                `// SimConnect SDK polling dispatch occurs here.`  
                `// Upon receiving SIMCONNECT_RECV_ID_SIMOBJECT_DATA, map to FlightVectorPayload`  
                `// and transmit via channel: tx.send(payload).await`  
            `}`  
        `});`  
    `}`  
`}`

## **5\. Web Command Terminal & Clinical Engine Integrations**

### **5.1 Shared TypeScript Core Interfaces (packages/shared-types/telemetry.ts)**

`// Location: packages/shared-types/telemetry.ts`

`export type SimEngine = 'MSFS2020' | 'MSFS2024' | 'XPLANE11' | 'XPLANE12';`  
`export type MissionType = 'scene_call' | 'inter_facility_transfer';`  
`export type PatientPriority = 'priority_1' | 'priority_2' | 'priority_3';`

`export interface TelemetryFrame {`  
  `engine: SimEngine;`  
  `lat: number;`  
  `lon: number;`  
  `alt_msl: number;`  
  `agl: number;`  
  `gs: number;`  
  `heading: number;`  
  `vs: number;`  
  `pitch: number;`  
  `roll: number;`  
  `fuel_lbs: number;`  
  `torque: number;`  
  `timestamp: string;`  
`}`

`export interface PatientState {`  
  `id: string;`  
  `age: number;`  
  `gender: string;`  
  `weight_lbs: number;`  
  `condition_name: string;`  
  `current_gcs: number;`  
  `baseline_gcs: number;`  
  `decay_rate_per_min: number;`  
  `elapsed_scene_seconds: number;`  
  `deteriorated: boolean;`  
`}`

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

## **6\. Western Pennsylvania Regional Data Integration**

### **6.1 Base Station Seed File (packages/database/seed/bases.seed.sql)**

`-- STAT MedEvac & AHN LifeFlight Base Network`  
`INSERT INTO public.hems_bases (base_identifier, faa_id, provider, facility_name, elevation_ft, coordinates, default_airframe, tail_number) VALUES`  
`('Stat MedEvac 1', '60PN', 'Stat MedEvac', 'Washington Hospital', 1156, ST_SetSRID(ST_MakePoint(-80.2514, 40.1783), 4326), 'EC135', 'N527ME'),[span_23](start_span)[span_23](end_span)[span_24](start_span)[span_24](end_span)`  
`('Stat MedEvac 2', 'PA28', 'Stat MedEvac', 'Air Rescue East (Latrobe)', 1251, ST_SetSRID(ST_MakePoint(-79.4042, 40.2742), 4326), 'H135', 'N530ME'),[span_25](start_span)[span_25](end_span)[span_26](start_span)[span_26](end_span)`  
`('Stat MedEvac 3', 'PA56', 'Stat MedEvac', 'UPMC Passavant - Cranberry', 1100, ST_SetSRID(ST_MakePoint(-80.0972, 40.6837), 4326), 'H135', 'N536ME'),[span_27](start_span)[span_27](end_span)[span_28](start_span)[span_28](end_span)`  
`('Stat MedEvac 4', 'KAGC', 'Stat MedEvac', 'Allegheny County Airport (HQ)', 1251, ST_SetSRID(ST_MakePoint(-79.9302, 40.3544), 4326), 'EC145', 'N507ME'),[span_29](start_span)[span_29](end_span)[span_30](start_span)[span_30](end_span)`  
`('Stat MedEvac 5', 'KVVS', 'Stat MedEvac', 'Joseph A. Hardy Connellsville Apt', 1264, ST_SetSRID(ST_MakePoint(-79.6575, 39.9589), 4326), 'EC145', 'N307ME'),[span_31](start_span)[span_31](end_span)[span_32](start_span)[span_32](end_span)`  
`('Stat MedEvac 6', 'KAXQ', 'Stat MedEvac', 'Clarion County Airport', 1457, ST_SetSRID(ST_MakePoint(-79.4422, 41.2261), 4326), 'H135', 'N533ME'),[span_33](start_span)[span_33](end_span)[span_34](start_span)[span_34](end_span)`  
`('LifeFlight 1', 'PA67', 'AHN LifeFlight', 'Canonsburg Hospital', 1169, ST_SetSRID(ST_MakePoint(-80.1910, 40.2470), 4326), 'EC135', 'N878LF'),[span_35](start_span)[span_35](end_span)[span_36](start_span)[span_36](end_span)`  
`('LifeFlight 2', '91PA', 'AHN LifeFlight', 'Clarion Hospital', 1489, ST_SetSRID(ST_MakePoint(-79.3208, 41.1925), 4326), 'EC145', 'N131LF'),[span_37](start_span)[span_37](end_span)[span_38](start_span)[span_38](end_span)`  
`('LifeFlight 3', 'PN32', 'AHN LifeFlight', 'Indiana Regional Medical Center', 1285, ST_SetSRID(ST_MakePoint(-79.1568, 40.6301), 4326), 'EC145', 'N474LF'),[span_39](start_span)[span_39](end_span)[span_40](start_span)[span_40](end_span)`  
`('LifeFlight 4', 'KBTP', 'AHN LifeFlight', 'Pittsburgh/Butler Regional Airport', 1248, ST_SetSRID(ST_MakePoint(-79.9501, 40.7767), 4326), 'EC145', 'N373LF'),[span_41](start_span)[span_41](end_span)[span_42](start_span)[span_42](end_span)`  
`('LifeFlight 5', 'KFWQ', 'AHN LifeFlight', 'Rostraver Airport', 1228, ST_SetSRID(ST_MakePoint(-79.8256, 40.2161), 4326), 'EC145', 'N575LF');[span_43](start_span)[span_43](end_span)[span_44](start_span)[span_44](end_span)`

### **6.2 Hospital Helipad Seed File (packages/database/seed/hospitals.seed.sql)**

`-- Regional Hospital Facilities and Helipads`  
`INSERT INTO public.hospitals (hospital_name, faa_id, city, state, elevation_ft, helipad_surface, helipad_placement, dimensions_ft, coordinates, trauma_capability) VALUES`  
`('UPMC Presbyterian', 'PS78', 'PITTSBURGH', 'PA', 1124, 'CONCRETE', 'ROOFTOP', '96 X 48', ST_SetSRID(ST_MakePoint(-79.9600, 40.4423), 4326), 'Level 1 Trauma Center'),[span_45](start_span)[span_45](end_span)[span_46](start_span)[span_46](end_span)[span_47](start_span)[span_47](end_span)`  
`('UPMC Mercy', 'PN23', 'PITTSBURGH', 'PA', 886, 'CONCRETE', 'ROOFTOP', '65 X 65', ST_SetSRID(ST_MakePoint(-79.9856, 40.4361), 4326), 'Level 1 Trauma / Burn Center'),[span_48](start_span)[span_48](end_span)[span_49](start_span)[span_49](end_span)[span_50](start_span)[span_50](end_span)`  
`('UPMC Children''s Hospital of Pittsburgh', '30PN', 'PITTSBURGH', 'PA', 1088, 'CONCRETE', 'ROOFTOP', '45 X 45', ST_SetSRID(ST_MakePoint(-79.9531, 40.4678), 4326), 'Pediatric Level 1 Trauma'),[span_51](start_span)[span_51](end_span)[span_52](start_span)[span_52](end_span)[span_53](start_span)[span_53](end_span)`  
`('Allegheny General Hospital', '42PN', 'PITTSBURGH', 'PA', 804, 'CONCRETE', 'ROOFTOP', '65 X 65', ST_SetSRID(ST_MakePoint(-80.0042, 40.4563), 4326), 'Level 1 Trauma Center'),[span_54](start_span)[span_54](end_span)[span_55](start_span)[span_55](end_span)[span_56](start_span)[span_56](end_span)[span_57](start_span)[span_57](end_span)`  
`('UPMC Hamot', '0PS8', 'ERIE', 'PA', 900, 'CONCRETE', 'ROOFTOP', '60 X 65', ST_SetSRID(ST_MakePoint(-80.0853, 42.1358), 4326), 'Level 2 Trauma Center'),[span_58](start_span)[span_58](end_span)[span_59](start_span)[span_59](end_span)[span_60](start_span)[span_60](end_span)`  
`('UPMC Altoona', '74PN', 'ALTOONA', 'PA', 1259, 'CONCRETE', 'ROOFTOP', '65 X 65', ST_SetSRID(ST_MakePoint(-78.4022, 40.5186), 4326), 'Level 2 Trauma Center'),[span_61](start_span)[span_61](end_span)[span_62](start_span)[span_62](end_span)[span_63](start_span)[span_63](end_span)[span_64](start_span)[span_64](end_span)`  
`('Penn Highlands DuBois', 'PA10', 'DUBOIS', 'PA', 1463, 'CONCRETE', 'GROUND', '32 X 32', ST_SetSRID(ST_MakePoint(-78.7511, 41.1189), 4326), 'Regional Trauma Center'),[span_65](start_span)[span_65](end_span)[span_66](start_span)[span_66](end_span)[span_67](start_span)[span_67](end_span)`  
`('Butler Memorial Hospital', 'PA41', 'BUTLER', 'PA', 1190, 'ASPHALT', 'GROUND', '65 X 65', ST_SetSRID(ST_MakePoint(-79.8925, 40.8672), 4326), 'Acute Care Center'),[span_68](start_span)[span_68](end_span)[span_69](start_span)[span_69](end_span)[span_70](start_span)[span_70](end_span)`  
`('Clarion Hospital', '91PA', 'CLARION', 'PA', 1489, 'CONCRETE', 'GROUND', '50 X 50', ST_SetSRID(ST_MakePoint(-79.3850, 41.1925), 4326), 'Acute Care Center');[span_71](start_span)[span_71](end_span)[span_72](start_span)[span_72](end_span)[span_73](start_span)[span_73](end_span)[span_74](start_span)[span_74](end_span)`

## **7\. CI/CD & Production Build Specifications**

### **7.1 GitHub Actions CI/CD Pipeline (.github/workflows/ci-cd.yml)**

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

## **Document Sign-Off & Verification**

**Authored By:** Chief Technical Architect, Virtual HEMS Development Group **Approved By:** Directorate of Technical Operations & Flight Safety **Repository Distribution:** virtualhems-monorepo/docs/ARCHITECTURE.md