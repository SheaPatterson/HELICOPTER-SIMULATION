# **SCHEMATICS.md**

**Document Designation:** SCHEMATICS-01 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** ASCII System Architecture Diagrams, Hardware Wiring Schematics, Telemetry Flows, Avionics Bus Layouts, and Rotor Dynamics Control Maps for Virtual HEMS Development

## **1\. Global Platform System Architecture**

\+-----------------------------------------------------------------------------------------------------------------------+  
|                                        VIRTUAL HEMS PLATFORM SYSTEM ARCHITECTURE                                      |  
\+-----------------------------------------------------------------------------------------------------------------------+  
|                                                                                                                       |  
|    FLIGHT SIMULATION ENGINES                                                                                          |  
|    \+-----------------------------------------------+                   \+-----------------------------------------+    |  
|    | Microsoft Flight Simulator (2020 / 2024\) \[13\] |                   | X-Plane (11 / 12\) \[7, 10\]               |    |  
|    | \- SimConnect Native C++ API                   |                   | \- FlyWithLua Script Engine \[7\]          |    |  
|    | \- Shared Memory & Gauge Telemetry Pipeline    |                   | \- Localhost UDP Socket Stream (Port 8080)|    |  
|    \+-----------------------+-----------------------+                   \+--------------------+--------------------+    |  
|                            |                                                        |                         |  
|                            \+---------------------------+----------------------------+                         |  
|                                                        |                                                      |  
|                                                        ▼                                                      |  
|    LOCAL DESKTOP BRIDGE LAYER (Electron / Rust Tauri Client) \[7\]                                                      |  
|    \+-------------------------------------------------------------------------------------------------------------+    |  
|    | \- High-Rate Data Sampler (2 Hz to 10 Hz Polling Rate)                                                      |    |  
|    | \- Flight Vector Parser (Lat/Lon, Altitude MSL/AGL, Airspeed, Heading, Pitch/Roll)                          |    |  
|    | \- Systems State Collector (Torque, TOT, Fuel Mass, Rotor RPM, Engine Status)                                |    |  
|    | \- Local TLS / HTTPS Encryption Engine & Failover Buffer                                                    |    |  
|    \+---------------------------------------------------+---------------------------------------------------------+    |  
|                                                        |                                                      |  
|                                                        │ Encrypted WebSocket / HTTPS Stream \[7\]                        |  
|                                                        ▼                                                      |  
|    CLOUD BACKEND & TACTICAL INFRASTRUCTURE (Supabase & Cloud Services) \[7\]                                            |  
|    \+-------------------------------------------------------------------------------------------------------------+    |  
|    | \- PostgreSQL 15+ Core Database with PostGIS Spatial Extensions \[7\]                                         |    |  
|    | \- Supabase Realtime Engine (Sub-Second Asset Vector Broadcast) \[7\]                                          |    |  
|    | \- Ironpine AI Tactical Dispatch & Integrity Audit Engine \[7\]                                                |    |  
|    | \- Clinical Deterioration Countdown Engine ("Golden Hour" Decay Dynamics) \[7\]                                |    |  
|    \+---------------------------------------------------+---------------------------------------------------------+    |  
|                                                        |                                                      |  
|                                                        │ Real-Time WebSocket Synchronization \[7\]                      |  
|                                                        ▼                                                      |  
|    WEB APPLICATION & TACTICAL EFB INTERFACE (virtualhems.com) \[7\]                                                     |  
|    \+---------------------------------+  \+-----------------------------------+  \+--------------------------------+ |  
|    | Live Operations Command Map \[7\] |  | 4-Stage Mission Dispatcher \[7\]    |  | Cockpit EFB Terminal \[7\]       | |  
|    | \- Real-time Asset Tracking      |  | \- Clinical Triage & GCS Scoring   |  | \- Live Vitals Display          | |  
|    | \- Regional Base/Hospital Overlays| | \- Weather & ORM Risk Scoring     |  | \- Checklist & Navigation Data  | |  
|    \+---------------------------------+  \+-----------------------------------+  \+--------------------------------+ |  
\+-----------------------------------------------------------------------------------------------------------------------+

