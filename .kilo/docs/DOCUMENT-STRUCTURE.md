# **Virtual HEMS File System & Documentation Architecture (DOCUMENT-STRUCTURE.md)**

**Document Designation:** DOC-STRUCT-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Complete File System Hierarchy, Directory Layouts, Monorepo Mapping, and Core Specification Index for virtualhems.com

## **1\. Master Repository Directory Topology**

The Virtual HEMS platform is engineered as a Turborepo monorepo workspace. It unifies the Next.js 14+ web application, Tauri/Rust cross-platform desktop bridge, PostgreSQL database schemas, shared TypeScript contracts, and core operational documentation into a single version-controlled repository.  
`virtualhems-monorepo/`  
`├── .github/`  
`│   └── workflows/`  
`│       ├── ci-cd.yml                   # Web application Vercel/CI deploy pipeline[span_8](start_span)[span_8](end_span)`  
`│       └── bridge-build.yml            # Cross-platform Tauri bridge compilation[span_9](start_span)[span_9](end_span)`  
`├── docs/                               # Systems Architecture & Platform Specifications[span_10](start_span)[span_10](end_span)`  
`│   ├── ARCHITECTURE.md                 # Technical Architecture & Data Flow Blueprint`  
`│   ├── SCHEMATICS.md                   # System Circuit Maps & Diagram Specifications`  
`│   ├── TECH-STACK.md                   # Full-Stack Technology Matrix`  
`│   ├── REQUIREMENTS.md                 # System Requirements & Acceptance Criteria`  
`│   ├── FRAMEWORK.md                    # Platform Master Framework Directives[span_11](start_span)[span_11](end_span)`  
`│   ├── TASKS.md                        # Phased Engineering Action Plan`  
`│   ├── BLUEPRINT.md                    # Master End-to-End Platform Blueprint`  
`│   ├── REQUIRED-DOCUMENTS.md           # Technical Artifact Deliverables Deliverables`  
`│   └── DOCUMENT-STRUCTURE.md           # Repository File System Index & Mapping`  
`│   └── vhop/                           # Operational & Clinical Flight Manuals[span_12](start_span)[span_12](end_span)`  
`│       ├── VHOP-01-SOP.md              # Standard Operating Procedures & SMS[span_13](start_span)[span_13](end_span)[span_14](start_span)[span_14](end_span)`  
`│       ├── VHOP-02-SYSTEMS.md          # EC135 / EC145 / H135 Systems Operating Manual[span_15](start_span)[span_15](end_span)`  
`│       ├── VHOP-03-DYNAMICS.md         # Rotorcraft Aerodynamics & Physics Guide[span_16](start_span)[span_16](end_span)`  
`│       └── VHOP-04-CLINICAL.md         # Critical Care Logistics & Regional Network[span_17](start_span)[span_17](end_span)[span_18](start_span)[span_18](end_span)[span_19](start_span)[span_19](end_span)`  
`├── apps/`  
`│   ├── web/                            # Next.js 14+ Web Command Terminal (virtualhems.com)[span_20](start_span)[span_20](end_span)`  
`│   │   ├── src/`  
`│   │   │   ├── app/`  
`│   │   │   │   ├── (auth)/             # Authentication Routes`  
`│   │   │   │   ├── (dashboard)/        # Main Command Terminal Pages[span_21](start_span)[span_21](end_span)[span_22](start_span)[span_22](end_span)`  
`│   │   │   │   │   ├── command/        # Live Operations Command Map[span_23](start_span)[span_23](end_span)`  
`│   │   │   │   │   ├── dispatcher/     # 4-Stage Mission Planner[span_24](start_span)[span_24](end_span)`  
`│   │   │   │   │   ├── efb/            # Cockpit Electronic Flight Bag[span_25](start_span)[span_25](end_span)`  
`│   │   │   │   │   ├── logbook/        # Pilot Flight Logs[span_26](start_span)[span_26](end_span)[span_27](start_span)[span_27](end_span)`  
`│   │   │   │   │   ├── archive/        # Mission History Audit Database[span_28](start_span)[span_28](end_span)[span_29](start_span)[span_29](end_span)`  
`│   │   │   │   │   └── sms-report/     # VIRS Incident Reporting Portal[span_30](start_span)[span_30](end_span)`  
`│   │   │   │   └── api/                # Serverless Backend API Routes[span_31](start_span)[span_31](end_span)`  
`│   │   │   │       ├── dispatch/ai-briefing/route.ts`  
`│   │   │   │       ├── telemetry/route.ts`  
`│   │   │   │       └── aar/route.ts`  
`│   │   │   ├── components/             # React Modular UI Elements[span_32](start_span)[span_32](end_span)`  
`│   │   │   ├── hooks/                  # Custom React Hooks (useGoldenHour, useTelemetry)`  
`│   │   │   └── lib/                    # Supabase Clients & Ironpine AI Drivers[span_33](start_span)[span_33](end_span)`  
`│   │   ├── package.json`  
`│   │   └── tsconfig.json`  
`│   │`  
`│   └── bridge-desktop/                 # Cross-Platform Desktop App (Tauri / Rust)[span_34](start_span)[span_34](end_span)`  
`│       ├── src-tauri/`  
`│       │   ├── src/`  
`│       │   │   ├── main.rs             # Tauri Entrypoint & UDP Listener[span_35](start_span)[span_35](end_span)`  
`│       │   │   ├── simconnect/mod.rs   # MSFS Native Shared Memory Reader[span_36](start_span)[span_36](end_span)`  
`│       │   │   ├── xplane_udp/mod.rs   # X-Plane Telemetry Ingestion[span_37](start_span)[span_37](end_span)`  
`│       │   │   └── uploader.rs         # WebSocket Stream Publisher[span_38](start_span)[span_38](end_span)`  
`│       │   └── Cargo.toml`  
`│       └── package.json`  
`│`  
`├── packages/`  
`│   ├── database/                       # PostgreSQL Schemas, PostGIS & Seeds[span_39](start_span)[span_39](end_span)`  
`│   │   ├── migrations/`  
`│   │   │   └── 00001_initial_schema.sql`  
`│   │   └── seed/`  
`│   │       ├── bases.seed.sql          # 18 STAT MedEvac & 5 AHN LifeFlight Bases[span_40](start_span)[span_40](end_span)[span_41](start_span)[span_41](end_span)[span_42](start_span)[span_42](end_span)`  
`│   │       ├── hospitals.seed.sql      # Western PA Regional Hospital Helipads[span_43](start_span)[span_43](end_span)[span_44](start_span)[span_44](end_span)[span_45](start_span)[span_45](end_span)`  
`│   │       └── conditions.seed.sql     # 260+ Medical Condition Matrix`  
`│   │`  
`│   └── shared-types/                   # Shared Universal TypeScript Interfaces`  
`│       ├── index.ts`  
`│       ├── telemetry.ts`  
`│       ├── medical.ts`  
`│       └── dispatch.ts`  
`│`  
`├── packages/plugins/`  
`│   └── xplane-lua/`  
`│       └── hems-dispatch-xp.lua        # FlyWithLua Script for X-Plane 11/12[span_46](start_span)[span_46](end_span)`  
`│`  
`├── turbo.json`  
`└── package.json`

