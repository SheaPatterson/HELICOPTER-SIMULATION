# **REQUIRED-DOCUMENTS.md**

**Document Designation:** REQ-DOC-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Mandatory Document Generation Index, Monorepo File Specifications, and Technical Artifact Deliverables for the Virtual HEMS Simulation Platform (virtualhems.com)

## **1\. Executive Summary & File System Architecture**

### **1.1 Purpose & Governance**

This document defines the complete, non-negotiable list of required software files, technical manuals, database schemas, operational protocols, and configuration scripts necessary to build and deploy the **Virtual HEMS** ecosystem. Virtual HEMS is a professional-grade companion and mission-coordination platform integrating desktop flight simulators (Microsoft Flight Simulator 2020/2024 and X-Plane 11/12) with a cloud-native dispatcher and clinical tracking hub.  
\+---------------------------------------------------------------------------------------------------+  
|                            VIRTUAL HEMS FILE SYSTEM TOPOLOGY                                      |  
\+---------------------------------------------------------------------------------------------------+  
|  apps/web/                      \--\> Next.js 14+ App Router Client (virtualhems.com) \[3\]           |  
|  apps/bridge-desktop/          \--\> Tauri / Rust Cross-Platform Desktop Client \[3\]                 |  
|  packages/database/            \--\> Supabase PostgreSQL Schemas, PostGIS & Seeds \[3\]               |  
|  packages/shared-types/        \--\> TypeScript Interoperability Contracts \[3\]                    |  
|  packages/plugins/             \--\> Simulator Integration Scripts (FlyWithLua) \[3\]                 |  
|  docs/                         \--\> Core Systems & Operational Documentation \[3\]                   |  
\+---------------------------------------------------------------------------------------------------+

## **2\. Master Required Document Directory**

### **2.1 Core Architectural & System Documentation (docs/)**

> * docs/ARCHITECTURE.md: Master system architecture covering the multi-engine flight telemetry ingestion pipeline, cloud infrastructure (Supabase/PostgreSQL), and web client interfaces.  
> * docs/SCHEMATICS.md: Comprehensive ASCII system diagrams detailing hardware telemetry flows, CPDS/VEMD bus architecture, 4-axis AFCS control loops, and rotor physics maps.  
> * docs/TECH-STACK.md: Technical stack specifications detailing Turborepo workspaces, Next.js 14+, Tauri/Rust, PostGIS, FlyWithLua, and WebSockets.  
> * docs/REQUIREMENTS.md: Functional, performance, clinical, and infrastructure requirements matrix.  
> * docs/FRAMEWORK.md: Operational and architectural directives governing simulation accuracy, CRM rules, and Western PA regional infrastructure.  
> * docs/TASKS.md: Exhaustive 4-phase action plan, task index, and end-to-end acceptance testing checklist.  
> * docs/BLUEPRINT.md: Full-stack system blueprint detailing monorepo topology, database schemas, and client components.  
> * docs/REQUIRED-DOCUMENTS.md: Master directory index and specification sheet for all system deliverables.

### **2.2 Operational & Flight Systems Manuals (docs/vhop/)**

> * docs/VHOP-01-SOP.md: Virtual HEMS Operations Manual covering Safety Management Systems (SMS), Virtual Incident Reporting (VIRS), Crew Resource Management (CRM), and landing zone (LZ) safety.  
> * docs/VHOP-02-SYSTEMS.md: Technical aircraft operating manual detailing the Eurocopter EC135 (P2+/T2+), EC145, and Airbus H135, including FADEC logic, CPDS/VEMD, FLI, and 4-axis AFCS/auto trim/beep trim mechanics.  
> * docs/VHOP-03-DYNAMICS.md: Fundamentals of helicopter flight dynamics detailing aerofoil lift mechanics, gyroscopic precession, Effective Translational Lift (ETL), Vortex Ring State (VRS), Loss of Tail Rotor Effectiveness (LTE), and autorotation flare entry.  
> * docs/VHOP-04-CLINICAL.md: Clinical logistics manual detailing the 260+ condition medical engine, Golden Hour timed deterioration algorithms, Glasgow Coma Scale (GCS) scoring, and Western PA base/hospital helipad directories.

