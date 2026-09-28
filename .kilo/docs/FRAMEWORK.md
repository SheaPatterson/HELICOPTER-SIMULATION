# **FRAMEWORK.md**

**Document Designation:** FRAMEWORK-SPEC-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Master Framework Specifications, Architectural Standards, Operational Directives, and AI Integration Blueprints for the Virtual HEMS Platform (virtualhems.com)

## **1\. Operational & Architectural Framework Overview**

### **1.1 Scope & Purpose**

This document establishes the overarching master framework for **Virtual HEMS**, a specialized flight-following, clinical simulation, and mission-coordination platform designed for Microsoft Flight Simulator (2020/2024) and X-Plane (11/12). Operating across Western Pennsylvania and broader regional network environments, the platform bridges desktop flight simulation mechanics with cloud-native dispatch logistics, live telemetry tracking, dynamic medical deterioration algorithms, and professional-grade Standard Operating Procedures (SOPs).  
`+-------------------------------------------------------------------------------------------------------+`  
`|                                  VIRTUAL HEMS PLATFORM FRAMEWORK                                      |`  
`+-------------------------------------------------------------------------------------------------------+`  
`|                                                                                                       |`  
`|    SIMULATOR LAYER                                                                                    |`  
`|    ┌──────────────────────────────────────────┐     ┌────────────────────────────────────────────┐    |`  
`|    │ MSFS 2020 / 2024 (SimConnect API) [14]   │     │ X-Plane 11 / 12 (FlyWithLua UDP Link) [27] │    |`  
`|    └────────────────────┬─────────────────────┘     └─────────────────────┬──────────────────────┘    |`  
`|                         │                                                 │                           |`  
`|                         └─────────────────────────┬───────────────────────┘                           |`  
`|                                                   │                                                   |`  
`|                                                   ▼                                                   |`  
`|    BRIDGE & DATA LINK LAYER                                                                           |`  
`|    ┌─────────────────────────────────────────────────────────────────────────────────────────────┐    |`  
`|    │ Standalone Desktop App (Windows .exe / Mac .dmg Client) [27]                                │    |`  
`|    │ - High-Rate Data Pipe (2 Hz Sampling Rate)                                                  │    |`  
`|    │ - Local Ring Buffer & Sub-Second Latency Telemetry Sync [5, 27]                              │    |`  
`|    └──────────────────────────────────────────────┬──────────────────────────────────────────────┘    |`  
`|                                                   │                                                   |`  
`|                                                   ▼                                                   |`  
`|    CLOUD BACKEND & AI ENGINE LAYER                                                                    |`  
`|    ┌─────────────────────────────────────────────────────────────────────────────────────────────┐    |`  
`|    │ Supabase Realtime Infrastructure & PostGIS Spatial Engine [5]                               │    |`  
`|    │ Ironpine AI Tactical Dispatch & Integrity Audit Engine [5, 14]                              │    |`  
`|    │ 260+ Condition Medical Simulation Matrix ("Golden Hour" Decay Logic) [5]                    │    |`  
`|    └──────────────────────────────────────────────┬──────────────────────────────────────────────┘    |`  
`|                                                   │                                                   |`  
`|                                                   ▼                                                   |`  
`|    TACTICAL WEB & EFB TERMINAL LAYER (virtualhems.com) [5, 14]                                        |`  
`|    ┌──────────────────────────────────┐ ┌──────────────────────────────────┐ ┌──────────────────┐ |`  
`|    │ Live Theater Command Map [5, 14] │ │ 4-Stage Mission Dispatcher [14]  │ │ Pilot EFB [14]   │ |`  
`|    └──────────────────────────────────┘ └──────────────────────────────────┘ └──────────────────┘ |`  
`+-------------------------------------------------------------------------------------------------------+`

### **1.2 Core Organizational Directives**

> 1. **Integrity:** Transparent and honest logging of simulator telemetry, flight parameters, weather minimums, and incident reports without fear of punitive action.  
> 2. **Reliability:** Strict procedural compliance with assigned flight profiles, clinical time-on-scene requirements, and standard radiotelephony protocols.  
> 3. **Service:** Delivering authentic critical care transport simulation while preserving simulated patient dignity and absolute confidentiality across public networks.

## **2\. Platform Architecture & Data Pipeline Specifications**

