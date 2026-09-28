# **Virtual HEMS Companion Platform (virtualhems.com)**

**Repository Root:** virtualhems-monorepo/README.md **System Designation:** SYS-README-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Target Platform:** virtualhems.com (Desktop & Mobile Browser / Cross-Platform Desktop App)

## **1\. System Vision & Overview**

**Virtual HEMS** (virtualhems.com) is a professional-grade flight-following, mission-dispatch, and clinical tracking ecosystem engineered specifically for helicopter emergency medical services (HEMS) simulation. Built to serve both flight simulation newcomers and experienced virtual aviators, the platform unifies desktop simulators—Microsoft Flight Simulator 2020/2024 and X-Plane 11/12—with a cloud-native dispatcher and interactive cockpit Electronic Flight Bag (EFB).  
The platform emphasizes authentic regional medical operations across Western Pennsylvania and the tri-state area, simulating real-world operations modeled after providers like **STAT MedEvac** and **Allegheny Health Network (AHN) LifeFlight**.  
\+---------------------------------------------------------------------------------------------------+  
|                            VIRTUAL HEMS PLATFORM TOPOLOGY                                         |  
\+---------------------------------------------------------------------------------------------------+  
|  FLIGHT SIMULATION ENGINES                                                                        |  
|  \[ Microsoft Flight Simulator (2020 / 2024\) \]    \[ Laminar Research X-Plane (11 / 12\) \]           |  
|         │ (SimConnect C++ / Rust)                       │ (FlyWithLua UDP Script) \[30\]            |  
|         └───────────────────────────┬───────────────────┘                                         |  
|                                     ▼                                                             |  
|  DESKTOP BRIDGE CLIENT (apps/bridge-desktop/)                                                     |  
|  Tauri / Rust Standalone Application Listening on Local Port 8080 \[30\]                             |  
|         │                                                                                         |  
|         ▼ (Encrypted WebSocket / 2 Hz Realtime Uplink) \[11, 30\]                                   |  
|  WEB COMMAND TERMINAL (apps/web/ @ virtualhems.com) \[1, 10, 11\]                                   |  
|  ├── /command      \--\> Live Regional Tactical Overwatch Map \[11\]                                  |  
|  ├── /dispatcher   \--\> 4-Stage Mission Dispatch Planner \[11\]                                    |  
|  ├── /efb          \--\> Cockpit Electronic Flight Bag & Dynamic Patient Engine \[1, 11\]            |  
|  └── /api/dispatch \--\> Ironpine AI Tactical Dispatch Engine \[11\]                                  |  
\+---------------------------------------------------------------------------------------------------+

## **2\. Key Features**

> * **Multi-Engine Telemetry Pipe:** Native telemetry bridges for MSFS 2020/2024 via SimConnect and X-Plane 11/12 via FlyWithLua UDP sockets.  
> * **4-Stage Mission Dispatcher:** Complete workflow covering call intake (Scene Call vs. Inter-Facility Transfer), crew roster assignments, 260+ medical condition configurations, and quantified PAVE risk matrix evaluations.  
> * **Dynamic Patient Clinical Engine:** Dynamic Glasgow Coma Scale (GCS) decay tracking based on call duration and a 60-minute Golden Hour clock.  
> * **In-Cockpit EFB:** Integrated web terminal providing real-time patient vitals, interactive startup/emergency SOP checklists, and hospital helipad approach charts.  
> * **Regional Medical Infrastructure Database:** Pre-populated PostGIS spatial directory of Western Pennsylvania STAT MedEvac bases, AHN LifeFlight bases, and receiving trauma hubs (e.g., UPMC Presbyterian, Allegheny General).  
> * **Safety & Incident Management System:** Integrated Virtual Incident Reporting System (VIRS) for non-punitive safety management tracking.

## **3\. Supported Airframes & Flight Dynamics**

Virtual HEMS features aircraft system integration, manual references, and operational checklists tailored for primary air medical helicopters:

### **Eurocopter EC135 (P2+/T2+) & Airbus H135**

> * **Central Panel Display System (CPDS):** First Limit Indicator (FLI) calculating analog parameters across gas generator speed (N\_1), Turbine Outlet Temperature (TOT), and Engine Output Torque (TRQ).  
> * **Autopilot & Flight Controls:** 4-axis Automatic Flight Control System (AFCS) with Stability Augmentation System (SAS), Auto Trim, and Beep Trim hat-switch modulation.  
> * **Vehicle and Engine Multifunction Display (VEMD):** Dual-screen digital engine and vehicle monitoring with flight report capabilities.

### **Eurocopter EC145 / Airbus H145**

> * Extended cabin payload profiles, dual-engine performance calculations, and high-altitude transport envelopes.

### **Fundamental Principles of Flight**

Interactive learning guides covering 6-DOF helicopter physics:

> * Effective Translational Lift (ETL) & Transverse Flow Effect  
> * Vortex Ring State (VRS) detection and recovery  
> * Loss of Tail Rotor Effectiveness (LTE) dynamics  
> * Rotor flapping dynamics (\\beta\_{1s}, \\beta\_{1c}) and gyroscopic precession

## **4\. Repository Structure**

