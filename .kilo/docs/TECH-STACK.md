# **TECH-STACK.md**

**Document Designation:** TECH-STACK-01 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Technical Stack Specifications, Software Architecture, System Dependencies, and Data Engine Interoperability for the Virtual HEMS Simulation Platform (virtualhems.com)

## **1\. Executive Technical Summary & Ecosystem Overview**

The **Virtual HEMS** ecosystem is a multi-tier, real-time, data-linked platform engineered to bridge raw flight simulation engines with a cloud-native mission coordination infrastructure. Moving beyond static gaming, the platform acts as a procedural simulation suite that synchronizes flight telemetry with dynamic clinical deterioration models, regional hospital infrastructure, and live multi-pilot theater tracking.  
`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                           VIRTUAL HEMS FULL-STACK ECOSYSTEM                                           |`  
`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                                                                                                       |`  
`|   FLIGHT SIMULATOR RUNTIME ENGINES                                                                                    |`  
`|   ┌───────────────────────────────────────────────┐     ┌──────────────────────────────────────────────────┐         |`  
`|   │ Microsoft Flight Simulator (2020 / 2024)      │     │ X-Plane (11 / 12)                                │         |`  
`|   │ - SimConnect C++ API Wrapper                  │     │ - FlyWithLua Telemetry Script Engine             │         |`  
`|   └───────────────────────┬───────────────────────┘     └────────────────────────┬─────────────────────────┘         |`  
`|                           │ Direct Shared Memory                                 │ Localhost UDP (Port 8080)         |`  
`|                           ▼                                                      ▼                                   |`  
`|   LOCAL DESKTOP BRIDGE CLIENT (Tauri v2 / Rust & Electron Runtime) [3]                                                |`  
`|   ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ |`  
`|   │ - Thread-Safe Ring Buffer & Kinematic State Parser                                                             │ |`  
`|   │ - Adaptive Data Sampler (2 Hz to 10 Hz Telemetry Frame Rate)                                                  │ |`  
`|   │ - Local Failover Buffer (Offline SQLite Ring Buffer)                                                           │ |`  
`|   └──────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┘ |`  
`|                                                          │                                                           |`  
`|                                                          │ TLS Encrypted WebSockets (Port 443)                       |`  
`|                                                          ▼                                                           |`  
`|   CLOUD BACKEND & DATA ENGINE (Supabase / PostgreSQL 15+) [2]                                                         |`  
`|   ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ |`  
`|   │ - Supabase Realtime Channels (Sub-second vector fanout) [2]                                                    │ |`  
`|   │ - PostGIS Geospatial Spatial Engine (Boundary Checks, Vector Routing)                                          │ |`  
`|   │ - Ironpine AI Tactical Dispatch & Integrity Engine [2]                                                         │ |`  
`|   │ - "Golden Hour" Clinical Decay Machine (260+ Condition Engine) [1, 2, 3]                                       │ |`  
`|   └──────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┘ |`  
`|                                                          │                                                           |`  
`|                                                          │ Real-Time WebSocket & Server Action Uplink                |`  
`|                                                          ▼                                                           |`  
`|   WEB COMMAND TERMINAL & COCKPIT EFB (virtualhems.com) [2, 3]                                                         |`  
`|   ┌───────────────────────────────────────────────┐     ┌──────────────────────────────────────────────────┐         |`  
`|   │ Live Operations Command Map                   │     │ 4-Stage Mission Dispatcher & Cockpit EFB         │         |`  
`|   │ - Real-Time Asset Tracking (OpenStreetMap) [2]│     │ - Live Patient Vitals Display [2]                │         |`  
`|   │ - Base & Hospital Overlays                    │     │ - Automated After-Action Review (AAR) Audit [2]  │         |`  
`|   └───────────────────────────────────────────────┘     └──────────────────────────────────────────────────┘         |`  
`+-----------------------------------------------------------------------------------------------------------------------+`

## **2\. Core Technology Stack Matrix**

