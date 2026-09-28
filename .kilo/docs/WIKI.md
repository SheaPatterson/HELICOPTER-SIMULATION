# **Master Documentation Index & Technical Specifications (WIKI.md)**

**Document Designation:** WIKI-SPEC-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Complete Master Technical Specification, Platform Architecture Map, Operational Standards, and Documentation Index for Virtual HEMS (virtualhems.com)

## **1\. System Vision & Monorepo Architecture**

Virtual HEMS (virtualhems.com) is a professional-grade companion platform and tactical operations center engineered specifically for Helicopter Emergency Medical Services (HEMS) simulation. It bridges consumer flight simulators—Microsoft Flight Simulator (2020/2024) and Laminar Research X-Plane (11/12)—with a cloud-native mission dispatcher, clinical tracking engine, and in-cockpit Electronic Flight Bag (EFB).  
The ecosystem is built within a version-controlled Turborepo workspace:  
`+---------------------------------------------------------------------------------------------------+`  
`|                            VIRTUAL HEMS FULL-STACK ARCHITECTURE                                   |`  
`+---------------------------------------------------------------------------------------------------+`  
`|  FLIGHT SIMULATOR ENGINES                                                                        |`  
`|  [ Microsoft Flight Simulator (2020 / 2024) ]    [ Laminar Research X-Plane (11 / 12) ]           |`  
`|         │ (SimConnect C++ / Rust)                       │ (FlyWithLua UDP Script) [19]            |`  
`|         └───────────────────────────┬───────────────────┘                                         |`  
`|                                     ▼                                                             |`  
`|  DESKTOP BRIDGE CLIENT (apps/bridge-desktop/)                                                     |`  
`|  Tauri / Rust Standalone Application Listening on Local Port 8080 [19]                            |`  
`|         │                                                                                         |`  
`|         ▼ (Encrypted WebSocket / 2 Hz Realtime Uplink) [19]                                       |`  
`|  WEB COMMAND TERMINAL (apps/web/ @ virtualhems.com) [19]                                          |`  
`|  ├── /command      --> Live Regional Tactical Overwatch Map [19]                                  |`  
`|  ├── /dispatcher   --> 4-Stage Mission Dispatch Planner [19]                                    |`  
`|  ├── /efb          --> Cockpit Electronic Flight Bag & Dynamic Patient Engine [19]                |`  
`|  └── /api/dispatch --> Ironpine AI Tactical Dispatch Engine [19]                                  |`  
`+---------------------------------------------------------------------------------------------------+`  
`|  DATABASE & SHARED PACKAGES (packages/)                                                           |`  
`|  ├── packages/database/     --> PostgreSQL + PostGIS Spatial Engine & Seed Libraries [19]         |`  
`|  ├── packages/shared-types/ --> Universal TypeScript Contracts [19]                               |`  
`|  └── packages/plugins/      --> Simulator Telemetry Integration Scripts [19]                     |`  
`+---------------------------------------------------------------------------------------------------+`

## **2\. Core Repository Documentation Directory**

### **2.1 Technical & Systems Specifications (docs/)**

> * **README.md:** Primary entrypoint covering system topology, quick-start guide, and build instructions.  
> * **ARCHITECTURE.md:** Architectural specification outlining the multi-engine telemetry pipe, WebSocket distribution, and client boundaries.  
> * **SCHEMATICS.md:** Technical ASCII system maps detailing avionics buses, CPDS/VEMD logic, AFCS loops, and rotor physics maps.  
> * **TECH-STACK.md:** Full-stack technology matrix specifying Next.js 14+, Tauri/Rust, Supabase PostgreSQL, PostGIS, and FlyWithLua.  
> * **REQUIREMENTS.md:** Functional, technical, clinical, and infrastructure requirements matrix with verification conditions.  
> * **FRAMEWORK.md:** Master operational directives governing flight accuracy, Crew Resource Management (CRM), and regional infrastructure.  
> * **TASKS.md:** 4-phase master engineering action plan, task index, and end-to-end acceptance checklist.  
> * **BLUEPRINT.md:** System architectural summary detailing database schemas, seed datasets, bridge entrypoints, and CI/CD pipelines.  
> * **REQUIRED-DOCUMENTS.md:** Master directory index and specification sheet for all platform software deliverables.  
> * **DOCUMENT-STRUCTURE.md:** Structural reference mapping every file, module, and directory within the monorepo workspace.  
> * **APP-MAP.md:** Complete route hierarchy, navigation map, and UI layout breakdown.  
> * **LIVING-ENGINEERING-HANDBOOK.md:** Mathematical physics reference covering 6-DOF equations of motion, blade flapping, and AFCS mechanics.  
> * **AI-INSTRUCTIONS.md:** System directives, task scaffolding, and operational boundaries for AI agent swarms.  
> * **AGENTS.md:** Multi-agent swarm topology detailing autonomous boundaries for dispatch, telemetry, clinical, and safety agents.  
> * **ACCOUNT-SETUP.md:** Pilot onboarding manual, API pairing guide, and desktop bridge installation procedures.