## **2\. Hardware Bridge Telemetry Flow**

\+-----------------------------------------------------------------------------------------------------------------------+  
|                                         HARDWARE BRIDGE TELEMETRY FLOW SCHEMATIC                                      |  
\+-----------------------------------------------------------------------------------------------------------------------+  
|                                                                                                                       |  
|  \[ FLIGHT SIMULATOR RUNTIME \]                                                                                        |  
|       │                                                                                                               |  
|       ├── (MSFS 2020 / 2024 via SimConnect) ──────────────┐                                                          |  
|       │                                                   │                                                           |  
|       └── (X-Plane via FlyWithLua UDP Port 8080\) \[7\] ─────┼─► \[ LOCAL BRIDGE BUFFER \]                                 |  
|                                                           │   \- Thread-Safe Ring Queue                                |  
|                                                           │   \- Delta-Compression Filter                             |  
|                                                           │   \- Timestamp Synchronization                             |  
|                                                           └───────────────────┬───────────────────────────────────────┘  
|                                                                               │  
|                                                                               ▼  
|                                                            \[ NETWORK INTEGRITY MONITOR \]  
|                                                                               │  
|                                                 ┌─────────────────────────────┴─────────────────────────────┐  
|                                                 │ Network Status Check                                      │  
|                                                 └─────────────┬───────────────────────────────┬─────────────┘  
|                                                               │                               │  
|                                                      (Connection Active)             (Connection Severed)  
|                                                               │                               │  
|                                                               ▼                               ▼  
|                                                    \[ SUPABASE REALTIME UPLINK \]     \[ LOCAL OFFLINE STORAGE \]  
|                                                    \- TLS Encrypted Stream           \- SQLite Local Buffer  
|                                                    \- Sub-second Broadcast \[7\]       \- Automatic Retry Pipeline  
|                                                               │                               │  
|                                                               ▼                               │  
|                                                    \[ CLOUD DATABASE RECEPTOR \] ◄──────┘ (On Reconnection)  
|                                                               │  
|                                                               ▼  
|                                                    \[ DISPATCH & MAP CLIENTS \]  
|  
\+-----------------------------------------------------------------------------------------------------------------------+

## **3\. EC135 / EC145 / H135 Cockpit Avionics & Systems Architecture**

\+-----------------------------------------------------------------------------------------------------------------------+  
|                                    CPDS & AVIONICS BUS SCHEMATIC (EC135 / EC145 / H135)                               |  
\+-----------------------------------------------------------------------------------------------------------------------+  
|                                                                                                                       |  
|  ESSENTIAL BUS 1 (28V DC) ─────────────────► \[ VEMD DISPLAY SCREEN 1 \] ──► First Limit Indicator (FLI)                |  
|                                                                           \- N1, TOT, Torque Consolidated Scale        |  
|                                                                                                                       |  
|  ESSENTIAL BUS 2 (28V DC) ─────────────────► \[ VEMD DISPLAY SCREEN 2 \] ──► System Performance & Flight Report Page    |  
|                                                                                                                       |  
|  NON-ESSENTIAL BUS (28V DC) ───────────────► \[ CAUTION & ADVISORY DISPLAY \] ──► CAD Status & Fuel Systems Page        |  
|                                                                                  \- Main/Supply Tank Fuel Quantities   |  
|                                                                                  \- Caution Flags & Warnings           |  
|                                                                                                                       |  
|  AVIONICS BUS 1 (28V DC) ──────────────────► \[ PRIMARY FLIGHT DISPLAY (PFD) \] ─► Airspeed, Attitude, Altimeter, VSI   |  
|                                                                                                                       |  
|  AVIONICS BUS 2 (28V DC) ──────────────────► \[ NAVIGATION DISPLAY (ND) \] ────► Moving Map, Weather Radar, HTAWS     |  
|                                                                                                                       |  
|  SHARED DATA BUSES (ARINC 429 / CAN)                                                                                  |  
|       │                                                                                                               |  
|       ├──► \[ ENGINE 1 FADEC \] ─── (Dual Channel A/B) ───► Fuel Metering Valve 1 ──► Engine 1 (PW206B2 / Arrius 2B2)   |  
|       │                                                                                                               |  
|       ├──► \[ ENGINE 2 FADEC \] ─── (Dual Channel A/B) ───► Fuel Metering Valve 2 ──► Engine 2 (PW206B2 / Arrius 2B2)   |  
|       │                                                                                                               |  
|       └──► \[ 4-AXIS AFCS COMPUTERS \] ──► Parallel Actuators & SAS Solenoids ──► Swashplate Flight Controls            |  
|                                                                                                                       |  
\+-----------------------------------------------------------------------------------------------------------------------+