## **2\. Specification Document Index & Descriptions**

### **2.1 Core Platform Specifications (docs/)**

> * **ARCHITECTURE.md:** Primary technical blueprint detailing the multi-engine telemetry pipe, cloud-native backend, WebSocket fanout, and web/desktop client boundaries.  
> * **SCHEMATICS.md:** Comprehensive ASCII system maps outlining telemetry data flows, CPDS/VEMD bus architecture, 4-axis AFCS control loops, and rotor physics maps.  
> * **TECH-STACK.md:** Full-stack technology matrix specifying Next.js 14+, Tailwind CSS, Tauri/Rust, Supabase PostgreSQL, PostGIS, and FlyWithLua.  
> * **REQUIREMENTS.md:** Exhaustive functional, technical, clinical, and performance requirement specifications paired with verification pass conditions.  
> * **FRAMEWORK.md:** Master operational framework establishing organizational directives (Integrity, Reliability, Service), CRM rules, and regional infrastructure boundaries.  
> * **TASKS.md:** 4-phase master engineering action plan, task index, monorepo generation list, and system verification checklist.  
> * **BLUEPRINT.md:** Complete end-to-end architecture summary defining data models, seed files, bridge entrypoints, and CI/CD pipelines.  
> * **REQUIRED-DOCUMENTS.md:** Master directory index and deliverable specification sheet for all system components.  
> * **DOCUMENT-STRUCTURE.md:** Structural reference mapping every file, directory, and module within the monorepo.

### **2.2 Operational Flight & Clinical Manuals (docs/vhop/)**

> * **VHOP-01-SOP.md:** Virtual HEMS Operations Manual detailing Safety Management Systems (SMS), Virtual Incident Reporting (VIRS), Crew Resource Management (CRM), and landing zone (LZ) safety.  
> * **VHOP-02-SYSTEMS.md:** Technical Aircraft Operating Manual covering the Eurocopter EC135 (P2+/T2+), EC145, and Airbus H135, including FADEC logic, CPDS/VEMD, First Limit Indicator (FLI), and 4-axis AFCS/auto trim/beep trim mechanics.  
> * **VHOP-03-DYNAMICS.md:** Fundamentals of helicopter flight mechanics detailing aerofoil lift generation, gyroscopic precession, Effective Translational Lift (ETL), Vortex Ring State (VRS), Loss of Tail Rotor Effectiveness (LTE), and autorotation flare entry.  
> * **VHOP-04-CLINICAL.md:** Clinical Logistics Manual covering the 260+ condition medical database, Golden Hour timed deterioration algorithms, Glasgow Coma Scale (GCS) scoring, and Western PA regional base/hospital helipad directories.

## **3\. Application Subsystem File Mapping**

### **3.1 Web Application Subsystem (apps/web/)**