### **2.2 Operational Flight & Clinical Manuals (docs/vhop/)**

> * **VHOP-01-SOP.md:** Standard Operating Procedures detailing Safety Management Systems (SMS), Virtual Incident Reporting (VIRS), CRM, and landing zone (LZ) safety.  
> * **VHOP-02-SYSTEMS.md:** Technical Airframe Operating Manual covering Eurocopter EC135 (P2+/T2+), EC145, and Airbus H135/H145, including CPDS, VEMD, FLI, and 4-axis AFCS logic.  
> * **VHOP-03-DYNAMICS.md:** Fundamentals of helicopter aerodynamics detailing ETL, VRS, LTE, blade flapping dynamics, and autorotation mechanics.  
> * **VHOP-04-CLINICAL.md:** Critical Care Logistics Manual defining the 260+ medical condition database, Golden Hour GCS decay algorithms, and regional hospital helipad directories.

## **3\. Subsystem Architecture & Route Directory**

### **3.1 Next.js Web Command Terminal (apps/web/)**

| Navigation Route | Primary Functional Responsibility |
| :---- | :---- |
| /command | Live regional tactical overwatch map displaying active rotorcraft vectors, base overlays, and helipads. |
| /dispatcher | 4-Stage Mission Dispatch Planner (Stage 1: Details/WX, Stage 2: Roster, Stage 3: Clinical, Stage 4: PAVE Risk). |
| /efb | In-cockpit Electronic Flight Bag displaying dynamic patient vitals, GCS tracking, and SOP checklists. |
| /hospitals | Regional trauma center directory, helipad specifications, elevation data, and approach briefing assets. |
| /logbook | Individual pilot career flight log tracking flight hours, landings, and mission sorties. |
| /archive | Historical transport log database and After-Action Review (AAR) audit archive. |
| /sms-report | Non-punitive Virtual Incident Reporting System (VIRS) submission portal. |

### **3.2 Desktop Bridge Subsystem (apps/bridge-desktop/)**

| Module Path | Primary System Responsibility |
| :---- | :---- |
| src-tauri/src/main.rs | Tauri Rust application entrypoint binding local UDP socket listener to port 8080\. |
| src-tauri/src/simconnect/mod.rs | MSFS 2020/2024 C++/Rust shared memory polling interface (2\\text{ Hz} to 10\\text{ Hz}). |
| src-tauri/src/xplane\_udp/mod.rs | Local UDP packet decoder parsing FlyWithLua JSON telemetry streams from X-Plane 11/12. |
| src-tauri/src/uploader.rs | Encrypted WebSocket publisher streaming telemetry frames to Supabase Realtime. |

## **4\. Mathematical Foundations & Clinical Engine**

### **4.1 First-Order Blade Flapping Dynamics**