## **3\. Software Codebase File Specifications**

### **3.1 Next.js Web Command Terminal (apps/web/)**

> * apps/web/package.json: Workspace dependencies (React 18+, Next.js 14+, Tailwind CSS, Framer Motion, Leaflet, Mapbox GL JS).  
> * apps/web/src/app/(dashboard)/command/page.tsx: Live global operations command map rendering active rotorcraft assets, bases, and hospital helipads.  
> * apps/web/src/app/(dashboard)/dispatcher/page.tsx: 4-Stage Mission Dispatch Planner interface.  
> * apps/web/src/app/(dashboard)/efb/page.tsx: In-cockpit Electronic Flight Bag interface displaying real-time patient vitals, GCS tracking, and interactive operational checklists.  
> * apps/web/src/app/(dashboard)/logbook/page.tsx: Individual pilot logbook tracking flight hours, landings, and mission history.  
> * apps/web/src/app/(dashboard)/archive/page.tsx: Historical mission archive and patient transport log database.  
> * apps/web/src/app/(dashboard)/sms-report/page.tsx: Safety Management System (SMS) and Virtual Incident Reporting System (VIRS) submission portal.  
> * apps/web/src/app/api/dispatch/ai-briefing/route.ts: Serverless API route executing the Ironpine AI Tactical Dispatch Engine to generate receiving hospital recommendations and LZ safety briefs.  
> * apps/web/src/components/dispatch/Step1Details.tsx: Dispatch Stage 1 UI managing mission type (Scene Call vs. Inter-Facility Transfer), base assignment, and live METAR weather.  
> * apps/web/src/components/dispatch/Step2Crew.tsx: Dispatch Stage 2 UI assigning Pilot-in-Command (PIC), Flight Nurse (PHRN), and Flight Paramedic/Communications Specialist.  
> * apps/web/src/components/dispatch/Step3PatientInfo.tsx: Dispatch Stage 3 UI managing patient demographics, 260+ medical condition inputs, baseline GCS scoring, and AI briefing requests.  
> * apps/web/src/components/dispatch/Step4FlightPlan.tsx: Dispatch Stage 4 UI executing quantified PAVE risk assessment scoring, fuel margin checks, and EFB transmission.  
> * apps/web/src/hooks/useGoldenHour.ts: Dynamic React hook managing the 60-minute Golden Hour countdown timer and GCS decay calculations.

### **3.2 Desktop Bridge Application (apps/bridge-desktop/)**

> * apps/bridge-desktop/src-tauri/Cargo.toml: Rust workspace dependencies including tokio, serde, serde\_json, tauri, and tungstenite.  
> * apps/bridge-desktop/src-tauri/src/main.rs: Tauri application entrypoint initializing the local UDP socket listener on port 8080\.  
> * apps/bridge-desktop/src-tauri/src/simconnect/mod.rs: Native C++ / Rust SimConnect interface module polling MSFS 2020/2024 memory blocks at 2\\text{ Hz} to 10\\text{ Hz}.  
> * apps/bridge-desktop/src-tauri/src/xplane\_udp/mod.rs: UDP packet receiver decoding X-Plane FlyWithLua JSON data streams.  
> * apps/bridge-desktop/src-tauri/src/uploader.rs: WebSocket publisher module streaming encrypted telemetry payloads to Supabase Realtime channels.

### **3.3 Database Infrastructure & Seeds (packages/database/)**

