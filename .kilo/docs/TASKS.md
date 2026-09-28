# **Virtual HEMS Development Tasks & Phased Build Plan (TASKS.md)**

**Document Designation:** TASK-SPEC-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Exhaustive Engineering Task Index, Phased Action Plan, Monorepo File Generation List, and End-to-End Verification Checklist for Building virtualhems.com

## **1\. Master Task Index & Executive Build Strategy**

This master task breakdown guides the automated AI Builder and engineering team in developing the complete **Virtual HEMS** platform. Moving beyond static add-ons, Virtual HEMS operates as a data-linked "simulation-as-a-service" ecosystem that connects desktop flight simulators (MSFS 2020/2024 and X-Plane 11/12) directly to a cloud-based tactical dispatch and clinical tracking network.  
`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                         FOUR-PHASE MASTER BUILD STRATEGY                                              |`  
`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                                                                                                       |`  
`|  PHASE 1: MONOREPO FOUNDATION & DATABASE SCHEMAS                                                                      |`  
``|  - Initialize Turborepo structure (`apps/web`, `apps/bridge-desktop`, `packages/database`, `packages/shared-types`).   |``  
`|  - Deploy PostgreSQL 15+ schema with PostGIS spatial extensions on Supabase[span_10](start_span)[span_10](end_span).                                     |`  
`|  - Seed regional infrastructure (18 STAT MedEvac, 5 AHN LifeFlight bases, 22+ hospital helipads)[span_11](start_span)[span_11](end_span)[span_12](start_span)[span_12](end_span)[span_13](start_span)[span_13](end_span)[span_14](start_span)[span_14](end_span).   |`  
`|  - Seed the 260+ clinical condition matrix and Glasgow Coma Scale (GCS) decay parameters[span_15](start_span)[span_15](end_span)[span_16](start_span)[span_16](end_span).                 |`  
`|                                                                                                                       |`  
`|  PHASE 2: HARDWARE BRIDGE & TELEMETRY STREAMING ENGINE                                                                |`  
``|  - Compile Tauri / Rust desktop client (`hems-bridge`) for Windows (.exe) and macOS (.dmg)[span_17](start_span)[span_17](end_span)[span_18](start_span)[span_18](end_span)[span_19](start_span)[span_19](end_span).                |``  
``|  - Write and deploy `hems-dispatch-xp.lua` FlyWithLua UDP stream script for X-Plane (Port 8080)[span_20](start_span)[span_20](end_span).                  |``  
`|  - Construct native SimConnect memory reader for MSFS 2020/2024[span_21](start_span)[span_21](end_span)[span_22](start_span)[span_22](end_span)[span_23](start_span)[span_23](end_span)[span_24](start_span)[span_24](end_span).                                         |`  
`|  - Establish sub-second WebSocket telemetry uplink to Supabase Realtime[span_25](start_span)[span_25](end_span)[span_26](start_span)[span_26](end_span)[span_27](start_span)[span_27](end_span).                                   |`  
`|                                                                                                                       |`  
`|  PHASE 3: WEB COMMAND TERMINAL, DISPATCH & CLINICAL ENGINE                                                            |`  
``|  - Build Next.js 14+ Web Application (`virtualhems.com`) App Router routes and UI components[span_28](start_span)[span_28](end_span)[span_29](start_span)[span_29](end_span)[span_30](start_span)[span_30](end_span).              |``  
`|  - Construct 4-Stage Mission Dispatch Planner (Details, Crew, Patient Info, Flight Plan)[span_31](start_span)[span_31](end_span)[span_32](start_span)[span_32](end_span)[span_33](start_span)[span_33](end_span).                |`  
`|  - Deploy Ironpine AI Tactical Dispatch Engine for briefing generation and AAR auditing[span_34](start_span)[span_34](end_span)[span_35](start_span)[span_35](end_span).                  |`  
`|  - Build dynamic "Golden Hour" countdown timer and real-time patient deterioration hook[span_36](start_span)[span_36](end_span).                      |`  
`|                                                                                                                       |`  
`|  PHASE 4: REGIONAL VERIFICATION, SECURITY & PRODUCTION DEPLOYMENT                                                     |`  
`|  - Verify PostGIS spatial alignment for all Western PA helipads and bases[span_37](start_span)[span_37](end_span)[span_38](start_span)[span_38](end_span)[span_39](start_span)[span_39](end_span).                              |`  
`|  - Enforce PostgreSQL Row Level Security (RLS) policies and user authorization[span_40](start_span)[span_40](end_span).                              |`  
`|  - Deploy web application to Vercel and configure GitHub Actions CI/CD pipeline[span_41](start_span)[span_41](end_span).                             |`  
`|  - Execute full end-to-end operational checkflight (Dispatch -> Flight -> Hot Load -> Landing -> AAR Audit)[span_42](start_span)[span_42](end_span)[span_43](start_span)[span_43](end_span).|`  
`|                                                                                                                       |`  
`+-----------------------------------------------------------------------------------------------------------------------+`

