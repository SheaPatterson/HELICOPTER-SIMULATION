# **AI Directive Guidelines & System Directives (AI-INSTRUCTIONS.md)**

**Document Designation:** AI-DIR-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Operational Instructions, System Architecture Guidelines, Clinical Engine Rules, and Interface Data Flow Specifications for AI Agents in the Virtual HEMS Ecosystem (virtualhems.com)

## **1\. System Vision & Platform Context**

Virtual HEMS (virtualhems.com) is a high-fidelity flight simulation companion platform integrating desktop simulators (Microsoft Flight Simulator 2020/2024 and X-Plane 11/12) with a cloud-native dispatcher and clinical tracking hub. The ecosystem focuses on aeromedical operations across Western Pennsylvania and regional tri-state networks.  
`+---------------------------------------------------------------------------------------------------+`  
`|                            VIRTUAL HEMS PLATFORM ARCHITECTURE                                     |`  
`+---------------------------------------------------------------------------------------------------+`  
`|  [MSFS 2020/2024] / [X-Plane 11/12]                                                               |`  
`|  └── Local UDP Stream (Port 8080 via FlyWithLua / SimConnect) [19]                                |`  
`|      └── Desktop Bridge Client (Tauri/Rust) [19]                                                  |`  
`|          └── WebSocket Realtime Synchronization (2 Hz) [13, 19]                                   |`  
`|              └── Web Command Terminal (virtualhems.com / Next.js 14+) [8, 12, 19]                 |`  
`|                  ├── Live Tactical Overwatch Map (/command) [13]                                  |`  
`|                  ├── 4-Stage Mission Dispatcher (/dispatcher) [12, 17]                            |`  
`|                  ├── Cockpit EFB & Clinical Engine (/efb) [1, 13]                                 |`  
`|                  └── Ironpine AI Tactical Dispatch Engine (/api/dispatch/ai-briefing) [15]        |`  
`+---------------------------------------------------------------------------------------------------+`

## **2\. Core Operational & Technical Directives**

### **2.1 Flight Dynamics & Physics Validation**

> * **Equations of Motion:** AI agents generating code or operational analyses must validate 6-DOF dynamic vectors (pitch, roll, yaw, translational accelerations, and rotor torque limits) against real-world helicopter flight dynamics.  
> * **Aerodynamic Phenomena:** Ensure technical models account for Effective Translational Lift (ETL), Vortex Ring State (VRS), Loss of Tail Rotor Effectiveness (LTE), and first-order blade flapping dynamics (\\beta\_{1s}, \\beta\_{1c}) driven by cyclic inputs (\\theta\_{1s}, \\theta\_{1c}).

### **2.2 Avionics & Flight Control Constraints**

> * **First Limit Indicator (FLI):** Systems monitoring engine parameter margins must calculate analog pointer values based on the worst-performing limit across gas generator speed (N\_1), Turbine Outlet Temperature (TOT), and Engine Output Torque (TRQ).  
> * **4-Axis AFCS:** Operational scripts for Airbus H135, Eurocopter EC135, and EC145 airframes must enforce SAS series actuator limits (\\pm 10\\%) alongside full-authority parallel trim actuators (Auto Trim and Beep Trim).

### **2.3 Clinical Engine & Patient Deterioration Logic**

> * **260+ Medical Conditions:** The clinical engine computes real-time patient stability based on a database of over 260 medical scenarios.  
> * **Golden Hour Decay Algorithm:** Timed patient degradation follows exponential decay equations tied to baseline Glasgow Coma Scale (GCS) ratings and transit duration (t in minutes):

\\text{GCS}(t) \= \\text{GCS}\_{\\text{baseline}} \\cdot e^{-\\lambda \\cdot t}  
`+---------------------------------------------------------------------------------------------------+`  
`|                                 CLINICAL PATIENT DECAY MATRIX                                     |`  
`+-------------------+----------------------------+-----------------------+--------------------------+`  
`| Parameter         | Input Source               | Target Range/Scale    | System Action            |`  
`+-------------------+----------------------------+-----------------------+--------------------------+`  
`| Baseline GCS      | Dispatch Stage 3 Input [1] | 3 to 15 Points        | Sets initial stability   |`  
`| Decay Rate ($\lambda$) | Medical Condition Matrix [15] | Scenario-dependent  | Drives GCS loss rate     |`  
`| Golden Hour Clock | Call Acceptance Event [15] | 60-Minute Countdown   | Triggers priority alerts |`  
`+-------------------+----------------------------+-----------------------+--------------------------+`

### **2.4 PAVE Risk Assessment Matrix**

Before flight authorization is granted in Stage 4 of the Mission Dispatcher, a quantified PAVE score must be evaluated:  
> \\text{Risk Score} \= P\_{\\text{Pilot}} \+ A\_{\\text{Aircraft}} \+ V\_{\\text{EnVironment}} \+ E\_{\\text{External}}

