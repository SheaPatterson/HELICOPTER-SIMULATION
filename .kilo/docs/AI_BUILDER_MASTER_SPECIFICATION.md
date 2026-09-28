# **AI\_BUILDER\_MASTER\_SPECIFICATION.md**

**Document Designation:** AI-BUILDER-SPEC-01 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Technical Blueprint, File Architecture, Data Schemas, Implementation Phases, and Feature Specifications for the Virtual HEMS Platform Development

## **1\. Executive Summary & Build Philosophy**

### **1.1 Scope & Purpose**

This document provides an exhaustive, production-ready specification for an automated AI Builder or development team to construct the complete **Virtual HEMS** ecosystem. Virtual HEMS is a professional-grade flight following, medical simulation, and mission coordination platform integrating Microsoft Flight Simulator (2020/2024) and X-Plane (11/12) with a cloud-native web infrastructure.  
`+-----------------------------------------------------------------------------------+`  
`|                        VIRTUAL HEMS PLATFORM ARCHITECTURE                         |`  
`+-----------------------------------------------------------------------------------+`  
`|  FLIGHT SIMULATOR LAYER                                                           |`  
`|  [ MSFS 2020 / 2024 ] (SimConnect)  │  [ X-Plane 11 / 12 ] (Lua / Custom UDP) [3]  |`  
`+----------------─────────────────────┼─────────────────────────────────────────────+`  
`|  LOCAL BRIDGE LAYER                 │                                             |`  
`|  [ Windows Desktop App (.exe) ]     │  [ macOS Standalone Client (.dmg) ] [3, 10]   |`  
`+----------------─────────────────────┼─────────────────────────────────────────────+`  
`|  CLOUD BACKEND LAYER                │                                             |`  
`|  [ Supabase Realtime DB ]           │  [ Ironpine AI Tactical Dispatch Engine ] [2]|`  
`+----------------─────────────────────┼─────────────────────────────────────────────+`  
`|  WEB APPLICATION / EFB TERMINAL     │                                             |`  
`|  [ Live Operations Command ]        │  [ Mission Planner & Medical Matrix ] [2, 8]|`  
`+-----------------------------------------------------------------------------------+`

### **1.2 Non-Negotiable Technical Mandates**