## **2\. Phase 1: Core Monorepo Infrastructure & Database Schemas**

### **1.1 Monorepo Workspace Initialization**

> * \[ \] **TASK-101:** Initialize root package.json, turbo.json, and .gitignore for a Turborepo workspace.  
> * \[ \] **TASK-102:** Configure packages/shared-types with TypeScript contracts for TelemetryFrame, PatientState, MedicalCondition, and MissionDispatch.  
> * \[ \] **TASK-103:** Configure GitHub Actions CI/CD environment secrets (NEXT\_PUBLIC\_SUPABASE\_URL, SUPABASE\_SERVICE\_ROLE\_KEY).

### **1.2 PostgreSQL & PostGIS Schema Migrations (packages/database)**

> * \[ \] **TASK-104:** Create migration 00001\_initial\_schema.sql defining custom ENUM types (user\_role, mission\_type, mission\_status, patient\_priority, airframe\_type).  
> * \[ \] **TASK-105:** Create table public.profiles for pilot callsigns, credentials, and cumulative flight logging.  
> * \[ \] **TASK-106:** Create table public.hems\_bases with PostGIS GEOGRAPHY(POINT, 4326\) coordinates for base operations.  
> * \[ \] **TASK-107:** Create table public.hospitals with PostGIS spatial coordinates, rooftop/ground helipad indicators, dimensions, and trauma level capabilities.  
> * \[ \] **TASK-108:** Create table public.medical\_conditions supporting ICD codes, baseline GCS scores, decay rates per minute, and RSI requirements.  
> * \[ \] **TASK-109:** Create table public.missions for tracking scene calls and inter-facility transfers from dispatch to completion.  
> * \[ \] **TASK-110:** Create table public.flight\_telemetry for high-rate vector storage (lat, lon, MSL/AGL altitude, groundspeed, heading, pitch, roll, torque, TOT, fuel).  
> * \[ \] **TASK-111:** Construct spatial GIST indexes on hems\_bases, hospitals, and missions geometry columns to enable high-speed radial queries.

### **1.3 Regional Infrastructure & Clinical Data Seeding**