> * packages/database/migrations/00001\_initial\_schema.sql: Primary SQL migration script creating spatial PostGIS tables (profiles, hems\_bases, hospitals, medical\_conditions, missions, flight\_telemetry), custom ENUMs, and spatial indexes.  
> * packages/database/seed/bases.seed.sql: SQL seed dataset populating 18 STAT MedEvac base stations (e.g., STAT 1 Washington, STAT 3 Cranberry, STAT 4 KAGC HQ, STAT 6 KAXQ Clarion) and 5 AHN LifeFlight base stations (e.g., LifeFlight 1 Canonsburg, LifeFlight 2 Clarion, LifeFlight 4 Butler).  
> * packages/database/seed/hospitals.seed.sql: SQL seed dataset populating Western PA and regional hospital helipads (e.g., UPMC Presbyterian PS78, UPMC Mercy PN23, UPMC Children's 30PN, Allegheny General 42PN, UPMC Hamot 0PS8, UPMC Altoona 74PN, Penn Highlands DuBois PA10, Clarion Hospital 91PA).  
> * packages/database/seed/conditions.seed.sql: SQL seed dataset populating 260+ medical conditions, ICD codes, baseline GCS scores, and decay rates.

### **3.4 Shared Type Contracts (packages/shared-types/)**

> * packages/shared-types/telemetry.ts: Universal TypeScript interface defining TelemetryFrame vector payloads.  
> * packages/shared-types/medical.ts: Universal TypeScript interface defining MedicalCondition and PatientState models.  
> * packages/shared-types/dispatch.ts: Universal TypeScript interface defining MissionDispatch and PAVERiskMatrix models.

### **3.5 Simulator Integration Plugins (packages/plugins/)**

> * packages/plugins/xplane-lua/hems-dispatch-xp.lua: FlyWithLua script hooking X-Plane dataref vectors and transmitting JSON packets via local UDP sockets to port 8080\.

## **4\. Document Verification & Verification Matrix**

\+---------------------------------------------------------------------------------------------------+  
|                                  REQUIRED DOCUMENTATION VERIFICATION                              |  
\+-------------------+------------------------------------+------------------------------------------+  
| Document ID       | Target Location                    | Status / Validation Condition            |  
\+-------------------+------------------------------------+------------------------------------------+  
| ARCHITECTURE.md   | docs/ARCHITECTURE.md               | Complete System Blueprint\[span\_57\](start\_span)\[span\_57\](end\_span)      |  
| SCHEMATICS.md     | docs/SCHEMATICS.md                 | Complete ASCII Circuit/System Maps\[span\_58\](start\_span)\[span\_58\](end\_span)|  
| TECH-STACK.md     | docs/TECH-STACK.md                 | Complete Stack Matrix\[span\_59\](start\_span)\[span\_59\](end\_span)          |  
| REQUIREMENTS.md   | docs/REQUIREMENTS.md               | Complete Requirements Index\[span\_60\](start\_span)\[span\_60\](end\_span)    |  
| FRAMEWORK.md      | docs/FRAMEWORK.md                  | Complete Master Directives\[span\_61\](start\_span)\[span\_61\](end\_span)     |  
| TASKS.md          | docs/TASKS.md                      | Complete 4-Phase Action Plan\[span\_62\](start\_span)\[span\_62\](end\_span)   |  
| BLUEPRINT.md      | docs/BLUEPRINT.md                  | Complete System Architecture\[span\_63\](start\_span)\[span\_63\](end\_span)   |  
| REQUIRED-DOCS.md  | docs/REQUIRED-DOCUMENTS.md         | Complete Deliverables Index\[span\_64\](start\_span)\[span\_64\](end\_span)    |  
| VHOP-01           | docs/vhop/VHOP-01-SOP.md           | Complete SOP & SMS Protocols\[span\_65\](start\_span)\[span\_65\](end\_span)   |  
| VHOP-02           | docs/vhop/VHOP-02-SYSTEMS.md       | Complete Airframe Manual\[span\_66\](start\_span)\[span\_66\](end\_span)       |  
| VHOP-03           | docs/vhop/VHOP-03-DYNAMICS.md      | Complete Flight Physics Manual\[span\_67\](start\_span)\[span\_67\](end\_span) |  
| VHOP-04           | docs/vhop/VHOP-04-CLINICAL.md      | Complete Clinical Engine Manual\[span\_68\](start\_span)\[span\_68\](end\_span)|  
\+-------------------+------------------------------------+------------------------------------------+

**Authored By:** Chief Systems Architect & Lead Software Engineer, Virtual HEMS **Approved By:** Executive Council, Virtual HEMS Platform Development **Repository Location:** virtualhems-monorepo/docs/REQUIRED-DOCUMENTS.md