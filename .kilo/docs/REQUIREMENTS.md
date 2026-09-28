# **REQUIREMENTS.md**

**Document Designation:** REQ-SPEC-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Functional, Technical, Operational, and Infrastructure Requirements for the Virtual HEMS Simulation Platform (virtualhems.com)

## **1\. Functional & Operational Requirements**

### **1.1 Organizational Governance & Core Values Compliance**

> * **REQ-GOV-001 (Core Values Enforcement):** The platform MUST enforce operational compliance with the three core pillars: **Integrity** (accurate logging and honest self-reporting of telemetry/virts), **Reliability** (procedural timeline and VHOP-01 adherence), and **Service** (simulated patient dignity and ethical conduct).  
> * **REQ-GOV-002 (Public Safety Charter):** The system MUST publish a dedicated Safety Charter detailing the Safety Management System (SMS) framework, mandatory Crew Resource Management (CRM) rules, and recurrent training requirements (IFR/NVG).  
> * **REQ-GOV-003 (Operations Plan Transparency):** A public-facing summary or Table of Contents (TOC) of the Virtual HEMS Operations Manual (VHOP-01) MUST be accessible for operational transparency and virtual regulatory validation.

### **1.2 Flight Simulation & Fleet Integration**

> * **REQ-FLT-001 (Multi-Engine Support):** The platform MUST support simultaneous telemetry extraction from Microsoft Flight Simulator (MSFS 2020/2024) via native SimConnect APIs and X-Plane (11/12) via local FlyWithLua UDP sockets on port 8080\.  
> * **REQ-FLT-002 (Fleet Capabilities Mapping):** The platform MUST track and validate approved virtual airframes (Eurocopter EC135, EC145, Airbus H135, Bell 407\) linked to their respective medical loadout configurations and critical care transport capabilities.  
> * **REQ-FLT-003 (Avionics & Flight Systems Modeling):** The platform MUST support procedural operations for Central Panel Display Systems (CPDS), Vehicle Engine Management Displays (VEMD), First Limit Indicators (FLI), and 4-Axis Automatic Flight Control Systems (AFCS) including SAS, Attitude Hold, Force Trim, and Beep Trim mechanics.

## **2\. Technical & Performance Requirements**

### **2.1 Hardware Bridge & Telemetry Streaming**

> * **REQ-BRG-001 (Sampling Rate & Latency):** The desktop bridge (Tauri/Rust) MUST sample simulator kinematic state vectors at a frequency of 2\\text{ Hz} to 10\\text{ Hz} and transmit delta-compressed packets to the cloud backend with sub-second latency.  
> * **REQ-BRG-002 (Offline Failover Storage):** The desktop bridge MUST feature an automatic SQLite ring buffer that stores telemetry locally during network disconnects and auto-flushes to Supabase upon connection restoration.  
> * **REQ-BRG-003 (Cross-Platform Execution):** The bridge executable MUST compile natively for Windows 10/11 (x86\_64) and macOS (x86\_64 / aarch64 Apple Silicon).

### **2.2 Database & Geospatial Architecture**

> * **REQ-DAT-001 (PostGIS Geospatial Engine):** The database MUST run on PostgreSQL 15+ with PostGIS enabled, executing spatial proximity, radial boundary, and elevation queries across regional base stations and hospital helipads.  
> * **REQ-DAT-002 (Database Schemas):** The database MUST contain strict tables for pilot profiles, base stations (18 STAT MedEvac, 5 AHN LifeFlight), hospital helipads, a 260+ medical condition matrix, active/historical missions, and real-time telemetry logs.  
> * **REQ-DAT-003 (Row Level Security):** All pilot telemetry and profile updates MUST be secured via PostgreSQL Row Level Security (RLS) policies matching authenticated user credentials.

## **3\. Clinical & Dispatch Module Requirements**

### **3.1 Medical Engine & Golden Hour Logic**

> * **REQ-MED-001 (Timed Deterioration Algorithm):** Upon scene dispatch, the medical engine MUST initiate a "Golden Hour" countdown timer (60:00\\text{ minutes}) that dynamically reduces patient Glasgow Coma Scale (GCS) scores and physiological stability when on-scene time exceeds 15:00\\text{ minutes}.  
> * **REQ-MED-002 (260+ Condition Matrix):** The clinical database MUST categorize medical emergencies (Trauma, Cardiac, Stroke, High-Risk OB, Pediatric) and map them to baseline GCS thresholds and required facility capabilities (e.g., Level 1 Trauma Center, Comprehensive Stroke Center).  
> * **REQ-MED-003 (After-Action Review Engine):** Upon landing at a hospital destination, the platform MUST automatically audit flight telemetry, pitch/roll limits, touchdown G-force, reserve fuel margins, and time-on-scene to generate a performance score.

### **3.2 Dispatcher UI & Regional Infrastructure**

> * **REQ-DSP-001 (4-Stage Dispatch Flow):** The web terminal MUST provide a step-by-step dispatch workflow: Stage 1 (Details/Type), Stage 2 (Crew Roster), Stage 3 (Clinical/GCS Matrix), and Stage 4 (Flight Plan & ORM Risk Scoring).  
> * **REQ-DSP-002 (Ironpine AI Briefing Engine):** The dispatch system MUST integrate an AI briefing generator that evaluates patient metrics and weather inputs to issue tactical landing zone (LZ) and receiving facility recommendations.  
> * **REQ-DSP-003 (Regional Infrastructure Coverage):** The system MUST maintain high-fidelity coordinates, helipad surface types, dimensions, and elevations for all major Western Pennsylvania and Tri-State facilities (e.g., UPMC Presbyterian, Allegheny General Hospital, UPMC Mercy, UPMC Hamot).

## **4\. Requirement Verification & Acceptance Criteria**

`+-------------------------------------------------------------------------------------------------------+`  
`|                                    REQUIREMENT VERIFICATION MATRIX                                    |`  
`+-------------------+-----------------------------------+-----------------------------------------------+`  
`| Requirement ID    | Verification Method               | Acceptance Pass Condition                     |`  
`+-------------------+-----------------------------------+-----------------------------------------------+`  
`| REQ-GOV-001/002   | Automated Compliance Audit        | Safety Charter and TOC public links active    |`  
`| REQ-FLT-001       | Live Telemetry Integration Test   | Concurrent streaming from MSFS and X-Plane    |`  
`| REQ-BRG-001/002   | Network Fault Simulation          | Sub-second live sync; zero data loss on drop  |`  
`| REQ-DAT-001/002   | PostGIS Spatial Query Audit       | Correct radial distance and base resolution    |`  
`| REQ-MED-001/003   | Clinical Engine Stress Run        | Dynamic GCS decay and post-flight AAR output  |`  
`| REQ-DSP-001/003   | End-to-End Mission Lifecycle Test | Complete dispatch-to-landing lifecycle log     |`  
`+-------------------+-----------------------------------+-----------------------------------------------+`

**Authored By:** Lead Systems Engineer & Technical Architect, Virtual HEMS **Approved By:** Executive Council, Virtual HEMS Platform Development **Repository Target:** virtualhems-monorepo/docs/REQUIREMENTS.md