Main rotor cyclic pitch inputs (\\theta\_{1s}, \\theta\_{1c}) drive first-order flapping response (\\beta\_{1s}, \\beta\_{1c}):  
\\tau\_{\\text{flap}} \\dot{\\beta}\_{1s} \+ \\beta\_{1s} \= \-\\theta\_{1c} \+ \\frac{p}{\\Omega} \- \\left( \\frac{16}{\\gamma \\Omega} \\right) q \\tau\_{\\text{flap}} \\dot{\\beta}\_{1c} \+ \\beta\_{1c} \= \\theta\_{1s} \- \\frac{q}{\\Omega} \- \\left( \\frac{16}{\\gamma \\Omega} \\right) p  
Where \\gamma \= \\frac{\\rho c a R^4}{I\_\\beta} represents the Lock Number and \\tau\_{\\text{flap}} \= \\frac{16}{\\gamma \\Omega} is the rotor flapping time constant.

### **4.2 Clinical Deterioration & Golden Hour Logic**

Patient Glasgow Coma Scale (GCS) decay across 260+ conditions follows an exponential curve relative to transport time (t in minutes):

\\text{GCS}(t) \= \\text{GCS}\_{\\text{baseline}} \\cdot e^{-\\lambda \\cdot t}

### **4.3 Quantified PAVE Risk Assessment Matrix**

Before flight authorization in Stage 4 of the Dispatcher, a PAVE score is derived:  
> \\text{Risk Score} \= P\_{\\text{Pilot}} \+ A\_{\\text{Aircraft}} \+ V\_{\\text{EnVironment}} \+ E\_{\\text{External}}

> * **Mandatory Constraint:** A score exceeding 30 enforces an immediate **MISSION NO-GO** determination.

## **5\. Regional Infrastructure Directory (Western PA)**

### **5.1 Primary HEMS Bases**

> * **STAT 1:** Washington Hospital, Washington, PA (Eurocopter EC135).  
> * **STAT 3:** Cranberry Township, PA (Airbus H135).  
> * **STAT 4 (HQ):** Allegheny County Airport (KAGC), West Mifflin, PA (Airbus H145).  
> * **STAT 6:** Clarion County Airport (KAXQ), Clarion, PA (Eurocopter EC135).  
> * **LifeFlight 1:** Canonsburg Hospital, Canonsburg, PA (EC145/H145).  
> * **LifeFlight 4:** Pittsburgh-Butler Regional Airport (KBTP), Butler, PA (EC145/H145).

### **5.2 Key Receiving Trauma Hubs**

> * **UPMC Presbyterian (PS78):** Pittsburgh, PA — Rooftop Pad (65 \\times 65\\text{ ft}, Concrete), Level 1 Trauma.  
> * **Allegheny General Hospital (42PN):** Pittsburgh, PA — Rooftop Pad (60 \\times 60\\text{ ft}, Steel/Concrete), Level 1 Trauma.  
> * **UPMC Mercy (PN23):** Pittsburgh, PA — Rooftop Pad, Level 1 Trauma & Comprehensive Burn Center.  
> * **UPMC Children's Hospital (30PN):** Pittsburgh, PA — Dedicated Pediatric Level 1 Trauma Rooftop Pad.

## **6\. System Compliance & Audit Matrix**

`+---------------------------------------------------------------------------------------------------+`  
`|                                MASTER SYSTEM AUDIT SPECIFICATION                                  |`  
`+-------------------+------------------------------------+------------------------------------------+`  
`| Subsystem Target  | Verification Method                | Success Criteria                         |`  
`+-------------------+------------------------------------+------------------------------------------+`  
``| Monorepo Build    | `npx turbo run build`              | Clean compilation across web & bridge [19]|``  
`| Desktop Bridge    | Local UDP Binding (Port 8080)      | Successfully receives FlyWithLua packets [19]|`  
`| Telemetry Pipe    | WebSocket Realtime Sync            | Ingestion latency <= 50ms at 2 Hz [19]   |`  
`| PAVE Matrix       | Stage 4 Authorization Check        | Automatic NO-GO when Risk Score > 30 [19]|`  
`| Clinical Engine   | 60-Min Golden Hour Execution       | Accurately applies GCS exponential decay [19]|`  
`+-------------------+------------------------------------+------------------------------------------+`

**Authored By:** Chief Systems Architect & Lead Software Engineer, Virtual HEMS **Approved By:** Directorate of Technology & Operational Safety Council **Repository Location:** virtualhems-monorepo/WIKI.md