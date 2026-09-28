# **AGENTS.md**

**Document Designation:** AGT-SPEC-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Operational Directives, Task Scaffolding, Autonomous Tool Boundaries, and Agent Swarm Protocols for virtualhems.com

## **1\. Ecosystem Overview & Multi-Agent Architecture**

The Virtual HEMS platform (virtualhems.com) is a mission-dispatch, telemetry-processing, and clinical-tracking platform for desktop flight simulators (Microsoft Flight Simulator 2020/2024 and X-Plane 11/12). The multi-agent swarm architecture operates across backend automation, live flight monitoring, and user-facing interactive elements.  
`+---------------------------------------------------------------------------------------------------+`  
`|                           VIRTUAL HEMS MULTI-AGENT SWARM TOPOLOGY                                 |`  
`+---------------------------------------------------------------------------------------------------+`  
`|  [SIMULATOR TELEMETRY STREAM @ UDP 8080] --> [DESKTOP BRIDGE CLIENT (Tauri/Rust)] [8, 12]        |`  
`+---------------------------------------------------------------------------------------------------+`  
                                                 `│`  
                                                 `▼ (WebSocket 2 Hz Synchronization) [8, 12]`  
`+---------------------------------------------------------------------------------------------------+`  
`|  apps/web/ (Next.js 14+ / virtualhems.com)                                                        |`  
`|  ├── AGENT 1: Tactical Dispatch & AI Briefing Engine (/api/dispatch/ai-briefing) [8, 12, 13]      |`  
`|  ├── AGENT 2: Telemetry Ingestion & Physics Validator (/api/telemetry) [8, 12, 13]               |`  
`|  ├── AGENT 3: Clinical Deterioration & Vitals Engine (/efb) [8, 12, 13]                           |`  
`|  └── AGENT 4: Safety & After-Action Audit Agent (/api/aar & /sms-report) [8, 12, 13]             |`  
`+---------------------------------------------------------------------------------------------------+`  
`|  packages/database/ (Supabase PostgreSQL + PostGIS Spatial Indexing) [8, 12]                      |`  
`+---------------------------------------------------------------------------------------------------+`

## **2\. Agent Class Definitions & Task Scaffolding**

### **2.1 AGENT-01: Tactical Dispatcher & AI Briefing Engine (ironpine-dispatch)**

> * **Primary Domain:** Call intake, METAR weather processing, hospital facility recommendation, and PAVE risk scoring.  
> * **Execution Boundary:** Serverless route /api/dispatch/ai-briefing.  
> * **Task Scaffolding:**  
  1. Parse dispatch parameters (Scene Call vs. Inter-Facility Transfer).  
  2. Query PostGIS for regional bases (STAT MedEvac / AHN LifeFlight) and target trauma centers (e.g., UPMC Presbyterian PS78, Allegheny General 42PN).  
  3. Evaluate METAR conditions against visual flight rules (VFR) minima.  
  4. Compute quantified PAVE risk score:

> \\text{Risk Score} \= P\_{\\text{Pilot}} \+ A\_{\\text{Aircraft}} \+ V\_{\\text{EnVironment}} \+ E\_{\\text{External}}

> * **Mandatory Threshold:** If total PAVE score \> 30, automatically issue a **MISSION NO-GO** decision.

### **2.2 AGENT-02: Telemetry Ingestion & Physics Validator (telemetry-bridge)**

> * **Primary Domain:** Ingesting 2 Hz telemetry frames from Tauri desktop bridge clients, checking flight envelope parameters, and updating live tactical maps (/command).  
> * **Execution Boundary:** Serverless route /api/telemetry & WebSocket channels.  
> * **Task Scaffolding:**  
  1. Validate incoming JSON payload against TelemetryFrame TypeScript schema.  
  2. Verify kinematic parameters: pitch, roll, angular rates, rotor RPM, TOT, and engine torque (TRQ).  
  3. Validate First Limit Indicator (FLI) values for airframes (EC135, EC145, H135):