| File / Component Path | Primary Functional Responsibility |
| :---- | :---- |
| src/app/(dashboard)/command/page.tsx | Renders the live global command map with active rotorcraft vectors, base overlays, and hospital helipads. |
| src/app/(dashboard)/dispatcher/page.tsx | Hosts the 4-Stage Mission Dispatch Planner interface. |
| src/app/(dashboard)/efb/page.tsx | Cockpit Electronic Flight Bag displaying live patient vitals, GCS tracking, and interactive checklists. |
| src/app/(dashboard)/logbook/page.tsx | Displays individual pilot flight logs, total hours, landings, and dispatch records. |
| src/app/(dashboard)/archive/page.tsx | Historical mission archive and patient transport log database. |
| src/app/(dashboard)/sms-report/page.tsx | Non-punitive Virtual Incident Reporting System (VIRS) submission portal. |
| src/app/api/dispatch/ai-briefing/route.ts | Serverless API route executing Ironpine AI to generate tactical receiving facility and LZ recommendations. |
| src/components/dispatch/Step1Details.tsx | Dispatch Stage 1 UI: Mission type selection (Scene Call vs. Transfer), base assignment, and live METAR weather. |
| src/components/dispatch/Step2Crew.tsx | Dispatch Stage 2 UI: Assigns Pilot-in-Command (PIC), Flight Nurse (PHRN), and Flight Paramedic. |
| src/components/dispatch/Step3PatientInfo.tsx | Dispatch Stage 3 UI: Manages patient demographics, 260+ condition inputs, baseline GCS, and AI briefing requests. |
| src/components/dispatch/Step4FlightPlan.tsx | Dispatch Stage 4 UI: Quantified PAVE risk assessment scoring, fuel checks, and flight plan transmission. |
| src/hooks/useGoldenHour.ts | Dynamic React hook managing the 60-minute Golden Hour countdown timer and GCS decay logic. |

### **3.2 Desktop Bridge Subsystem (apps/bridge-desktop/)**

| File / Module Path | Primary Functional Responsibility |
| :---- | :---- |
| src-tauri/Cargo.toml | Rust workspace manifest defining tokio, serde, serde\_json, tauri, and tungstenite dependencies. |
| src-tauri/src/main.rs | Application entrypoint initializing the local UDP socket listener on port 8080\. |
| src-tauri/src/simconnect/mod.rs | Native C++ / Rust SimConnect interface module polling MSFS memory blocks at 2\\text{ Hz} to 10\\text{ Hz}. |
| src-tauri/src/xplane\_udp/mod.rs | UDP packet receiver decoding X-Plane FlyWithLua JSON telemetry data streams. |
| src-tauri/src/uploader.rs | WebSocket publisher module streaming encrypted telemetry payloads to Supabase Realtime channels. |

### **3.3 Database & Shared Packages (packages/)**

| File / Package Path | Primary Functional Responsibility |
| :---- | :---- |
| database/migrations/00001\_initial\_schema.sql | PostGIS SQL migration script creating spatial tables (profiles, hems\_bases, hospitals, medical\_conditions, missions, flight\_telemetry). |
| database/seed/bases.seed.sql | SQL seed dataset populating 18 STAT MedEvac and 5 AHN LifeFlight base stations. |
| database/seed/hospitals.seed.sql | SQL seed dataset populating Western PA regional hospital helipads. |
| database/seed/conditions.seed.sql | SQL seed dataset populating the 260+ medical condition database. |
| shared-types/telemetry.ts | Shared TypeScript interfaces defining TelemetryFrame vector models. |
| shared-types/medical.ts | Shared TypeScript interfaces defining MedicalCondition and PatientState models. |
| shared-types/dispatch.ts | Shared TypeScript interfaces defining MissionDispatch and PAVERiskMatrix models. |
| plugins/xplane-lua/hems-dispatch-xp.lua | FlyWithLua script hooking X-Plane dataref vectors and transmitting JSON packets to UDP port 8080\. |

## **4\. Verification & Structural Compliance**

`+---------------------------------------------------------------------------------------------------+`  
`|                                  STRUCTURAL INTEGRITY AUDIT MATRIX                                |`  
`+-------------------+------------------------------------+------------------------------------------+`  
`| Subsystem Target  | Audit Criteria                     | Pass Threshold / Verification            |`  
`+-------------------+------------------------------------+------------------------------------------+`  
``| Monorepo Build    | `npx turbo run build`              | Zero compilation errors across packages  |``  
`| Database Engine   | PostGIS Spatial Query Execution    | Valid distance calculation for PS78[span_104](start_span)[span_104](end_span)[span_105](start_span)[span_105](end_span)|`  
`| Desktop Bridge    | Local UDP Port 8080 Bind           | Successfully ingests FlyWithLua packets  |`  
``| Web Command UI    | Route Navigation Check             | Renders `/command`, `/dispatcher`, `/efb`[span_106](start_span)[span_106](end_span)|``  
``| Documentation     | Markdown File Integrity            | 100% specification coverage in `docs/`   |``  
`+-------------------+------------------------------------+------------------------------------------+`

**Authored By:** Chief Systems Architect & Lead Software Engineer, Virtual HEMS **Approved By:** Executive Council, Virtual HEMS Platform Development **Repository Location:** virtualhems-monorepo/docs/DOCUMENT-STRUCTURE.md