virtualhems-monorepo/  
├── docs/                               \# Core Architectural & Operational Documentation\[span\_52\](start\_span)\[span\_52\](end\_span)  
│   ├── ARCHITECTURE.md                 \# System Architecture Blueprint  
│   ├── SCHEMATICS.md                   \# System Flowcharts & ASCII Diagrams  
│   ├── TECH-STACK.md                   \# Full-Stack Engineering Specifications  
│   ├── REQUIREMENTS.md                 \# System Requirements & Acceptance Criteria  
│   ├── FRAMEWORK.md                    \# Platform Master Framework Directives\[span\_53\](start\_span)\[span\_53\](end\_span)  
│   ├── TASKS.md                        \# Phased Development Action Plan  
│   ├── BLUEPRINT.md                    \# Master End-to-End Blueprint  
│   ├── REQUIRED-DOCUMENTS.md           \# Technical Artifact Deliverables Index  
│   ├── DOCUMENT-STRUCTURE.md           \# Monorepo Directory Index  
│   ├── APP-MAP.md                      \# Complete Route Hierarchy & Navigation Tree  
│   ├── LIVING-ENGINEERING-HANDBOOK.md  \# Engineering Reference & Mathematical Foundations  
│   ├── AI-INSTRUCTIONS.md              \# Guidelines for AI Agents & System Integrations  
│   └── vhop/                           \# Virtual HEMS Operational Manuals\[span\_54\](start\_span)\[span\_54\](end\_span)  
│       ├── VHOP-01-SOP.md              \# Standard Operating Procedures & SMS\[span\_55\](start\_span)\[span\_55\](end\_span)\[span\_56\](start\_span)\[span\_56\](end\_span)  
│       ├── VHOP-02-SYSTEMS.md          \# EC135 / EC145 / H135 Systems Operating Manual\[span\_57\](start\_span)\[span\_57\](end\_span)  
│       ├── VHOP-03-DYNAMICS.md         \# Helicopter Flight Dynamics Guide\[span\_58\](start\_span)\[span\_58\](end\_span)  
│       └── VHOP-04-CLINICAL.md         \# Clinical Transport Engine & Helipad Directory\[span\_59\](start\_span)\[span\_59\](end\_span)\[span\_60\](start\_span)\[span\_60\](end\_span)  
├── apps/  
│   ├── web/                            \# Next.js 14+ Web Terminal (virtualhems.com) \[1, 10, 11\]  
│   │   ├── src/app/(dashboard)/        \# Tactical Operations Terminal Routes \[11\]  
│   │   └── src/app/api/                \# Serverless API Routes (AI Dispatch, Telemetry) \[11\]  
│   └── bridge-desktop/                 \# Standalone Desktop App (Tauri / Rust) \[30\]  
├── packages/  
│   ├── database/                       \# PostgreSQL Schemas, PostGIS & Seeds \[11\]  
│   │   └── seed/                       \# Base, Hospital & Medical Condition Data \[11\]  
│   ├── shared-types/                   \# Shared TypeScript Interfaces \[11\]  
│   └── plugins/                        \# Simulator Plugins (FlyWithLua Scripts) \[30\]  
├── turbo.json  
└── package.json

## **5\. Quick Start & Local Setup**

### **Prerequisites**

> * **Node.js:** v18.0.0 or higher  
> * **Package Manager:** pnpm (recommended) or npm  
> * **Rust Toolchain:** Required for building apps/bridge-desktop/ via Tauri  
> * **Simulator Requirement:** FlyWithLua installed for X-Plane 11/12 or SimConnect SDK for MSFS

### **Installation**

> 1. **Clone the Repository:**  
>    git clone https://github.com/virtualhems/virtualhems-monorepo.git  
>    cd virtualhems-monorepo

> 2. **Install Workspace Dependencies:**  
>    pnpm install

> 3. **Configure Environment Variables:** Create a .env.local file inside apps/web/:  
>    NEXT\_PUBLIC\_SUPABASE\_URL=https://your-supabase-project.supabase.co  
>    NEXT\_PUBLIC\_SUPABASE\_ANON\_KEY=your-anon-key  
>    IRONPINE\_AI\_API\_KEY=your-ai-key

> 4. **Run Web Terminal in Development Mode:**  
>    pnpm \--filter web dev  
>    Open http://localhost:3000 to view the web dashboard.  
> 5. **Deploy Simulator Telemetry Bridge:**  
   * **X-Plane 11/12:** Copy packages/plugins/xplane-lua/hems-dispatch-xp.lua into X-Plane/Resources/plugins/FlyWithLua/Scripts/.  
   * **Desktop Bridge App:** Run pnpm \--filter bridge-desktop tauri dev to start the local socket listener on port 8080\.

## **6\. Community & Support**

Virtual HEMS is a community-driven project built to elevate air medical simulation.

> * **Website:** [virtualhems.com](https://virtualhems.com)  
> * **Documentation:** docs/ directory  
> * **Incident & Safety Reporting:** [virtualhems.com/dashboard/sms-report](https://virtualhems.com)  
> * **Support Community:** Join our Discord community for mission updates and technical help.

**Authored By:** Founder & Chief Systems Architect, Virtual HEMS Platform **Repository Location:** virtualhems-monorepo/README.md