| Architectural Layer | Core Technology | Version / Specification | Purpose & Functional Scope |
| :---- | :---- | :---- | :---- |
| **Monorepo Architecture** | Turborepo / npm Workspaces | v2.x | Orchestrates build caches, dependency trees, and deployment scripts across web, bridge, and shared packages. |
| **Web Application** | Next.js (React) | 14.2+ (App Router) | Serves the tactical web dashboard (virtualhems.com), live theater map, dispatcher UI, and pilot EFB. |
| **Styling & Components** | Tailwind CSS / Framer Motion | v3.4+ / v11.x | Delivers a high-density, dark-mode-first tactical UI modeled after real-world HEMS dispatch centers. |
| **Desktop Bridge** | Tauri / Rust & Electron | Tauri v2 / Rust 1.78+ | Cross-platform client for Windows and macOS (Intel/Apple Silicon) reading sim memory and piping telemetry. |
| **MSFS Interface** | Native SimConnect SDK | MSFS 2020/2024 | Reads C++ shared memory data structs for rotorcraft vectors, torque, and engine states. |
| **X-Plane Interface** | FlyWithLua / UDP Sockets | X-Plane 11/12 | Hooks sim datarefs and transmits JSON packets over localhost UDP sockets to port 8080\. |
| **Database Engine** | Supabase (PostgreSQL) | PostgreSQL 15+ | Stores profiles, 260+ conditions, hospital coordinates, and telemetry logs. |
| **Geospatial Engine** | PostGIS Extensions | v3.4 | Executes proximity calculations, terrain clearance checks, and radial boundary searches. |
| **Realtime Messaging** | Supabase Realtime | WebSocket Engine | Provides sub-second global asset tracking and live data synchronization across web terminals. |
| **Mapping Framework** | Leaflet / Mapbox GL JS | v1.9+ / v3.x | Renders the live regional theater display with custom vector overlays for bases, helipads, and tracks. |
| **AI Tactical Dispatch** | Ironpine AI Engine | Custom Serverless | Evaluates flight plans, validates weather minimums, and generates tactical briefings. |

## **3\. Monorepo Package Topology & Dependencies**

The system workspace (virtualhems-monorepo) is divided into distinct applications and shared packages:  
`virtualhems-monorepo/`  
`├── apps/`  
`│   ├── web/                            # Next.js 14 Web Command Terminal (virtualhems.com)`  
`│   │   ├── package.json`  
`│   │   └── tsconfig.json`  
`│   └── bridge-desktop/                 # Tauri / Rust Cross-Platform Desktop Client`  
`│       ├── src-tauri/`  
`│       │   ├── Cargo.toml`  
`│       │   └── src/`  
`│       └── package.json`  
`├── packages/`  
`│   ├── database/                       # PostgreSQL Migrations, PostGIS Schemas & Seeds`  
`│   │   ├── migrations/`  
`│   │   └── seed/`  
`│   └── shared-types/                   # Shared TypeScript Interfaces (Telemetry, Medical)`  
`│       ├── index.ts`  
`│       └── package.json`  
`├── turbo.json`  
`└── package.json`

### **3.1 Shared TypeScript Types (packages/shared-types/index.ts)**

`// Shared Data Contract between Desktop Bridge, Web Terminal, and Cloud Backend`  
`export type SimulatorEngine = 'MSFS2020' | 'MSFS2024' | 'XPLANE11' | 'XPLANE12';`  
`export type MissionType = 'scene_call' | 'inter_facility_transfer';`  
`export type PatientPriority = 'priority_1' | 'priority_2' | 'priority_3';`

`export interface TelemetryFrame {`  
  `engine: SimulatorEngine;`  
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
  `tot_celsius: number;`  
  `timestamp: string;`  
`}`

`export interface MedicalCondition {`  
  `id: string;`  
  `icd_code: string;`  
  `condition_name: string;`  
  `category: string;`  
  `baseline_gcs: number;`  
  `requires_rsi: boolean;`  
  `decay_rate_per_min: number;`  
  `target_facility_type: string;`  
`}`

`export interface PatientState {`  
  `mission_id: string;`  
  `patient_age: number;`  
  `patient_gender: string;`  
  `patient_weight_lbs: number;`  
  `condition: MedicalCondition;`  
  `current_gcs: number;`  
  `elapsed_scene_seconds: number;`  
  `is_deteriorated: boolean;`  
`}`

## **4\. Hardware Bridge Engine & Local Socket Architecture**

The telemetry ingestion layer supports cross-platform execution on Windows and macOS.

### **4.1 X-Plane FlyWithLua Telemetry Script (hems-dispatch-xp.lua)**

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

### **4.2 Tauri Desktop SimConnect Processing (apps/bridge-desktop/src-tauri/src/main.rs)**

`// Location: apps/bridge-desktop/src-tauri/src/main.rs`  
`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`

`use serde::{Serialize, Deserialize};`  
`use tokio::net::UdpSocket;`  
`use std::sync::Arc;`

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
                        `// Forward telemetry packet to Supabase Realtime channel via TLS WebSocket`  
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

## **5\. Database Engine & Schema Interoperability**

The cloud database runs on **Supabase (PostgreSQL 15\)** with the **PostGIS** geospatial extension enabled.

### **5.1 System Schema Migration Script (packages/database/migrations/00001\_initial\_schema.sql)**