## **4\. Automatic Flight Control System (AFCS) Control Loop**

\+-----------------------------------------------------------------------------------------------------------------------+  
|                                            4-AXIS AFCS CONTROL LOOP SCHEMATIC                                         |  
\+-----------------------------------------------------------------------------------------------------------------------+  
|                                                                                                                       |  
|   PILOT INPUT INCEPTORS                                                                                               |  
|   \+--------------------------+                                                                                        |  
|   | Cyclic / Collective /    |                                                                                        |  
|   | Anti-Torque Pedals       |                                                                                        |  
|   \+------------+-------------+                                                                                        |  
|                │                                                                                                      |  
|                ▼                                                                                                      |  
|   \[ Force Trim Gradient Springs \] ◄─── (Trim Release Switch \- Disengages Brakes)                                      |  
|                │                                                                                                      |  
|                ├───────────────────────────────────────────────────────┐                                              |  
|                │                                                       │                                              |  
|                ▼                                                       ▼                                              |  
|   \[ INNER LOOP: SAS \]                                     \[ OUTER LOOP: ATTITUDE & NAV HOLD \]                         |  
|   \- Rate Gyros & Accelerometers                           \- Air Data Computers (ADC) & Flight Director                |  
|   \- High-Speed, Low-Authority (\$\\pm 10\\%\$-\$15\\%\$)         \- Full-Authority Parallel Trim Actuators                    |  
|   \- Direct Electro-Hydraulic Series Actuators             \- Moves Cockpit Controls to Maintain Mode Targets           |  
|   \- Damps Atmospheric Disturbances & Rotational Rates     \- Modes: ATT, ALT, HDG, IAS, VS, NAV, GA                    |  
|                │                                                       │                                              |  
|                └───────────────────────────┬───────────────────────────┘                                              |  
|                                            │                                                                          |  
|                                            ▼                                                                          |  
|                               \[ MIXING UNIT & HYDRAULIC \]                                                             |  
|                               \- Merges Pitch/Roll/Yaw Inputs                                                          |  
|                               \- Dual Independent Hydraulic Systems (Sys 1 & Sys 2\)                                    |  
|                                            │                                                                          |  
|                                            ▼                                                                          |  
|                               \[ MAIN ROTOR SWASHPLATE & \]                                                             |  
|                               \[   FENESTRON CONTROL     \]                                                             |  
|                                                                                                                       |  
\+-----------------------------------------------------------------------------------------------------------------------+

## **5\. Rotor Disk Mechanics & Gyroscopic Precession Map**

