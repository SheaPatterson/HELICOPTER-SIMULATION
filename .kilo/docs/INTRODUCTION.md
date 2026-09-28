# **Welcome to Virtual HEMS (virtualhems.com)**

**System Designation:** DOC-INTRO-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Target Platform:** Virtual HEMS Companion Ecosystem (virtualhems.com)

## **1\. Executive Summary & Mission Charter**

**Virtual HEMS** (virtualhems.com) is a professional companion application and flight-following ecosystem engineered specifically for Helicopter Emergency Medical Services (HEMS) simulation. Designed for both simulation newcomers and experienced virtual aviators, the platform bridges consumer desktop flight simulators—primarily **Microsoft Flight Simulator (2020 / 2024\)** and **Laminar Research X-Plane (11 / 12\)**—with a cloud-native dispatcher, clinical tracking hub, and interactive cockpit Electronic Flight Bag (EFB).  
The platform emphasizes authentic regional medical operations across Western Pennsylvania and the tri-state area. It simulates real-world air ambulance operations modeled after regional leaders, including **STAT MedEvac** and **Allegheny Health Network (AHN) LifeFlight**.  
`+---------------------------------------------------------------------------------------------------+`  
`|                            VIRTUAL HEMS PLATFORM TOPOLOGY                                         |`  
`+---------------------------------------------------------------------------------------------------+`  
`|  FLIGHT SIMULATION ENGINES                                                                        |`  
`|  [ Microsoft Flight Simulator (2020 / 2024) ]    [ Laminar Research X-Plane (11 / 12) ]           |`  
`|         │ (SimConnect C++ / Rust)                       │ (FlyWithLua UDP Script) [3]             |`  
`|         └───────────────────────────┬───────────────────┘                                         |`  
`|                                     ▼                                                             |`  
`|  DESKTOP BRIDGE CLIENT (apps/bridge-desktop/)                                                     |`  
`|  Tauri / Rust Standalone Application Listening on Local Port 8080 [3]                             |`  
`|         │                                                                                         |`  
`|         ▼ (Encrypted WebSocket / 2 Hz Realtime Uplink) [3]                                        |`  
`|  WEB COMMAND TERMINAL (apps/web/ @ virtualhems.com) [3]                                           |`  
`|  ├── /command      --> Live Regional Tactical Overwatch Map [3]                                   |`  
`|  ├── /dispatcher   --> 4-Stage Mission Dispatch Planner [3]                                     |`  
`|  ├── /efb          --> Cockpit Electronic Flight Bag & Dynamic Patient Engine [3]                 |`  
`|  └── /api/dispatch --> Ironpine AI Tactical Dispatch Engine [3]                                   |`  
`+---------------------------------------------------------------------------------------------------+`

## **2\. Platform Core Domains & Pillars**

Virtual HEMS integrates four core domains to deliver an immersive and realistic experience:

### **2.1 4-Stage Mission Dispatcher**

Coordinates emergency scene calls and inter-facility hospital transfers through structured validation steps:

> 1. **Stage 1 (Details & Weather):** Mission classification, base station assignment, and real-time METAR weather parsing.  
> 2. **Stage 2 (Crew Roster):** Roster assignment for Pilot-in-Command (PIC), Flight Nurse (PHRN), and Flight Paramedic/Communications Specialist.  
> 3. **Stage 3 (Patient Info):** Demographic inputs, 260+ medical condition configurations, and initial Glasgow Coma Scale (GCS) scoring.  
> 4. **Stage 4 (Flight Plan & PAVE Risk):** Automated fuel reserve verification and a quantified PAVE risk matrix evaluation.

### **2.2 Dynamic Patient Clinical Engine & Golden Hour Timer**

Simulates physiological deterioration during transport:

> * **Glasgow Coma Scale (GCS) Decay:** Evaluates real-time patient decay across 260+ medical conditions using time-sensitive exponential decay algorithms.  
> * **60-Minute Golden Hour Clock:** Dynamic countdown tracking from call acceptance to touchdown at a receiving trauma center.

### **2.3 Airframe Integration & Aerodynamics**

Tailored system manuals, startup checklists, and flight dynamics references for primary medical airframes:

> * **Eurocopter EC135 (P2+/T2+) / Airbus H135:** Features Central Panel Display System (CPDS) logic, First Limit Indicator (FLI) calculations, Vehicle and Engine Multifunction Display (VEMD) monitoring, and 4-axis Automatic Flight Control System (AFCS) with Auto Trim and Beep Trim hat-switch modulation.  
> * **Eurocopter EC145 / Airbus H145:** Dual-engine performance tracking, extended cabin payload envelopes, and high-altitude transport configurations.  
> * **Helicopter Physics Fundamentals:** Detailed guides covering 6-DOF equations of motion, Effective Translational Lift (ETL), Vortex Ring State (VRS), Loss of Tail Rotor Effectiveness (LTE), and first-order blade flapping mechanics.