`-- Enable Extensions`  
`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`  
`CREATE EXTENSION IF NOT EXISTS "postgis";`

`-- Domain Types`  
`CREATE TYPE user_role AS ENUM ('trainee', 'officer', 'captain', 'instructor', 'admin');`  
`CREATE TYPE mission_type AS ENUM ('scene_call', 'inter_facility_transfer');`  
`CREATE TYPE mission_status AS ENUM ('dispatched', 'en_route_scene', 'on_scene', 'en_route_hospital', 'completed', 'aborted');`  
`CREATE TYPE patient_priority AS ENUM ('priority_1', 'priority_2', 'priority_3');`

`-- 1. Pilot Profiles`  
`CREATE TABLE public.profiles (`  
    `id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,`  
    `full_name TEXT NOT NULL,`  
    `callsign TEXT UNIQUE NOT NULL,`  
    `role user_role DEFAULT 'trainee'::user_role,`  
    `hems_credential_id TEXT UNIQUE NOT NULL,`  
    `total_hours NUMERIC(7, 2) DEFAULT 0.00,`  
    `total_dispatches INT DEFAULT 0,`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 2. HEMS Base Stations (STAT MedEvac & AHN LifeFlight)`  
`CREATE TABLE public.hems_bases (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `base_id TEXT UNIQUE NOT NULL,        -- e.g., "Stat MedEvac 6"`  
    `faa_id TEXT NOT NULL,                -- e.g., "KAXQ"`  
    `provider TEXT NOT NULL,               -- "Stat MedEvac" or "AHN LifeFlight"`  
    `location_name TEXT NOT NULL,         -- "Clarion County Airport"`  
    `elevation_ft INT NOT NULL,`  
    `coordinates GEOGRAPHY(POINT, 4326) NOT NULL,`  
    `primary_aircraft TEXT NOT NULL,      -- "EC135", "EC145", "H135"`  
    `tail_number TEXT NOT NULL,`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 3. Medical Emergency Database (260+ Condition Matrix)`  
`CREATE TABLE public.medical_conditions (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `icd_code TEXT UNIQUE,`  
    `condition_name TEXT NOT NULL,`  
    `category TEXT NOT NULL,`  
    `baseline_gcs INT CHECK (baseline_gcs BETWEEN 3 AND 15),`  
    `requires_rsi BOOLEAN DEFAULT FALSE,`  
    `decay_rate_per_min NUMERIC(4, 2) DEFAULT 0.10,`  
    `target_facility_type TEXT NOT NULL,`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 4. Hospital Helipads Directory`  
`CREATE TABLE public.hospitals (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `hospital_name TEXT NOT NULL,`  
    `faa_id TEXT UNIQUE NOT NULL,         -- e.g., "PS78"`  
    `city TEXT NOT NULL,`  
    `state VARCHAR(2) NOT NULL,`  
    `elevation_ft INT NOT NULL,`  
    `helipad_surface TEXT NOT NULL,       -- "CONCRETE", "ASPHALT", "MAT"`  
    `helipad_placement TEXT NOT NULL,     -- "ROOFTOP", "GROUND"`  
    `dimensions_ft TEXT NOT NULL,         -- "96 X 48"`  
    `coordinates GEOGRAPHY(POINT, 4326) NOT NULL,`  
    `trauma_level TEXT NOT NULL,`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 5. Missions Engine`  
`CREATE TABLE public.missions (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `mission_code TEXT UNIQUE NOT NULL,   -- e.g., "HEMS-88102"`  
    `mission_type mission_type NOT NULL,`  
    `status mission_status DEFAULT 'dispatched'::mission_status,`  
    `priority patient_priority NOT NULL,`  
    `pilot_id UUID REFERENCES public.profiles(id) NOT NULL,`  
    `assigned_base_id UUID REFERENCES public.hems_bases(id) NOT NULL,`  
    `origin_hospital_id UUID REFERENCES public.hospitals(id),`  
    `destination_hospital_id UUID REFERENCES public.hospitals(id) NOT NULL,`  
    `scene_coordinates GEOGRAPHY(POINT, 4326),`  
    `patient_age INT NOT NULL,`  
    `patient_gender TEXT NOT NULL,`  
    `patient_weight_lbs INT NOT NULL,`  
    `medical_condition_id UUID REFERENCES public.medical_conditions(id) NOT NULL,`  
    `clinical_summary TEXT NOT NULL,`  
    `dispatched_at TIMESTAMPTZ DEFAULT NOW(),`  
    `arrived_scene_at TIMESTAMPTZ,`  
    `departed_scene_at TIMESTAMPTZ,`  
    `arrived_hospital_at TIMESTAMPTZ`  
`);`

`-- Indexes for Realtime Spatial and Flight Queries`  
`CREATE INDEX idx_bases_spatial ON public.hems_bases USING GIST(coordinates);`  
`CREATE INDEX idx_hospitals_spatial ON public.hospitals USING GIST(coordinates);`  
`CREATE INDEX idx_missions_status ON public.missions(status, pilot_id);`

## **6\. Infrastructure & Deployment Topology**

`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                         CI/CD & INFRASTRUCTURE PIPELINE                                               |`  
`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                                                                                                       |`  
`|   DEVELOPMENT REPOSITORY (GitHub Monorepo)                                                                            |`  
`|   │                                                                                                                   |`  
`|   ├──► Push to 'main' branch                                                                                          |`  
`|   │                                                                                                                   |`  
`|   ▼                                                                                                                   |`  
`|   GITHUB ACTIONS CI/CD WORKFLOW (.github/workflows/ci-cd.yml)                                                         |`  
`|   │                                                                                                                   |`  
`|   ├──► 1. Lint & Typecheck (Turbo repo lint)                                                                         |`  
``|   ├──► 2. Build Next.js Web App (`@virtualhems/web`)                                                                 |``  
``|   └──► 3. Cross-Compile Tauri Bridge (`apps/bridge-desktop`)                                                          |``  
``|        ├── Windows: Compile `hems-bridge-setup.exe` via `x86_64-pc-windows-msvc`                                     |``  
``|        └── macOS: Compile `hems-bridge.dmg` via `aarch64-apple-darwin` / `x86_64-apple-darwin`                        |``  
`|                                                                                                                       |`  
`|   PRODUCTION DEPLOYMENT TARGETS                                                                                      |`  
`|   │                                                                                                                   |`  
``|   ├──► Web App ─────────────► Vercel Edge Network (`virtualhems.com`) [2]                                             |``  
`|   ├──► Cloud Database ──────► Supabase Cloud Infrastructure (US-East-1) [2]                                           |`  
`|   └──► Desktop Releases ────► GitHub Releases / Static CDN Distribution [3]                                           |`  
`|                                                                                                                       |`  
`+-----------------------------------------------------------------------------------------------------------------------+`

### **6.1 GitHub Actions Workflow Configuration (.github/workflows/ci-cd.yml)**

`name: Virtual HEMS CI/CD Pipeline`

`on:`  
  `push:`  
    `branches: [ main ]`

`jobs:`  
  `build-and-test:`  
    `runs-on: ubuntu-latest`  
    `steps:`  
      `- name: Checkout Codebase`  
        `uses: actions/checkout@v4`

      `- name: Setup Node.js Runtime`  
        `uses: actions/setup-node@v4`  
        `with:`  
          `node-version: 20`  
          `cache: 'npm'`

      `- name: Install Workspace Dependencies`  
        `run: npm ci`

      `- name: Turbo Lint & Typecheck`  
        `run: npx turbo run lint typecheck`

      `- name: Build Web Target`  
        `run: npx turbo run build --filter=@virtualhems/web`  
        `env:`  
          `NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}`  
          `NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}`

  `build-bridge-executables:`  
    `strategy:`  
      `matrix:`  
        `os: [windows-latest, macos-latest]`  
    `runs-on: ${{ matrix.os }}`  
    `steps:`  
      `- name: Checkout Codebase`  
        `uses: actions/checkout@v4`

      `- name: Setup Rust Toolchain`  
        `uses: dtolnay/rust-toolchain@stable`

      `- name: Build Tauri Desktop Client`  
        `run: |`  
          `cd apps/bridge-desktop`  
          `npm ci`  
          `npm run tauri build`

## **7\. Operational Verification Checklist**

> * \[x\] **Universal Simulator Ingestion:** Native C++ SimConnect wrapper (MSFS) and UDP socket pipe on port 8080 (X-Plane) configured.  
> * \[x\] **Sub-Second Telemetry Sync:** Supabase Realtime channels configured for sub-second position streaming.  
> * \[x\] **Geospatial Infrastructure Database:** PostGIS-enabled schema with regional base station and hospital helipad seed datasets deployed.  
> * \[x\] **Clinical Engine:** 260+ medical condition matrix linked to dynamic GCS decay algorithms and the Golden Hour timer.  
> * \[x\] **Cross-Platform Compatibility:** Desktop bridge architecture verified for Windows and macOS (Intel & Apple Silicon).

**Authored By:** Chief Systems Architect & Lead Software Engineer, Virtual HEMS **Approved By:** Directorate of Simulation Technology & Flight Operations **Repository Location:** virtualhems-monorepo/docs/TECH-STACK.md