### **2.1 Multi-Engine Bridge Mechanics**

The platform utilizes a dual-engine telemetry extraction pipeline enabling cross-platform coordination between MSFS and X-Plane pilots:

> * **MSFS (2020 / 2024):** Native C++ / C\# SimConnect wrappers embedded in the desktop application poll flight dynamics memory blocks at a rate of 2\\text{ Hz} to 10\\text{ Hz}.  
> * **X-Plane (11 / 12):** A lightweight FlyWithLua script (hems-dispatch-xp.lua) hooks simulator datarefs (position, groundspeed, altitude, engine torque, fuel) and streams JSON packets over localhost UDP port 8080 to the desktop application.

### **2.2 Tactical Integration & Web Uplink**

> * **Protocol Identifier:** Protocol v5.3.0-STABLE.  
> * **Security & Authentication:** Each simulator instance authenticates using a unique user API key linked to virtualhems.com.  
> * **Realtime Streaming:** Telemetry packets are delta-compressed and published to Supabase Realtime channels, driving the live global theater map and cockpits EFBs with sub-second latency.

## **3\. Medical Simulation & Dispatch Engine Framework**

### **3.1 Medical Emergency Matrix**

The platform incorporates a clinical database featuring over 260 distinct medical conditions across trauma, cardiac, stroke, pediatric, and environmental categories.  
`+-------------------------------------------------------------------------------------------------------+`  
`|                               CLINICAL DISPATCH & PATIENT MATRIX                                      |`  
`+--------------------------+---------------------------------------+------------------------------------+`  
`| Condition Category       | Sample Pathology                      | Required Receiving Capability      |`  
`+--------------------------+---------------------------------------+------------------------------------+`  
`| Major Blunt Trauma       | Polytrauma / Flail Chest              | Level 1 Trauma Center [5, 8]       |`  
`| Neurotrauma              | Epidural Hematoma / GCS <= 8          | Comprehensive Stroke / Level 1 [8] |`  
`| Acute Cardiac            | STEMI / Cardiogenic Shock             | Cath-Capable Tertiary Hub [8]      |`  
`| High-Risk Obstetrics     | Eclampsia / Severe Abruptio           | Specialty OB Center [8]            |`  
`+--------------------------+---------------------------------------+------------------------------------+`

### **3.2 Dynamic "Golden Hour" Deterioration Engine**

> * **Countdown Initiation:** Every scene dispatch activates a 60-minute "Golden Hour" timer.  
> * **On-Scene Threshold:** Crews are allocated a maximum of 15:00 minutes on scene for patient assessment, stabilization, and hot-loading.  
> * **Physiological Decay:** Delays beyond 15:00 minutes trigger dynamic Glasgow Coma Scale (GCS) decay algorithms, degrading patient vitals and reducing the final mission score generated during the automated After-Action Review (AAR).

## **4\. Regional Infrastructure Specification (Western PA Focus)**

### **4.1 STAT MedEvac Base Stations**

Headquartered at Allegheny County Airport (KAGC) in West Mifflin, PA:  
`+-------------------------------------------------------------------------------------------------------+`  
`|                            STAT MEDEVAC REGIONAL BASE NETWORK                                         |`  
`+------------------+---------+-----------+-----------------------------------+-----------+--------------+`  
`| Base Identifier  | FAA ID  | Tail #    | Base Location                     | Elev (ft) | Primary Asset|`  
`+------------------+---------+-----------+-----------------------------------+-----------+--------------+`  
`| Stat MedEvac 1   | 60PN    | N527ME    | Washington Hospital               | 1156      | EC135 [8]    |`  
`| Stat MedEvac 2   | PA28    | N530ME    | Air Rescue East (Latrobe)         | 1251      | H135 [8]     |`  
`| Stat MedEvac 3   | PA56    | N536ME    | UPMC Passavant - Cranberry        | 1100      | H135 [8]     |`  
`| Stat MedEvac 4   | KAGC    | N507ME    | Allegheny County Airport (HQ)     | 1251      | EC145 [8]    |`  
`| Stat MedEvac 5   | KVVS    | N307ME    | Joseph A. Hardy Connellsville Apt | 1264      | EC145 [8]    |`  
`| Stat MedEvac 6   | KAXQ    | N533ME    | Clarion County Airport            | 1457      | H135 [8]     |`  
`| Stat MedEvac 7   | KGKJ    | N884ME    | Port Meadville Airport            | 1399      | EC135 [8]    |`  
`| Stat MedEvac 8   | 29D     | N536ME    | Grove City Airport                | 1370      | H135 [8]     |`  
`| Stat MedEvac 9   | KFIG    | N855ME    | Clearfield-Lawrence Airport       | 1516      | EC135 [8]    |`  
`| Stat MedEvac 11  | 74PN    | N448ME    | UPMC Altoona                      | 1259      | EC135 [8]    |`  
`| Stat MedEvac 16  | 81PN    | N915ME    | Armstrong County Memorial Hosp    | 1141      | EC135 [8]    |`  
`| Stat MedEvac 17  | 39PS    | N87ME     | Harborcreek Heliport              | 760       | EC135 [8]    |`  
`+------------------+---------+-----------+-----------------------------------+-----------+--------------+`