> * **Threshold Directives:** A total score exceeding 30 requires an automatic **MISSION NO-GO** determination.

## **3\. Subsystem File System & Route Specifications**

When referencing or generating code within the monorepo workspace, adhere to the following file layout and API endpoint assignments:  
`virtualhems-monorepo/`  
`├── apps/`  
`│   ├── web/                            # Next.js 14+ Web Application (virtualhems.com) [8, 12]`  
`│   │   ├── src/app/(dashboard)/`  
`│   │   │   ├── command/page.tsx        # Live Tactical Command Map [13]`  
`│   │   │   ├── dispatcher/page.tsx     # 4-Stage Mission Planner [12, 17]`  
`│   │   │   ├── efb/page.tsx            # Cockpit Electronic Flight Bag Terminal [1, 13]`  
`│   │   │   ├── hospitals/page.tsx      # Hospital & Helipad Directory [11, 13]`  
`│   │   │   ├── logbook/page.tsx        # Pilot Flight Records [2]`  
`│   │   │   ├── archive/page.tsx        # Mission Audit Database [9]`  
`│   │   │   └── sms-report/page.tsx     # VIRS Incident Reporting Portal [9]`  
`│   │   └── src/app/api/`  
`│   │       ├── dispatch/ai-briefing/   # Ironpine AI Tactical Briefing Engine [1, 15]`  
`│   │       ├── telemetry/              # Bridge Telemetry Ingestion Endpoint [15, 19]`  
`│   │       └── aar/                    # After-Action Review Audit Route [15]`  
`│   └── bridge-desktop/                 # Cross-Platform Tauri/Rust App [19]`  
`│       └── src-tauri/src/`  
`│           ├── main.rs                 # Entrypoint & UDP Port 8080 Listener [19]`  
`│           ├── simconnect/mod.rs       # MSFS Shared Memory Reader [8]`  
`│           ├── xplane_udp/mod.rs       # FlyWithLua UDP Receiver [19]`  
`│           └── uploader.rs             # WebSocket Telemetry Publisher [19]`  
`└── packages/`  
    `├── database/                       # PostgreSQL Schemas & Seed Data [15]`  
    `│   └── seed/`  
    `│       ├── bases.seed.sql          # 18 STAT MedEvac & 5 AHN LifeFlight Bases [11, 12]`  
    `│       ├── hospitals.seed.sql      # Regional Hospital Helipads (e.g., PS78, 42PN) [11, 13]`  
    `│       └── conditions.seed.sql     # 260+ Condition Matrix [15]`  
    `└── shared-types/                   # Shared TypeScript Data Contracts [15]`  
        `├── telemetry.ts`  
        `├── medical.ts`  
        `└── dispatch.ts`

## **4\. Hardware Bridge Communications Protocol**

Telemetry received from flight simulators via local UDP (Port 8080\) must be validated against the standard TypeScript interface contract (packages/shared-types/telemetry.ts) before WebSocket transmission:  
`{`  
  `"pilot_id": "usr_99281a4f-83c1-4d1e",`  
  `"mission_code": "HEMS-295208",`  
  `"sim_engine": "XPLANE12",`  
  `"timestamp": "2026-09-26T14:22:10.500Z",`  
  `"position": {`  
    `"latitude": 41.2261111,`  
    `"longitude": -79.4422222,`  
    `"altitude_msl_ft": 1457,`  
    `"altitude_agl_ft": 5,`  
    `"heading_deg": 240,`  
    `"ground_speed_kts": 0,`  
    `"vertical_speed_fpm": 0`  
  `},`  
  `"kinematics": {`  
    `"pitch_deg": 0.5,`  
    `"roll_deg": -0.2`  
  `},`  
  `"systems": {`  
    `"engine_torque_pct": 68.5,`  
    `"tot_celsius": 620,`  
    `"fuel_remaining_lbs": 420.5,`  
    `"rotor_rpm_pct": 100.0`  
  `}`  
`}`

## **5\. Verification & Compliance Matrix**

| Target System | Validation Method | Verification Pass Condition |
| :---- | :---- | :---- |
| **Telemetry Pipeline** | WebSocket Stream Audit | Ingestion latency \\le 50\\text{ ms} at 2\\text{ Hz} sync rate. |
| **Dispatch Planner** | PAVE Matrix Evaluation | Automatically blocks authorization if PAVE Score \> 30\. |
| **Clinical Engine** | GCS Decay Verification | Correctly applies decay exponential over 60-minute Golden Hour. |
| **Desktop Bridge** | UDP Socket Test | Successfully binds to local port 8080 and parses FlyWithLua payloads. |

**Authored By:** Chief Systems Architect & Lead AI Engineer, Virtual HEMS Platform **Approved By:** Operational Safety Council & Technical Standards Committee **Repository Location:** virtualhems-monorepo/docs/AI-INSTRUCTIONS.md