> * \[ \] **TASK-112:** Construct seed file bases.seed.sql containing all 18 STAT MedEvac bases (e.g., STAT 1 Washington, STAT 3 Cranberry, STAT 4 KAGC HQ, STAT 6 KAXQ Clarion) and 5 AHN LifeFlight bases (e.g., LifeFlight 1 Canonsburg, LifeFlight 2 Clarion, LifeFlight 4 Butler).  
> * \[ \] **TASK-113:** Construct seed file hospitals.seed.sql containing Western PA regional helipads (e.g., UPMC Presbyterian PS78, UPMC Mercy PN23, UPMC Children's 30PN, Allegheny General 42PN, UPMC Hamot 0PS8, UPMC Altoona 74PN, Penn Highlands DuBois PA10, Clarion Hospital 91PA).  
> * \[ \] **TASK-114:** Construct seed file conditions.seed.sql populating over 260 distinct medical conditions across trauma, cardiac, neuro, stroke, OB, and pediatric categories.

## **3\. Phase 2: Hardware Bridge & Telemetry Streaming Engine**

### **2.1 Desktop Client Engineering (apps/bridge-desktop)**

> * \[ \] **TASK-201:** Initialize Tauri v2 / Rust workspace with native cross-platform compilation support for Windows (.exe) and macOS (.dmg).  
> * \[ \] **TASK-202:** Implement a local UDP socket listener in Rust binding to 127.0.0.1:8080 to ingest X-Plane telemetry streams.  
> * \[ \] **TASK-203:** Construct native MSFS SimConnect C++ DLL wrapper in Rust to read rotorcraft state memory vectors at 2\\text{ Hz} to 10\\text{ Hz} sampling frequency.  
> * \[ \] **TASK-204:** Build delta-compression filter in Rust to drop redundant state updates and conserve upload bandwidth.  
> * \[ \] **TASK-205:** Implement an offline failover storage ring buffer in SQLite to queue telemetry during network disconnects and auto-flush upon reconnection.  
> * \[ \] **TASK-206:** Build TLS WebSocket publisher module streaming JSON payloads to Supabase Realtime channels using pilot API keys.

### **2.2 Simulator Integration Plugins (packages/plugins)**

> * \[ \] **TASK-207:** Write FlyWithLua script hems-dispatch-xp.lua for X-Plane 11/12 hooking position (latitude, longitude), altitude (elevation, y\_agl), speeds (groundspeed, vh\_ind), orientations (theta, phi, mag\_psi), engine states (ENGN\_TRQ), and fuel total (m\_fuel\_total).  
> * \[ \] **TASK-208:** Package installer script bundling the Tauri executable and SimConnect runtime dependencies for seamless pilot setup.

## **4\. Phase 3: Web Command Terminal, Dispatch & Clinical Engine**

### **3.1 Next.js App Router Architecture (apps/web)**

> * \[ \] **TASK-301:** Construct layout and authentication shell for virtualhems.com using Next.js 14+ App Router and Tailwind CSS.  
> * \[ \] **TASK-302:** Create route /command rendering a full-screen interactive Leaflet/Mapbox GL map showing active flight assets, base stations, and hospital overlays.  
> * \[ \] **TASK-303:** Create route /dispatcher hosting the 4-Stage Mission Dispatch Planner.  
> * \[ \] **TASK-304:** Create route /efb providing an in-cockpit Electronic Flight Bag interface for live patient vitals tracking and checklist management during flight.  
> * \[ \] **TASK-305:** Create route /logbook and /archive rendering pilot flight logs, mission histories, and transport records.  
> * \[ \] **TASK-306:** Create route /sms-report allowing pilots to submit Virtual Incident Reporting System (VIRS) forms for safety analysis.

### **3.2 4-Stage Mission Dispatch Planner**

> * \[ \] **TASK-307:** Build **Stage 1 (Details):** Mission type selection (Primary Scene Call vs. Inter-Facility Transfer), base assignment, and live METAR weather widget integration.  
> * \[ \] **TASK-308:** Build **Stage 2 (Crew):** Duty assignment selector for Pilot in Command (PIC), Flight Nurse (PHRN), and Flight Paramedic.  
> * \[ \] **TASK-309:** Build **Stage 3 (Patient Info):** Patient demographics input, 260+ medical condition selector, baseline GCS calculator, and AI Tactical Briefing trigger.  
> * \[ \] **TASK-310:** Build **Stage 4 (Flight Plan):** Quantified PAVE risk assessment matrix calculation (Go/No-Go score), fuel reserve checks, and flight plan transmission.

`STAGE 1: DETAILS           STAGE 2: CREW             STAGE 3: PATIENT INFO      STAGE 4: FLIGHT PLAN`  
`┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐`  
`│ Scene vs Transfer [24]│  │ Pilot (PIC) [21]      │  │ Demographics [4]      │  │ PAVE Risk Matrix [4]  │`  
`│ Assign Base/Asset [24]│─►│ Flight Nurse [21]     │─►│ 260+ Condition [4]    │─►│ Fuel Reserves [4]     │`  
`│ Live METAR WX [24]    │  │ Paramedic [21]        │  │ GCS Assessment [4]    │  │ Transmit to EFB [4]   │`  
`└───────────────────────┘  └───────────────────────┘  └───────────────────────┘  └───────────────────────┘`

### **3.3 Medical Engine & AI Tactical Dispatcher**

> * \[ \] **TASK-311:** Build useGoldenHour React hook executing a 60-minute countdown upon scene dispatch and reducing patient GCS scores when on-scene time exceeds 15 minutes.  
> * \[ \] **TASK-312:** Integrate "Ironpine AI Tactical Engine" serverless route (/api/dispatch/ai-briefing) analyzing patient severity, weather inputs, and distance vectors to issue optimal receiving facility recommendations.  
> * \[ \] **TASK-313:** Build automated After-Action Review (AAR) engine auditing flight telemetry, touchdown G-forces, pitch/roll excursions, reserve fuel margins, and clinical timelines upon hospital helipad arrival.

## **5\. Phase 4: Verification, Security & Production Deployment**

### **4.1 Security & Database Policies**

> * \[ \] **TASK-401:** Implement PostgreSQL Row Level Security (RLS) policies on flight\_telemetry, missions, and profiles to restrict mutation rights to authenticated pilots.  
> * \[ \] **TASK-402:** Configure HIPAA-compliant sanitization filters ensuring no real-world patient identification data can be submitted to public dispatch feeds.

### **4.2 Production Infrastructure & Deployment**

> * \[ \] **TASK-403:** Deploy web application to Vercel connected to custom domain virtualhems.com.  
> * \[ \] **TASK-404:** Deploy Supabase production instance (US-East-1) with automated daily database backups.  
> * \[ \] **TASK-405:** Publish desktop bridge installer executables to GitHub Releases and the virtualhems.com download portal.

## **6\. Monorepo File Generation List**

The AI Builder MUST verify the generation and completeness of every file listed below across the repository structure:  
`virtualhems-monorepo/`  
`├── .github/`  
`│   └── workflows/`  
`│       ├── ci-cd.yml`  
`│       └── bridge-build.yml`  
`├── docs/`  
`│   ├── ARCHITECTURE.md`  
`│   ├── SCHEMATICS.md`  
`│   ├── TECH-STACK.md`  
`│   ├── REQUIREMENTS.md`  
`│   ├── FRAMEWORK.md`  
`│   ├── TASKS.md`  
`│   ├── VHOP-01-SOP.md`  
`│   ├── VHOP-02-SYSTEMS.md`  
`│   ├── VHOP-03-DYNAMICS.md`  
`│   └── VHOP-04-CLINICAL.md`  
`├── apps/`  
`│   ├── web/`  
`│   │   ├── src/`  
`│   │   │   ├── app/`  
`│   │   │   │   ├── (auth)/`  
`│   │   │   │   │   ├── login/page.tsx`  
`│   │   │   │   │   └── register/page.tsx`  
`│   │   │   │   ├── (dashboard)/`  
`│   │   │   │   │   ├── command/page.tsx`  
`│   │   │   │   │   ├── dispatcher/page.tsx`  
`│   │   │   │   │   ├── efb/page.tsx`  
`│   │   │   │   │   ├── logbook/page.tsx`  
`│   │   │   │   │   ├── archive/page.tsx`  
`│   │   │   │   │   └── sms-report/page.tsx`  
`│   │   │   │   ├── api/`  
`│   │   │   │   │   ├── dispatch/ai-briefing/route.ts`  
`│   │   │   │   │   ├── telemetry/route.ts`  
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
`│   │   │   │   └── efb/`  
`│   │   │   │       ├── PatientVitalsDisplay.tsx`  
`│   │   │   │       └── ChecklistPanel.tsx`  
`│   │   │   ├── hooks/`  
`│   │   │   │   ├── useTelemetry.ts`  
`│   │   │   │   └── useGoldenHour.ts`  
`│   │   │   └── lib/`  
`│   │   │       ├── supabase/client.ts`  
`│   │   │       └── ironpine-ai.ts`  
`│   │   ├── package.json`  
`│   │   └── tsconfig.json`  
`│   │`  
`│   └── bridge-desktop/`  
`│       ├── src-tauri/`  
`│       │   ├── src/`  
`│       │   │   ├── main.rs`  
`│       │   │   ├── simconnect/mod.rs`  
`│       │   │   ├── xplane_udp/mod.rs`  
`│       │   │   └── uploader.rs`  
`│       │   └── Cargo.toml`  
`│       └── package.json`  
`│`  
`├── packages/`  
`│   ├── database/`  
`│   │   ├── migrations/`  
`│   │   │   └── 00001_initial_schema.sql`  
`│   │   └── seed/`  
`│   │       ├── bases.seed.sql`  
`│   │       ├── hospitals.seed.sql`  
`│   │       └── conditions.seed.sql`  
`│   │`  
`│   └── shared-types/`  
`│       ├── index.ts`  
`│       ├── telemetry.ts`  
`│       ├── medical.ts`  
`│       └── dispatch.ts`  
`│`  
`├── turbo.json`  
`└── package.json`

## **7\. Operational Verification Checklist & Acceptance Criteria**

`+-----------------------------------------------------------------------------------------------------------------------+`  
`|                                        ACCEPTANCE TESTING CHECKLIST                                                   |`  
`+-------------------+-----------------------------------+---------------------------------------------------------------+`  
`| Test Subject      | Verification Procedure            | Acceptance Pass Condition                     |`  
`+-------------------+-----------------------------------+---------------------------------------------------------------+`  
`| Database Engine   | Execute spatial SQL query         | Returns exact distance & elevation for PS78 / KAXQ[span_127](start_span)[span_127](end_span)[span_128](start_span)[span_128](end_span)[span_129](start_span)[span_129](end_span)|`  
`| Desktop Bridge    | Launch Tauri app with MSFS/X-Plane| Transmits valid 2-10 Hz telemetry stream to WebSocket[span_130](start_span)[span_130](end_span)[span_131](start_span)[span_131](end_span)[span_132](start_span)[span_132](end_span) |`  
`| Dispatch Planner  | Execute 4-Stage dispatch creation | Creates mission record & sends data to EFB terminal[span_133](start_span)[span_133](end_span)[span_134](start_span)[span_134](end_span) |`  
`| Clinical Engine   | Simulate 20-min scene delay       | Triggers GCS deterioration & updates patient vitals[span_135](start_span)[span_135](end_span)   |`  
``| AI Dispatcher     | Call `/api/dispatch/ai-briefing`  | Returns valid receiving hospital & LZ safety recommendation[span_136](start_span)[span_136](end_span)[span_137](start_span)[span_137](end_span)|``  
`| Post-Flight AAR   | Trigger touchdown at hospital     | Generates performance audit & updates pilot logbook[span_138](start_span)[span_138](end_span)[span_139](start_span)[span_139](end_span)[span_140](start_span)[span_140](end_span) |`  
`+-------------------+-----------------------------------+---------------------------------------------------------------+`

**Authored By:** Chief Systems Architect & Lead Software Engineer, Virtual HEMS **Approved By:** Directorate of Technology & Flight Operations, Virtual HEMS Council **Repository Target:** virtualhems-monorepo/docs/TASKS.md