\+-----------------------------------------------------------------------------------------------------------------------+  
|                                 ROTOR DISK MECHANICS & PHASE LAG (\$90^\\circ\$ DISPLACEMENT)                           |  
\+-----------------------------------------------------------------------------------------------------------------------+  
|                                                                                                                       |  
|                                             \[ NOSE (0° Azimuth) \]                                                     |  
|                                                       ▲                                                               |  
|                                                       │                                                               |  
|                                                       │                                                               |  
|                                                       │                                                               |  
|    \[ LEFT SIDE (270° Azimuth) \] ◄─────────────────────┼─────────────────────► \[ RIGHT SIDE (90° Azimuth) \]          |  
|    \- Maximum Downward Flapping Realized               │                       \- Maximum Upward Flapping Realized      |  
|    \- Minimum Blade Pitch / AOA Angle                  │                       \- Maximum Blade Pitch / AOA Angle       |  
|                                                       │                       \- Swashplate Raises Blade Highest Here  |  
|                                                       │                                                               |  
|                                                       │                                                               |  
|                                             \[ TAIL (180° Azimuth) \]                                                   |  
|                                                       │                                                               |  
|                                                       └─ Maximum Forward Cyclic Input Applied Here                    |  
|                                                          (Forces pitch change at 90° due to gyroscopic precession)    |  
|                                                                                                                       |  
|    DIRECTION OF ROTATION: Counter-Clockwise (Viewed from Above)                                                       |  
|    RESULT: Disk tilts forward toward 0° Nose position \$90^\\circ\$ after maximum pitch input is introduced at 90°.      |  
|                                                                                                                       |  
\+-----------------------------------------------------------------------------------------------------------------------+

## **6\. Vortex Ring State (VRS) Recirculation Flow Map**

\+-----------------------------------------------------------------------------------------------------------------------+  
|                                       VORTEX RING STATE FLOW FIELD SCHEMATIC                                          |  
\+-----------------------------------------------------------------------------------------------------------------------+  
|                                                                                                                       |  
|                         ▲   ▲   ▲                                           ▲   ▲   ▲                                 |  
|                         │   │   │  (Upflowing Air Outside Rotor Disk)       │   │   │                                 |  
|                     ┌───┴───┴───┴───┐                                   ┌───┴───┴───┴───┐                             |  
|    \================/================= MAIN ROTOR DISK PLANE \=================/=================                       |  
|                     └───┬───┬───┬───┘                                   └───┬───┬───┬───┘                             |  
|                         │   │   │                                           │   │   │                                 |  
|                         ▼   ▼   ▼                                           ▼   ▼   ▼                                 |  
|                          \\     /                                             \\     /                                  |  
|                           \\   /   (Recirculating Toroidal Vortex Rings)       \\   /                                   |  
|                            └─┘                                                 └─┘                                    |  
|                             ↺                                                   ↻                                     |  
|                                                                                                                       |  
|    ENTRY CONDITIONS:                                                                                                  |  
|    1\. Airspeed below Effective Translational Lift (\$\< 30\\text{ kts}\$)                                                 |  
|    2\. Vertical rate of descent exceeding \$300\\text{--}500\\text{ ft/min}\$                                              |  
|    3\. Power applied (\$20\\%\\text{--}100\\%\$ Engine Torque)                                                              |  
|                                                                                                                       |  
|    VUICHARD RECOVERY EXECUTION VECTOR:                                                                                |  
|    1\. Increase Collective Pitch to Maximum Available Power                                                            |  
|    2\. Apply Right Pedal to Maintain Heading                                                                           |  
|    3\. Apply Left Cyclic (Cross-Control) to drive tail rotor thrust sideways out of the vortex ring column             |  
|                                                                                                                       |  
\+-----------------------------------------------------------------------------------------------------------------------+

## **7\. Dynamic Golden Hour Deterioration Timeline**