### **4.2 AHN LifeFlight Base Stations**

Operated by Allegheny Health Network (AHN):  
`+-------------------------------------------------------------------------------------------------------+`  
`|                            AHN LIFEFLIGHT REGIONAL BASE NETWORK                                       |`  
`+------------------+---------+-----------+-----------------------------------+-----------+--------------+`  
`| Base Identifier  | FAA ID  | Tail #    | Base Location                     | Elev (ft) | Primary Asset|`  
`+------------------+---------+-----------+-----------------------------------+-----------+--------------+`  
`| LifeFlight 1     | PA67    | N878LF    | Canonsburg Hospital               | 1169      | EC135 [25]   |`  
`| LifeFlight 2     | 91PA    | N131LF    | Clarion Hospital                  | 1489      | EC145 [25]   |`  
`| LifeFlight 3     | PN32    | N373LF    | Indiana Regional Medical Center   | 1285      | EC145 [25]   |`  
`| LifeFlight 4     | KBTP    | N474LF    | Pittsburgh/Butler Regional Apt    | 1248      | EC145 [25]   |`  
`| LifeFlight 5     | KFWQ    | N575LF    | Rostraver Airport                 | 1228      | EC145 [25]   |`  
`+------------------+---------+-----------+-----------------------------------+-----------+--------------+`

### **4.3 Primary Hospital Helipads Directory**

`+-------------------------------------------------------------------------------------------------------+`  
`|                           PRIMARY REGIONAL HOSPITAL HELIPAD DIRECTORY                                 |`  
`+-----------------------------------+--------+-------------------+-----------+----------+---------------+`  
`| Facility Name                     | FAA ID | Location          | Elev (ft) | Surface  | Placement     |`  
`+-----------------------------------+--------+-------------------+-----------+----------+---------------+`  
`| UPMC Presbyterian                 | PS78   | Pittsburgh, PA    | 1124      | Concrete | Rooftop [8]   |`  
`| UPMC Mercy                        | PN23   | Pittsburgh, PA    | 886       | Concrete | Rooftop [8]   |`  
`| UPMC Children's Hospital of Pgh   | 30PN   | Pittsburgh, PA    | 1088      | Concrete | Rooftop [8]   |`  
`| Allegheny General Hospital        | 42PN   | Pittsburgh, PA    | 804       | Concrete | Rooftop [8, 19]|`  
`| UPMC Hamot                        | 0PS8   | Erie, PA          | 900       | Concrete | Rooftop [8]   |`  
`| UPMC Altoona                      | 74PN   | Altoona, PA       | 1259      | Concrete | Rooftop [8]   |`  
`| Penn Highlands DuBois             | PA10   | DuBois, PA        | 1463      | Concrete | Ground [8]    |`  
`| Clarion Hospital                  | 91PA   | Clarion, PA       | 1489      | Concrete | Ground [8]    |`  
`| Butler Memorial Hospital          | PA41   | Butler, PA        | 1190      | Asphalt  | Ground [8]    |`  
`| Canonsburg Hospital               | PA67   | Canonsburg, PA    | 1169      | Concrete | Ground [8]    |`  
`+-----------------------------------+--------+-------------------+-----------+----------+---------------+`

## **5\. Aircraft Systems & Flight Dynamics Modeling**