> \\text{FLI Value} \= \\max\\left(\\%N\_1, \\%\\text{TOT}, \\%\\text{TRQ}\\right)

> 1. Broadcast validated spatial coordinates to Supabase Realtime channels.

### **2.3 AGENT-03: Clinical Deterioration & Vitals Engine (clinical-vitals)**

> * **Primary Domain:** Tracking real-time patient degradation based on medical condition parameters and flight duration.  
> * **Execution Boundary:** In-cockpit EFB (/efb) & dynamic hooks (useGoldenHour).  
> * **Task Scaffolding:**  
  1. Initialize baseline Glasgow Coma Scale (GCS) and medical condition parameters (from a 260+ condition matrix).  
  2. Execute time-based exponential deterioration algorithms:

> \\text{GCS}(t) \= \\text{GCS}\_{\\text{baseline}} \\cdot e^{-\\lambda \\cdot t}

> 1. Update vitals display every 5 seconds on the Electronic Flight Bag interface.  
> 2. Flag critical alerts when GCS drops below 8 or elapsed time exceeds the 60-minute Golden Hour.

### **2.4 AGENT-04: Safety & After-Action Review Audit Agent (sms-audit)**

> * **Primary Domain:** Post-mission analysis, pilot logbook recording, and Virtual Incident Reporting System (VIRS) processing.  
> * **Execution Boundary:** Serverless routes /api/aar & /api/virs.  
> * **Task Scaffolding:**  
  1. Receive flight completion payload upon landing detection.  
  2. Audit flight envelope parameters (maximum G-force, landing vertical speed, engine limits).  
  3. Calculate mission flight duration and update pilot logbook statistics.  
  4. File non-punitive VIRS incident reports to the Safety Management System database if parameters were exceeded.

## **3\. Autonomous Tool & Operational Boundaries**

`+---------------------------------------------------------------------------------------------------+`  
`|                                AGENT AUTONOMY PERMISSION MATRIX                                   |`  
`+-------------------+----------------------------+-----------------------+--------------------------+`  
`| Agent Name        | Direct DB Write Access     | System Control Bounds | Human Override Required? |`  
`+-------------------+----------------------------+-----------------------+--------------------------+`  
``| `ironpine-dispatch`| Mission Tables Only       | Mission Brief Generation| Yes (PIC Acceptance)     |``  
``| `telemetry-bridge`| Telemetry Logs Only        | Realtime Coordinate Stream| No                     |``  
``| `clinical-vitals` | Patient State Logs         | Vitals/GCS Simulation | No                       |``  
``| `sms-audit`       | Logbook & VIRS Tables      | Performance Audit     | Yes (Safety Officer)     |``  
`+-------------------+----------------------------+-----------------------+--------------------------+`

### **3.1 Strict System Constraints**

> * **Safety & Autonomy Boundaries:** Agents must not alter pilot credentials, clear VIRS reports, or bypass PAVE NO-GO determinations.  
> * **Data Contracts:** All cross-agent communication must use shared TypeScript interfaces defined in packages/shared-types/.  
> * **Deterministic Fallbacks:** If an external LLM/AI dispatch call fails, the dispatch agent must fall back to rule-based METAR checks and default regional receiving facilities.

## **4\. Compliance & Verification Matrix**

| Verification Target | Audit Method | Success Threshold |
| :---- | :---- | :---- |
| **Dispatch Agent** | PAVE Matrix Calculation Test | Blocks dispatch when Risk Score \> 30\. |
| **Telemetry Agent** | Simulated UDP Packet Ingestion | Processes 2 Hz stream with latency \\le 50\\text{ ms}. |
| **Clinical Agent** | GCS Decay Test | Accurately calculates decay over 60-minute window. |
| **Audit Agent** | After-Action Review Validation | Correctly logs mission duration and land-event metrics. |

**Authored By:** Chief Systems Architect & Lead AI Engineer, Virtual HEMS Platform **Approved By:** Directorate of Technology & Operational Safety Council **Repository Location:** virtualhems-monorepo/docs/AGENTS.md