\+-----------------------------------------------------------------------------------------------------------------------+  
|                                     GOLDEN HOUR CLINICAL TIMELINE SCHEMATIC                                           |  
\+-----------------------------------------------------------------------------------------------------------------------+  
|                                                                                                                       |  
|  \[ MISSION DISPATCH \] ──► Golden Hour Countdown Initiated (\$60:00\\text{ Min}\$ Total Target Window) \[7\]                |  
|         │                                                                                                             |  
|         ▼                                                                                                             |  
|  \[ EN-ROUTE TRANSIT \] ──► High-speed flight profile to scene location                                                 |  
|         │                                                                                                             |  
|         ▼                                                                                                             |  
|  \[ SCENE ARRIVAL \] ────► On-Scene Timer Active (Target Window: \$\\le 15:00\\text{ Minutes}\$) \[7\]                        |  
|         │                                                                                                             |  
|         ├─────────────────────────────────────────────┐                                                               |  
|         │                                             │                                                               |  
|    (On-Time Departure \$\\le 15\\text{m}\$)        (Extended Delay \$\> 15\\text{m}\$)                                         |  
|         │                                             │                                                               |  
|         ▼                                             ▼                                                               |  
|  \[ PATIENT STABLE \]                          \[ PATIENT DETERIORATES \]                                                 |  
|  \- Baseline GCS Maintained                   \- GCS Drops (\$15 \\rightarrow 12 \\rightarrow 8\$)                          |  
|  \- Vital Signs Within Target                 \- Hypoxia / Shock Flags Triggered                                        |  
|  \- Zero Score Penalties                      \- Cumulative Score Penalty Applied                                       |  
|         │                                             │                                                               |  
|         └─────────────────────────────┬───────────────┘                                                               |  
|                                       │                                                                               |  
|                                       ▼                                                                               |  
|  \[ HOSPITAL ARRIVAL \] ──────────────► Touchdown at Level 1 / Specialty Receiving Facility                             |  
|                                       │                                                                               |  
|                                       ▼                                                                               |  
|  \[ AUTOMATED AFTER-ACTION REVIEW \] ──► Compiles flight telemetry, time metrics, and clinical scoring audit \[7\]       |  
|                                                                                                                       |  
\+-----------------------------------------------------------------------------------------------------------------------+

## **8\. 4-Stage Mission Dispatcher Data Flow**

\+-----------------------------------------------------------------------------------------------------------------------+  
|                                      4-STAGE MISSION DISPATCHER SCHEMATIC                                             |  
\+-----------------------------------------------------------------------------------------------------------------------+  
|                                                                                                                       |  
|   STAGE 1: DETAILS                                                                                                    |  
|   \+---------------------------------------------------------------------------------------------------------------+   |  
|   | Select Mission Type (Primary Scene Response vs. Inter-Facility Transfer)                                      |   |  
|   | Assign Regional Base Station (STAT MedEvac / AHN LifeFlight) & Aircraft Registration                          |   |  
|   \+---------------------------------------------------+-----------------------------------------------------------+   |  
|                                                       │                                                               |  
|                                                       ▼                                                               |  
|   STAGE 2: CREW ROSTER                                                                                                |  
|   \+---------------------------------------------------------------------------------------------------------------+   |  
|   | Assign Pilot in Command (PIC)                                                                                 |   |  
|   | Assign Flight Nurse (PHRN) & Flight Paramedic / Communications Specialist                                     |   |  
|   \+---------------------------------------------------+-----------------------------------------------------------+   |  
|                                                       │                                                               |  
|                                                       ▼                                                               |  
|   STAGE 3: CLINICAL PATIENT MATRIX                                                                                    |  
|   \+---------------------------------------------------------------------------------------------------------------+   |  
|   | Select Medical Condition (260+ Condition Database)                                                            |   |  
|   | Input Patient Age, Gender, Weight, and Glasgow Coma Scale (GCS) Assessment                                    |   |  
|   | Trigger Ironpine AI Tactical Dispatch Briefing Generation                                                     |   |  
|   \+---------------------------------------------------+-----------------------------------------------------------+   |  
|                                                       │                                                               |  
|                                                       ▼                                                               |  
|   STAGE 4: FLIGHT PLAN & ORM RISK MATRIX                                                                              |  
|   \+---------------------------------------------------------------------------------------------------------------+   |  
|   | Evaluate PAVE Operational Risk Score (Pilot, Aircraft, enVironment, External)                                 |   |  
|   | Verify Fuel Requirements (En-Route \+ 20 Min VFR / 30 Min IFR Reserve)                                         |   |  
|   | Issue Formal Mission Authorization Code & Transmit Package to Cockpit EFB                                     |   |  
|   \+---------------------------------------------------------------------------------------------------------------+   |  
|                                                                                                                       |  
\+-----------------------------------------------------------------------------------------------------------------------+