### **5.1 Approved Fleet & Systems Breakdown**

> * **Eurocopter EC135 (P2+ / T2+):** Equipped with Central Panel Display System (CPDS), Vehicle and Engine Management Display (VEMD), First Limit Indicator (FLI), dual FADEC logic, and Fenestron anti-torque system.  
> * **Eurocopter EC145 (BK117 C-2):** Enlarged cabin volume (6.03\\text{ m}^3), rear clamshell doors for straight loading, and MEGHAS flight control display system.  
> * **Airbus H135 (5-Blade D-3):** Bearingless 5-bladed main rotor head and Helionix multi-display glass cockpit suite.

### **5.2 Autopilot & Flight Control System (AFCS) Logic**

> 1. **Stability Augmentation System (SAS \- Inner Loop):** Electro-hydraulic series actuators providing high-speed, low-authority (\\pm 10\\%-15\\%) rate damping across pitch, roll, and yaw axes.  
> 2. **Autopilot Outer Loop:** Full-authority parallel trim actuators maintaining coupled modes (ATT, ALT, HDG, IAS, VS, NAV, GA).  
> 3. **Force Trim & Beep Trim Mechanics:** Magnetic brakes provide artificial control resistance. Cyclic trim release switch disengages brakes for manual repositioning, while the 4-way beep trim switch permits fine attitude and airspeed adjustments.

## **6\. Implementation Phasing & AI Builder Roadmap**

An AI builder or development team executing the construction of the monorepo MUST follow a 4-phase rollout:  
`+-------------------------------------------------------------------------------------------------------+`  
`|                                   4-PHASE BUILD EXECUTION ROADMAP                                     |`  
`+-------------------------------------------------------------------------------------------------------+`  
`|  PHASE 1: MONOREPO & DATABASE FOUNDATION                                                              |`  
``|  - Initialize Turborepo structure (`apps/web`, `apps/bridge-desktop`, `packages/database`).           |``  
``|  - Deploy Supabase PostGIS schemas (`00001_initial_schema.sql`).                                      |``  
`|  - Populate seed scripts (STAT MedEvac, AHN LifeFlight, Hospital Helipads, 260+ Conditions) [8].      |`  
`+-------------------------------------------------------------------------------------------------------+`  
`|  PHASE 2: HARDWARE BRIDGE & TELEMETRY STREAMING                                                       |`  
``|  - Compile Tauri / Rust desktop client (`hems-bridge`) for Windows (.exe) and Mac (.dmg) [27].        |``  
``|  - Deploy `hems-dispatch-xp.lua` UDP pipe for X-Plane 11/12 (Port 8080) [27].                          |``  
`|  - Configure SimConnect listener for MSFS 2020/2024 [14, 27].                                         |`  
`|  - Establish sub-second WebSocket stream to Supabase Realtime [5, 27].                                |`  
`+-------------------------------------------------------------------------------------------------------+`  
`|  PHASE 3: WEB DASHBOARD, DISPATCH & GOLDEN HOUR ENGINE                                                |`  
``|  - Build Next.js Web App UI (`virtualhems.com`) [5, 14].                                             |``  
`|  - Implement 4-Stage Mission Dispatcher and EFB terminal [14].                                        |`  
`|  - Integrate Ironpine AI Tactical Engine for dispatch briefings and AAR audits [5, 14].               |`  
`|  - Deploy dynamic Golden Hour countdown timer and GCS decay logic [5].                                |`  
`+-------------------------------------------------------------------------------------------------------+`  
`|  PHASE 4: VERIFICATION & END-TO-END AUDITING                                                          |`  
`|  - Validate high-fidelity helipad elevation and coordinate alignment [8].                             |`  
`|  - Audit offline/online telemetry failover ring buffers [8].                                          |`  
`|  - Execute full mission lifecycle test (Dispatch -> Flight -> Scene -> Hot Load -> Landing -> AAR) [8, 14].|`  
`+-------------------------------------------------------------------------------------------------------+`

## **Document Control & Operational Sign-Off**

**Authored By:** Lead Tactical Architect & Flight Simulation Lead, Virtual HEMS **Approved By:** Directorate of Systems Engineering & Medical Operations Council, Virtual HEMS **Repository Location:** virtualhems-monorepo/docs/FRAMEWORK.md