> * **Zero-Truncation Policy:** All code modules, SQL migrations, API specifications, and interface components must be fully fleshed out with complete error handling, logging, and type definitions.  
> * **Multi-Engine Compatibility:** Absolute cross-platform synchronization between MSFS 2020/2024 (via native C++ / C\# SimConnect wrappers) and X-Plane 11/12 (via FlyWithLua scripts feeding local UDP bridge sockets).  
> * **High-Fidelity Clinical Logic:** Real-time physiological deterioration models tracking 260+ conditions, Glasgow Coma Scale (GCS) shifts, and time-critical "Golden Hour" timers.  
> * **Sub-Second Latency Telemetry:** Real-time state synchronization via WebSocket/Supabase channels operating at \\ge 1\\text{ Hz} update rates.

## **2\. Directory Structure & File Architecture**

The repository MUST be organized according to the following strict directory layout. Every file listed must be created in its respective phase.  
`virtualhems-monorepo/`  
`├── .github/`  
`│   └── workflows/`  
`│       ├── ci-cd.yml`  
`│       └── bridge-build.yml`  
`├── docs/`  
`│   ├── ARCHITECTURE.md`  
`│   ├── VHOP-01-SOP.md`  
`│   ├── VHOP-02-SYSTEMS.md`  
`│   ├── VHOP-03-DYNAMICS.md`  
`│   └── VHOP-04-CLINICAL.md`  
`├── apps/`  
`│   ├── web/                         # Next.js 14+ Application (virtualhems.com)`  
`│   │   ├── src/`  
`│   │   │   ├── app/`  
`│   │   │   │   ├── (auth)/`  
`│   │   │   │   │   ├── login/page.tsx`  
`│   │   │   │   │   └── register/page.tsx`  
`│   │   │   │   ├── (dashboard)/`  
`│   │   │   │   │   ├── command/page.tsx`  
`│   │   │   │   │   ├── dispatcher/page.tsx`  
`│   │   │   │   │   ├── logbook/page.tsx`  
`│   │   │   │   │   ├── tracking/page.tsx`  
`│   │   │   │   │   ├── archive/page.tsx`  
`│   │   │   │   │   └── sms-report/page.tsx`  
`│   │   │   │   ├── api/`  
`│   │   │   │   │   ├── dispatch/route.ts`  
`│   │   │   │   │   ├── telemetry/route.ts`  
`│   │   │   │   │   ├── medical/route.ts`  
`│   │   │   │   │   └── aar/route.ts`  
`│   │   │   │   └── layout.tsx`  
`│   │   │   ├── components/`  
`│   │   │   │   ├── map/`  
`│   │   │   │   │   ├── TheaterMap.tsx`  
`│   │   │   │   │   ├── AssetMarker.tsx`  
`│   │   │   │   │   └── LZOverlay.tsx`  
`│   │   │   │   ├── dispatch/`  
`│   │   │   │   │   ├── Step1Details.tsx`  
`│   │   │   │   │   ├── Step2Crew.tsx`  
`│   │   │   │   │   ├── Step3PatientInfo.tsx`  
`│   │   │   │   │   └── Step4FlightPlan.tsx`  
`│   │   │   │   └── ui/`  
`│   │   │   ├── hooks/`  
`│   │   │   │   ├── useTelemetry.ts`  
`│   │   │   │   └── useGoldenHour.ts`  
`│   │   │   └── lib/`  
`│   │   │       ├── supabase/`  
`│   │   │       └── ironpine-ai.ts`  
`│   │   ├── package.json`  
`│   │   └── tsconfig.json`  
`│   │`  
`│   ├── bridge-desktop/             # Electron / Tauri Cross-Platform Client`  
`│   │   ├── src-tauri/`  
`│   │   │   ├── src/`  
`│   │   │   │   ├── main.rs`  
`│   │   │   │   ├── simconnect/`  
`│   │   │   │   │   ├── mod.rs`  
`│   │   │   │   │   └── data_structures.rs`  
`│   │   │   │   ├── xplane_udp/`  
`│   │   │   │   │   ├── mod.rs`  
`│   │   │   │   │   └── receiver.rs`  
`│   │   │   │   └── telemetry_uploader.rs`  
`│   │   │   └── Cargo.toml`  
`│   │   └── package.json`  
`│   │`  
`│   └── plugins/`  
`│       └── xplane-lua/`  
`│           └── hems-dispatch-xp.lua # FlyWithLua Telemetry Uplink Script`  
`│`  
`├── packages/`  
`│   ├── database/                    # Shared Supabase / PostgreSQL Engine`  
`│   │   ├── migrations/`  
`│   │   │   ├── 00001_initial_schema.sql`  
`│   │   │   ├── 00002_medical_conditions.sql`  
`│   │   │   ├── 00003_regional_bases.sql`  
`│   │   │   └── 00004_telemetry_rls.sql`  
`│   │   └── seed/`  
`│   │       ├── bases.seed.sql`  
`│   │       ├── hospitals.seed.sql`  
`│   │       └── conditions.seed.sql`  
`│   │`  
`│   └── shared-types/                # TypeScript Interfaces across Web/Bridge`  
`│       ├── index.ts`  
`│       ├── telemetry.ts`  
`│       ├── medical.ts`  
`│       └── dispatch.ts`  
`│`  
`├── turbo.json`  
`└── README.md`

## **3\. Database Schema & Migration Specifications**

The database engine runs on **Supabase (PostgreSQL 15+)** with Realtime subscriptions enabled on active telemetry and communication channels.

### **3.1 Migration File: 00001\_initial\_schema.sql**

`-- Enable necessary extensions`  
`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`  
`CREATE EXTENSION IF NOT EXISTS "postgis";`

`-- Enum Definitions`  
`CREATE TYPE user_role AS ENUM ('trainee', 'officer', 'captain', 'instructor', 'admin');`  
`CREATE TYPE mission_type AS ENUM ('scene_call', 'inter_facility_transfer');`  
`CREATE TYPE mission_status AS ENUM ('dispatched', 'en_route_scene', 'on_scene', 'en_route_hospital', 'completed', 'aborted');`  
`CREATE TYPE patient_priority AS ENUM ('priority_1', 'priority_2', 'priority_3');`  
`CREATE TYPE aircraft_status AS ENUM ('active_duty', 'maintenance', 'decommissioned');`

`-- 1. Profiles Table`  
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

`-- 2. HEMS Bases Table`  
`CREATE TABLE public.hems_bases (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `base_id TEXT UNIQUE NOT NULL, -- e.g. "Stat MedEvac 6"`  
    `faa_id TEXT NOT NULL,         -- e.g. "KAXQ"`  
    `provider_name TEXT NOT NULL,  -- "Stat MedEvac" or "AHN LifeFlight"`  
    `location_name TEXT NOT NULL,  -- "Clarion County Airport"`  
    `elevation_ft INT NOT NULL,`  
    `coordinates GEOGRAPHY(POINT, 4326) NOT NULL,`  
    `primary_aircraft_type TEXT NOT NULL, -- "EC135", "EC145", "H135"`  
    `tail_number TEXT NOT NULL,`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 3. Medical Conditions Database (260+ Matrix)`  
`CREATE TABLE public.medical_conditions (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `icd_code TEXT UNIQUE,`  
    `condition_name TEXT NOT NULL,`  
    `category TEXT NOT NULL, -- "Trauma", "Cardiac", "Neurological", "Pediatric"`  
    `baseline_gcs INT CHECK (baseline_gcs BETWEEN 3 AND 15),`  
    `requires_rsi BOOLEAN DEFAULT FALSE,`  
    `deterioration_rate_per_min NUMERIC(4, 2) DEFAULT 0.10,`  
    `recommended_facility_type TEXT NOT NULL, -- "Level 1 Trauma", "Comprehensive Stroke", etc.`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 4. Hospital Helipads & Facilities`  
`CREATE TABLE public.hospitals (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `hospital_name TEXT NOT NULL,`  
    `faa_id TEXT UNIQUE NOT NULL, -- e.g. "PS78"`  
    `city TEXT NOT NULL,`  
    `state VARCHAR(2) NOT NULL,`  
    `elevation_ft INT NOT NULL,`  
    `helipad_surface TEXT NOT NULL, -- "CONCRETE", "ASPHALT", "MAT"`  
    `helipad_placement TEXT NOT NULL, -- "ROOFTOP", "GROUND"`  
    `dimensions_ft TEXT NOT NULL, -- "96 X 48"`  
    `coordinates GEOGRAPHY(POINT, 4326) NOT NULL,`  
    `trauma_level TEXT NOT NULL, -- "Level 1 Trauma Center", "Level 2", etc.`  
    `created_at TIMESTAMPTZ DEFAULT NOW()`  
`);`

`-- 5. Missions Table`  
`CREATE TABLE public.missions (`  
    `id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`  
    `mission_code TEXT UNIQUE NOT NULL, -- e.g. "HEMS-295208"`  
    `mission_type mission_type NOT NULL,`  
    `status mission_status DEFAULT 'dispatched'::mission_status,`  
    `priority patient_priority NOT NULL,`  
    `pilot_id UUID REFERENCES public.profiles(id) NOT NULL,`  
    `assigned_base_id UUID REFERENCES public.hems_bases(id) NOT NULL,`  
    `origin_hospital_id UUID REFERENCES public.hospitals(id), -- Nullable for scene calls`  
    `destination_hospital_id UUID REFERENCES public.hospitals(id) NOT NULL,`  
    `scene_coordinates GEOGRAPHY(POINT, 4326), -- Nullable for transfers`  
      
    `-- Patient Clinical Payload`  
    `patient_age INT NOT NULL,`  
    `patient_gender TEXT NOT NULL,`  
    `patient_weight_lbs INT NOT NULL,`  
    `medical_condition_id UUID REFERENCES public.medical_conditions(id) NOT NULL,`  
    `clinical_summary TEXT NOT NULL,`  
    `stabilizing_interventions TEXT,`  
      
    `-- Timestamps for Golden Hour Engine`  
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
    `simulator_engine TEXT NOT NULL, -- "MSFS2020", "MSFS2024", "XPLANE11", "XPLANE12"`  
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

`-- Indexing for High-Performance Realtime Geospatial Queries`  
`CREATE INDEX idx_telemetry_mission ON public.flight_telemetry(mission_id, timestamp DESC);`  
`CREATE INDEX idx_bases_geo ON public.hems_bases USING GIST(coordinates);`  
`CREATE INDEX idx_hospitals_geo ON public.hospitals USING GIST(coordinates);`

## **4\. Hardware Bridge Engineering & API Specifications**

The hardware bridge connects flight simulators to virtualhems.com via a dual architecture:

> 1. **MSFS 2020/2024:** C++/Rust Tauri Desktop Application interfacing with SimConnect.dll.  
> 2. **X-Plane 11/12:** FlyWithLua script piping UDP sockets locally to the Tauri Bridge.

`+-----------------------------------------------------------------------------------+`  
`|                        HARDWARE BRIDGE COMMUNICATIONS SPEC                        |`  
`+-----------------------------------------------------------------------------------+`  
`|  MSFS (SimConnect) ──► Tauri Rust Native Thread  ──┐                              |`  
`|                                                   ├──► WebSocket Uplink ──► Cloud |`  
`|  X-Plane (FlyWithLua) ─► Localhost UDP (Port 8080)┘    (TLS / HTTPS)    Supabase |`  
`+-----------------------------------------------------------------------------------+`

### **4.1 X-Plane FlyWithLua Telemetry Uplink Script (hems-dispatch-xp.lua)**

`-- Virtual HEMS X-Plane Telemetry Pipe v5.3`  
`-- File: plugins/xplane-lua/hems-dispatch-xp.lua`

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

`function send_hems_telemetry()`  
    `local now = os.clock()`  
    `if now - last_send >= 0.5 then -- 2 Hz Transmission Frequency`  
        `last_send = now`  
          
        `local payload = string.format(`  
            `'{"engine":"XPLANE","lat":%.7f,"lon":%.7f,"alt_msl":%d,"agl":%d,"gs":%d,"heading":%d,"vs":%d,"pitch":%.1f,"roll":%.1f,"fuel_lbs":%.1f,"torque":%.1f}',`  
            `lat,`  
            `lon,`  
            `math.floor(alt_msl * 3.28084), -- Convert M to FT`  
            `math.floor(agl * 3.28084),`  
            `math.floor(gs * 1.94384),     -- Convert m/s to KTS`  
            `math.floor(heading),`  
            `math.floor(vs * 196.85),       -- Convert m/s to FPM`  
            `pitch,`  
            `roll,`  
            `fuel_total * 2.20462,          -- Convert kg to LBS`  
            `trq`  
        `)`  
          
        `udp:sendto(payload, host, port)`  
    `end`  
`end`

`do_often("send_hems_telemetry()")`

### **4.2 Rust Tauri SimConnect Interface (src-tauri/src/simconnect/mod.rs)**

`// File: bridge-desktop/src-tauri/src/simconnect/mod.rs`  
`use serde::{Serialize, Deserialize};`  
`use std::time::Duration;`

`#[derive(Debug, Serialize, Deserialize, Clone)]`  
`pub struct HemsSimTelemetry {`  
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

`pub struct SimConnectBridge {`  
    `pub is_connected: bool,`  
    `pub api_key: String,`  
`}`

`impl SimConnectBridge {`  
    `pub fn new(api_key: String) -> Self {`  
        `Self {`  
            `is_connected: false,`  
            `api_key,`  
        `}`  
    `}`

    `pub async fn start_polling_loop<F>(&mut self, callback: F)`  
    `where`  
        `F: Fn(HemsSimTelemetry) + Send + Sync + 'static,`  
    `{`  
        `// Mock polling loop structure for SimConnect DLL bindings`  
        `tokio::spawn(async move {`  
            `loop {`  
                `tokio::time::sleep(Duration::from_millis(500)).await;`  
                `// In production, execute SimConnect_CallDispatch and map Struct`  
            `}`  
        `});`  
    `}`  
`}`

## **5\. Web UI & EFB Module Specifications**

The web application is constructed using **Next.js 14+ (App Router)**, **Tailwind CSS**, **Framer Motion**, and **Leaflet / Mapbox GL** for real-time tracking.

### **5.1 Mission Dispatcher Component (apps/web/src/components/dispatch/Step3PatientInfo.tsx)**

`// File: apps/web/src/components/dispatch/Step3PatientInfo.tsx`  
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

  `const handleAiTacticalBriefing = async () => {`  
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
      `console.error('Failed to generate AI briefing', err);`  
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
        `onClick={handleAiTacticalBriefing}`  
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

## **6\. Development Phasing & Build Schedule**

The builder AI must execute implementation across four rigid, sequential phases.  
`+-----------------------------------------------------------------------------------+`  
`|                        FOUR-PHASE EXECUTION ROADMAP                               |`  
`+-----------------------------------------------------------------------------------+`  
`|  PHASE 1: FOUNDATION & INFRASTRUCTURE                                             |`  
`|  - Supabase PostgreSQL schema, migrations, and seed datasets [2, 3]               |`  
`|  - Shared TypeScript types & Monorepo Configuration                               |`  
`+-----------------------------------------------------------------------------------+`  
`|  PHASE 2: HARDWARE BRIDGE & TELEMETRY ENGINE                                      |`  
`|  - Rust Tauri Desktop Client & SimConnect DLL integration [3]                     |`  
`|  - FlyWithLua X-Plane socket pipeline [3, 10]                                     |`  
`|  - Supabase Realtime WebSocket streaming link [2, 3]                              |`  
`+-----------------------------------------------------------------------------------+`  
`|  PHASE 3: DISPATCH, CLINICAL MATRIX & EFB MODULES                                 |`  
`|  - Next.js Web App dashboard & live command map [2, 3]                            |`  
`|  - 4-Stage Mission Planner & Ironpine AI Tactical Dispatch Engine [2, 8]          |`  
`|  - Dynamic "Golden Hour" decay algorithm & After-Action Review (AAR) [3]          |`  
`+-----------------------------------------------------------------------------------+`  
`|  PHASE 4: REGIONAL DATA & VERIFICATION                                            |`  
`|  - Western PA / Tri-State Base & Hospital Database Insertion [3, 11]              |`  
`|  - Automated End-to-End Test Suite & Verification Audit                           |`  
`+-----------------------------------------------------------------------------------+`

### **Phase 1: Core Foundation & Database Infrastructure**

> 1. Initialize Turborepo monorepo structure.  
> 2. Deploy database migrations 00001 through 00004 to Supabase.  
> 3. Execute seed data scripts for:  
   * 18 STAT MedEvac Bases  
   * 5 AHN LifeFlight Bases  
   * 22 High-Fidelity Regional Hospital Helipads  
   * 260+ Medical Conditions

### **Phase 2: Bridge Engineering & Data Synchronization**

> 1. Compile Tauri Rust desktop application with local UDP listener on port 8080\.  
> 2. Deploy hems-dispatch-xp.lua to FlyWithLua script directory.  
> 3. Implement SimConnect interface for MSFS 2020 and 2024\.  
> 4. Establish real-time data pipe passing state vectors to Supabase Realtime at \\ge 2\\text{ Hz}.

### **Phase 3: Web Dashboard, Dispatch & Golden Hour Engine**

> 1. Construct Next.js pages: /command, /dispatcher, /logbook, /tracking, /archive, and /sms-report.  
> 2. Build 4-Step Mission Planner UI:  
   * Step 1: Details (Scene Call vs. Inter-Facility Transfer)  
   * Step 2: Crew Roster Assignment  
   * Step 3: Patient Clinical Info & GCS Assessment  
   * Step 4: Flight Plan & Operational Performance Briefing  
> 3. Implement "Ironpine AI Tactical Engine" for automated dispatch scoring and route verification.  
> 4. Implement real-time "Golden Hour" countdown logic and automated After-Action Review (AAR) generator.

### **Phase 4: Regional Content Integration & Final Verification**

> 1. Verify high-fidelity regional helipad coords and elevations against FAA database entries.  
> 2. Verify offline/online telemetry error recovery procedures.  
> 3. Run end-to-end mission loop: Dispatch \\rightarrow Startup \\rightarrow En-Route \\rightarrow Scene Recce \\rightarrow Hot Load \\rightarrow Hospital Landing \\rightarrow AAR Audit.

## **7\. Verification Checklist & Success Criteria**

The build is considered successfully complete ONLY when all of the following criteria pass validation:  
`[ ] Database Schema Verification: Supabase tables created with spatial indexes enabled.`  
`[ ] Seed Data Integrity: All 18 STAT MedEvac and 5 AHN LifeFlight bases correctly mapped.`  
`[ ] Telemetry Pipeline: Sub-second state transmission from MSFS and X-Plane verified.`  
`[ ] Web Application: Live OpenStreetMap tracking layer renders active aircraft correctly.`  
`[ ] Clinical Engine: Golden Hour countdown timer decreases patient score upon simulated delays.`  
`[ ] AAR Generation: Automated After-Action Review correctly audits flight parameters.`

**Authored By:** Chief Technical Architect & Lead AI Systems Engineer, Virtual HEMS **Approved By:** Executive Board, Virtual HEMS Development Group **Repository Target:** virtualhems-monorepo/docs/AI\_BUILDER\_MASTER\_SPECIFICATION.md