## **9\. Western Pennsylvania Regional Infrastructure Network**

\+-----------------------------------------------------------------------------------------------------------------------+  
|                                   WESTERN PENNSYLVANIA REGIONAL HEMS NETWORK SCHEMATIC                                |  
\+-----------------------------------------------------------------------------------------------------------------------+  
|                                                                                                                       |  
|                                                   \[ ERIE REGION \]                                                     |  
|                                 UPMC Hamot (0PS8 \- 900') / St. Vincent (29PN \- 731')                                   |  
|                                  Stat MedEvac 17 (Harborcreek) / Stat MedEvac 7 (Meadville)                           |  
|                                                         │                                                             |  
|                                                         │                                                             |  
|          \[ NORTHWEST REGION \]                           │                           \[ NORTH CENTRAL REGION \]          |  
|    UPMC Northwest (PN76 \- 1415')                        │                      Penn Highlands DuBois (PA10 \- 1463')     |  
|    Clarion Hospital (91PA \- 1489')                      │                      Stat MedEvac 6 (Clarion \- KAXQ \- 1457') |  
|    Stat MedEvac 8 (Grove City \- 1370')                  │                      Stat MedEvac 9 (Clearfield \- 1516')     |  
|                         │                               │                               │                             |  
|                         └───────────────────────────────┼───────────────────────────────┘                             |  
|                                                         │                                                             |  
|                                                         ▼                                                             |  
|                                            \[ PITTSBURGH METROPOLITAN HUB \]                                            |  
|                  ┌─────────────────────────────────────────────────────────────────────────────────┐                  |  
|                  │  UPMC Presbyterian (PS78 \- 1124' \- Level 1 Trauma)                              │                  |  
|                  │  UPMC Mercy (PN23 \- 886' \- Level 1 Trauma / Burn Unit)                            │                  |  
|                  │  UPMC Children's Hospital of Pittsburgh (30PN \- 1088' \- Pediatric Level 1\)        │                  |  
|                  │  Allegheny General Hospital (42PN \- 804' \- Level 1 Trauma / AHN HQ)              │                  |  
|                  │  Forbes Hospital (54PN \- 1198') / UPMC St. Margaret (46PA \- 761')               │                  |  
|                  └────────────────────────────────────────┬────────────────────────────────────────┘                  |  
|                                                           │                                                           |  
|                         ┌─────────────────────────────────┴─────────────────────────────────┐                         |  
|                         │                                                                   │                         |  
|                         ▼                                                                   ▼                         |  
|             \[ SOUTHWEST REGION \]                                                \[ CENTRAL / EAST REGION \]             |  
|     Stat MedEvac 1 (Washington \- 1156')                                 UPMC Altoona (74PN \- 1259' \- Level 2 Trauma) |  
|     LifeFlight 1 (Canonsburg \- 1169')                                   Stat MedEvac 11 (Altoona \- 1259')          |  
|     Stat MedEvac 4 (KAGC Airport HQ \- 1251')                            Stat MedEvac 2 (Latrobe \- 1251')           |  
|                                                                                                                       |  
\+-----------------------------------------------------------------------------------------------------------------------+

## **Document Control & System Architecture Sign-Off**

**Authored By:** Chief Systems Architect & Lead Software Engineer, Virtual HEMS **Approved By:** Directorate of Simulation Engineering & Operations Council **Repository Location:** virtualhems-monorepo/docs/SCHEMATICS.md