### **2.4 Regional Infrastructure Database**

Pre-populated spatial database powered by PostgreSQL and PostGIS:

> * **18 STAT MedEvac Bases:** Including STAT 1 (Washington), STAT 3 (Cranberry), STAT 4 (KAGC Airport HQ), and STAT 6 (KAXQ Clarion).  
> * **5 AHN LifeFlight Bases:** Including LifeFlight 1 (Canonsburg) and LifeFlight 4 (Butler).  
> * **Receiving Trauma Hubs:** Detailed helipad dimensions, elevation, and surface specs for UPMC Presbyterian (PS78), Allegheny General (42PN), UPMC Mercy (PN23), UPMC Children's Hospital (30PN), UPMC Hamot (0PS8), and regional community centers.

## **3\. Master Monorepo Documentation Index**

`virtualhems-monorepo/`  
`├── docs/                               # Core Systems Architecture & Operational Documentation [3]`  
`│   ├── ARCHITECTURE.md                 # System Architecture Blueprint [3]`  
`│   ├── SCHEMATICS.md                   # System Flowcharts & ASCII Diagrams [3]`  
`│   ├── TECH-STACK.md                   # Full-Stack Engineering Specifications [3]`  
`│   ├── REQUIREMENTS.md                 # System Requirements & Acceptance Matrix [3]`  
`│   ├── FRAMEWORK.md                    # Platform Master Directives [3]`  
`│   ├── TASKS.md                        # Phased Engineering Action Plan [3]`  
`│   ├── BLUEPRINT.md                    # Master End-to-End Blueprint [3]`  
`│   ├── REQUIRED-DOCUMENTS.md           # Master Artifact Deliverables Index [3]`  
`│   ├── DOCUMENT-STRUCTURE.md           # Monorepo Directory Mapping [3]`  
`│   ├── APP-MAP.md                      # Route Hierarchy & UI Navigation Tree [3]`  
`│   ├── LIVING-ENGINEERING-HANDBOOK.md  # Physics Engineering & Mathematical Foundations [3]`  
`│   ├── AI-INSTRUCTIONS.md              # AI Swarm Directives & System Rules [3]`  
`│   ├── AGENTS.md                       # Multi-Agent Swarm Topology [3]`  
`│   ├── ACCOUNT-SETUP.md                # Pilot Onboarding & API Pairing Guide [3]`  
`│   ├── MCP.md                          # Model Context Protocol Specifications [3]`  
`│   ├── TROUBLESHOOTING.md              # System Fault Diagnosis & Recovery Manual [3]`  
`│   ├── SKILLS.md                       # Competency Framework & Handling Ratings [3]`  
`│   └── vhop/                           # Operational & Clinical Flight Manuals [3]`  
`│       ├── VHOP-01-SOP.md              # Standard Operating Procedures & SMS Protocols [3]`  
`│       ├── VHOP-02-SYSTEMS.md          # EC135 / EC145 / H135 Systems Operating Manual [3]`  
`│       ├── VHOP-03-DYNAMICS.md         # Helicopter Aerodynamics & Physics Guide [3]`  
`│       └── VHOP-04-CLINICAL.md         # Clinical Transport Engine & Helipad Directory [3]`

## **4\. Quick Start Checklist for Pilots**

> 1. **Create an Account:** Register your pilot profile at [virtualhems.com/register](https://virtualhems.com) and retrieve your unique API key.  
> 2. **Install Desktop Bridge:** Download the Tauri standalone bridge client from [virtualhems.com/downloads](https://virtualhems.com).  
> 3. **Configure Telemetry:**  
   * *X-Plane 11/12:* Copy hems-dispatch-xp.lua to X-Plane/Resources/plugins/FlyWithLua/Scripts/.  
   * *MSFS 2020/2024:* Launch the desktop bridge; it connects automatically via SimConnect shared memory.  
> 4. **Pair & Fly:** Input your API key into the desktop bridge UI, open your browser to /command or /dispatcher, and launch your flight.

**Authored By:** Chief Systems Architect & Lead Software Engineer, Virtual HEMS Platform **Approved By:** Directorate of Technology & Operational Safety Council **Repository Location:** virtualhems-monorepo/docs/INTRODUCTION.md