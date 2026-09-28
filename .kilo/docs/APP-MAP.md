# **APP-MAP.md**

**Document Designation:** MAP-SPEC-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** End-to-End Navigation Tree, Application Flow Maps, Interface Routing, Data Link Hooks, and Component Mapping for the Virtual HEMS Platform (virtualhems.com)

## **1\. Universal Route Hierarchy & Site Map**

The Virtual HEMS platform is organized into distinct functional domains tailored for web, tablet, and mobile interfaces. Authentication states dictate accessible sub-trees, separating public informational portals from secure tactical flight operations.  
`virtualhems.com/ (Root Navigation)`  
`│`  
`├── (Public Domain)`  
`│   ├── / ................................ Public Landing Page & Operational Charter[span_8](start_span)[span_8](end_span)`  
`│   ├── /about ........................... Platform History, Mission Mandate & Leadership[span_9](start_span)[span_9](end_span)`  
`│   ├── /safety .......................... Safety Management System (SMS) & VIRS Policy[span_10](start_span)[span_10](end_span)`  
`│   ├── /fleet ........................... Aircraft Specs (EC135, EC145, H135, B407)[span_11](start_span)[span_11](end_span)[span_12](start_span)[span_12](end_span)`  
`│   ├── /network ......................... STAT MedEvac & AHN LifeFlight Regional Directory[span_13](start_span)[span_13](end_span)[span_14](start_span)[span_14](end_span)`  
`│   ├── /downloads ....................... Desktop Bridge Client (.exe / .dmg) & Lua Scripts[span_15](start_span)[span_15](end_span)[span_16](start_span)[span_16](end_span)`  
`│   └── /contact ......................... Technical Support & Discord Community Links[span_17](start_span)[span_17](end_span)`  
`│`  
`├── (Auth Domain)`  
`│   ├── /login ........................... Pilot Authentication Portal[span_18](start_span)[span_18](end_span)`  
`│   └── /register ........................ Credential Issuance & Trainee Onboarding[span_19](start_span)[span_19](end_span)`  
`│`  
`└── /dashboard/ (Authenticated Operations Terminal)[span_20](start_span)[span_20](end_span)[span_21](start_span)[span_21](end_span)[span_22](start_span)[span_22](end_span)`  
    `├── /command ......................... Live Regional Tactical Overwatch Map[span_23](start_span)[span_23](end_span)[span_24](start_span)[span_24](end_span)[span_25](start_span)[span_25](end_span)`  
    `├── /dispatcher ...................... 4-Stage Mission Dispatch Planner[span_26](start_span)[span_26](end_span)[span_27](start_span)[span_27](end_span)`  
    `│   ├── ?stage=1 ..................... Dispatch Details & Live METAR Weather[span_28](start_span)[span_28](end_span)`  
    `│   ├── ?stage=2 ..................... Crew Roster Assignment (PIC/PHRN/Medic)[span_29](start_span)[span_29](end_span)`  
    `│   ├── ?stage=3 ..................... Clinical Patient Matrix & GCS Scoring[span_30](start_span)[span_30](end_span)[span_31](start_span)[span_31](end_span)`  
    `│   └── ?stage=4 ..................... Flight Plan & Quantified PAVE Risk Assessment[span_32](start_span)[span_32](end_span)`  
    `├── /efb ............................. In-Cockpit Electronic Flight Bag Terminal[span_33](start_span)[span_33](end_span)`  
    `│   ├── /vitals ...................... Dynamic Patient Condition & Golden Hour Timer[span_34](start_span)[span_34](end_span)[span_35](start_span)[span_35](end_span)`  
    `│   ├── /checklists .................. Interactive Cold & Dark / Emergency SOPs[span_36](start_span)[span_36](end_span)`  
    `│   └── /nav-brief ................... Hospital Helipad Diagrams & LZ Overlays[span_37](start_span)[span_37](end_span)[span_38](start_span)[span_38](end_span)`  
    `├── /hospitals ....................... Regional Hospital Map & Helipad Directory[span_39](start_span)[span_39](end_span)[span_40](start_span)[span_40](end_span)`  
    `├── /logbook ......................... Pilot Career Flight Log & Sortie Archive[span_41](start_span)[span_41](end_span)[span_42](start_span)[span_42](end_span)`  
    `├── /archive ......................... Historical Mission Audit & Transport Records[span_43](start_span)[span_43](end_span)[span_44](start_span)[span_44](end_span)`  
    `└── /sms-report ...................... Non-Punitive Incident Reporting Portal (VIRS)[span_45](start_span)[span_45](end_span)`

## **2\. Interactive Page Routing & Component Structure**

### **2.1 Public & Onboarding Portal Flow**

                                    `+-----------------------+`  
                                    `|   Landing Page (/)    |[span_46](start_span)[span_46](end_span)`  
                                    `+-----------+-----------+`  
                                                `|`  
                        `┌───────────────────────┴───────────────────────┐`  
                        `▼                                               ▼`  
             `+--------------------+                           +--------------------+`  
             `| Downloads Portal   |[span_47](start_span)[span_47](end_span)[span_48](start_span)[span_48](end_span)             | Pilot Onboarding   |[span_49](start_span)[span_49](end_span)`  
             `| (/downloads)       |                           | (/register)        |`  
             `+──────────┬─────────+                           +─────────┬──────────+`  
                        `│                                               │`  
                        `▼                                               ▼`  
             `+--------------------+                           +--------------------+`  
             `| Install Desktop    |[span_50](start_span)[span_50](end_span)[span_51](start_span)[span_51](end_span)             | Authentication     |[span_52](start_span)[span_52](end_span)`  
             `| Bridge (.exe/.dmg) |                           | Portal (/login)    |`  
             `+--------------------+                           +─────────┬──────────+`  
                                                                        `│`  
                                                                        `▼`  
                                                              `[ Redirect to Dashboard ][span_53](start_span)[span_53](end_span)[span_54](start_span)[span_54](end_span)`

### **2.2 Operational Dispatch & Flight Lifecycle Flow**

   `[ /dashboard/dispatcher ] ──Stage 1──► Select Scene Call or Inter-Facility Transfer[span_55](start_span)[span_55](end_span)`  
              `│                           Assign Base (e.g., STAT 6 / KAXQ) & Asset[span_56](start_span)[span_56](end_span)[span_57](start_span)[span_57](end_span)`  
              `│                           Fetch Live METAR Weather Data[span_58](start_span)[span_58](end_span)`  
              `│`  
              `├──Stage 2────────────────► Assign Flight Crew (PIC, Nurse, Paramedic)[span_59](start_span)[span_59](end_span)`  
              `│`  
              `├──Stage 3────────────────► Input Demographics & 260+ Condition Matrix[span_60](start_span)[span_60](end_span)[span_61](start_span)[span_61](end_span)`  
              `│                           Calculate Baseline GCS & Trigger AI Briefing[span_62](start_span)[span_62](end_span)[span_63](start_span)[span_63](end_span)`  
              `│`  
              `└──Stage 4────────────────► Execute PAVE Risk Matrix & Verify Reserves[span_64](start_span)[span_64](end_span)`  
                                          `Issue Authorization Code & Push to Cockpit EFB[span_65](start_span)[span_65](end_span)[span_66](start_span)[span_66](end_span)`  
                                                        `│`  
                                                        `▼`  
   `[ /dashboard/efb ] ──────────────────► In-Flight Monitoring & Golden Hour Timer[span_67](start_span)[span_67](end_span)[span_68](start_span)[span_68](end_span)`  
                                          `Live Telemetry Bridge Uplink (2 Hz Sync)[span_69](start_span)[span_69](end_span)[span_70](start_span)[span_70](end_span)`  
                                          `Hospital Patch Call Transmission[span_71](start_span)[span_71](end_span)`  
                                                        `│`  
                                                        `▼`  
   `[ Touchdown Event ] ─────────────────► Automated After-Action Review (AAR Audit)[span_72](start_span)[span_72](end_span)[span_73](start_span)[span_73](end_span)`  
                                          `Append Hours & Sorties to Pilot Logbook[span_74](start_span)[span_74](end_span)`

## **3\. Detailed Component & UI Layout Specifications**

### **3.1 Live Regional Tactical Display (/dashboard/command)**

Provides live regional surveillance across Western Pennsylvania and tri-state medical networks.  
`+---------------------------------------------------------------------------------------------------+`  
`|  REGIONAL TACTICAL DISPLAY                                    Live Traffic: 12  | Medical Nodes: 106|[span_79](start_span)[span_79](end_span)[span_80](start_span)[span_80](end_span)`  
`+---------------------------------------------------------------------------------------------------+`  
`|  [ MAP OVERLAY CONTROLS ]  |                                                                      |`  
`|  [x] Base Stations         |   (Interactive Leaflet / OpenStreetMap Overwatch Engine)[span_81](start_span)[span_81](end_span)[span_82](start_span)[span_82](end_span)[span_83](start_span)[span_83](end_span)   |`  
`|  [x] Trauma Hubs           |                                                                      |`  
`|  [x] Active Flight Tracks  |   • Active Asset: STAT 6 (N533ME) - En-Route to UPMC Presby[span_84](start_span)[span_84](end_span)[span_85](start_span)[span_85](end_span)[span_86](start_span)[span_86](end_span)|`  
`|                            |   • Base Station: STAT 4 (KAGC Airport HQ)[span_87](start_span)[span_87](end_span)[span_88](start_span)[span_88](end_span)                   |`  
`|                            |   • Trauma Node: Allegheny General Hospital (42PN)[span_89](start_span)[span_89](end_span)[span_90](start_span)[span_90](end_span)[span_91](start_span)[span_91](end_span)          |`  
`|                            |                                                                      |`  
`+----------------------------+----------------------------------------------------------------------+`  
`|  LIVE RADAR STATUS: NOMINAL | Uplink: WebSocket 2Hz | Sorties Active: 4 | Free Assets: 18[span_92](start_span)[span_92](end_span)[span_93](start_span)[span_93](end_span)      |`  
`+---------------------------------------------------------------------------------------------------+`

#### **Associated Frontend Components:**

> * src/components/map/TheaterMap.tsx: Main map rendering container utilizing Leaflet/Mapbox GL.  
> * src/components/map/AssetMarker.tsx: Dynamic icon displaying active rotorcraft vectors, altitude, groundspeed, and heading.  
> * src/components/map/HelipadOverlay.tsx: Interactive popup rendering hospital elevation, surface type, dimensions, and visual briefing assets.

### **3.2 4-Stage Mission Dispatch Planner (/dashboard/dispatcher)**

Coordinates emergency scene responses and inter-facility transfers with structured validation gates.  
`+---------------------------------------------------------------------------------------------------+`  
`|  MISSION DISPATCH PLANNER                                                                         |[span_105](start_span)[span_105](end_span)`  
`+---------------------------------------------------------------------------------------------------+`  
`|   [ 1. Details ]   ────►   [ 2. Crew ]   ────►   [ 3. Patient Info ]   ────►   [ 4. Flight Plan ]     |[span_106](start_span)[span_106](end_span)`  
`+---------------------------------------------------------------------------------------------------+`  
`|  STAGE 1: DISPATCH DETAILS                                                                        |`  
`|  Mission Type:   ( ) SCENE CALL            (*) INTER-FACILITY TRANSFER[span_107](start_span)[span_107](end_span)                      |`  
`|  Dispatch Base:  [ STAT 6 (KAXQ) - Clarion County Airport        ▼ ][span_108](start_span)[span_108](end_span)[span_109](start_span)[span_109](end_span)                       |`  
`|  Assigned Asset: [ N533ME // H135 Airframe                       ][span_110](start_span)[span_110](end_span)[span_111](start_span)[span_111](end_span)                       |`  
`|  Live METAR:     KAXQ 241853Z 24012KT 10SM CLR 18/04 A2998 [VFR][span_112](start_span)[span_112](end_span)                                |`  
`|                                                                                                   |`  
`|  Origin Facility:    [ UPMC NORTHWEST (SENECA)                   ▼ ][span_113](start_span)[span_113](end_span)[span_114](start_span)[span_114](end_span)                       |`  
`|  Receiving Facility: [ UPMC PRESBYTERIAN (PITTSBURGH)           ▼ ][span_115](start_span)[span_115](end_span)[span_116](start_span)[span_116](end_span)                       |`  
`+---------------------------------------------------------------------------------------------------+`  
`|                                                                    [ LOG CREW ROSTER → ]          |[span_117](start_span)[span_117](end_span)`  
`+---------------------------------------------------------------------------------------------------+`

#### **Associated Frontend Components:**

> * src/components/dispatch/Step1Details.tsx: Mission type selector, base station picker, and METAR decoder.  
> * src/components/dispatch/Step2Crew.tsx: Roster assignment interface for PIC, Flight Nurse (PHRN), and Paramedic.  
> * src/components/dispatch/Step3PatientInfo.tsx: Age/weight inputs, 260+ medical condition dropdown, GCS calculator, and AI Tactical Engine trigger.  
> * src/components/dispatch/Step4FlightPlan.tsx: Quantified PAVE risk assessment matrix, fuel reserve validator, and EFB uplink trigger.

### **3.3 Regional Hospital & Helipad Directory (/dashboard/hospitals)**

Catalog of verified regional trauma centers, base heliports, and landing zones across Pennsylvania and neighboring states.  
`+---------------------------------------------------------------------------------------------------+`  
`|  REGIONAL HOSPITAL MAP & HELIPAD DIRECTORY                                                        |[span_126](start_span)[span_126](end_span)`  
`|  [ Search Facility, City, or FAA ID...                                                          ] |[span_127](start_span)[span_127](end_span)`  
`+---------------------------------------------------------------------------------------------------+`  
`|  +-----------------------------------+  +-----------------------------------+                     |`  
`|  | [IMAGE: AHN CANONSBURG]           |  | [IMAGE: ALLEGHENY GENERAL]        |[span_128](start_span)[span_128](end_span)             |`  
`|  | Affiliated Facility               |  | Affiliated Facility               |[span_129](start_span)[span_129](end_span)             |`  
`|  | AHN CANONSBURG                    |  | ALLEGHENY GENERAL HOSPITAL        |[span_130](start_span)[span_130](end_span)             |`  
`|  | Location: CANONSBURG, PA          |  | Location: PITTSBURGH, PA          |[span_131](start_span)[span_131](end_span)[span_132](start_span)[span_132](end_span)          |`  
`|  | FAA ID: PA67                      |  | FAA ID: 42PN | Level 1 Trauma     |[span_133](start_span)[span_133](end_span)[span_134](start_span)[span_134](end_span)          |`  
`|  | Surface: Concrete | Ground        |  | Surface: Concrete | Rooftop       |[span_135](start_span)[span_135](end_span)[span_136](start_span)[span_136](end_span)          |`  
`|  | Dimensions: 75 x 75 ft            |  | Dimensions: 65 x 65 ft            |[span_137](start_span)[span_137](end_span)[span_138](start_span)[span_138](end_span)          |`  
`|  | [ VIEW BRIEFING ] [ DOWNLOAD ZIP ]|  | [ VIEW BRIEFING ] [ DOWNLOAD ZIP ]|[span_139](start_span)[span_139](end_span)             |`  
`|  +-----------------------------------+  +-----------------------------------+                     |`  
`+---------------------------------------------------------------------------------------------------+`

## **4\. Hardware Bridge Data Link & API Endpoint Mapping**

The bridge application bridges physical simulator memory with virtualhems.com serverless endpoints via a uniform JSON API payload contract.

### **4.1 Real-Time Telemetry Payload Contract (POST /api/telemetry)**

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

### **4.2 API Route Directory & Functional Mapping**

| API Endpoint Path | HTTP Method | Data Payload / Action | Primary System Function |
| :---- | :---- | :---- | :---- |
| /api/dispatch/ai-briefing | POST | Demographics, Medical Condition, WX | Executes Ironpine AI engine to generate facility recommendations and LZ warnings. |
| /api/telemetry | POST | TelemetryFrame JSON Packet | Ingests bridge telemetry stream, evaluates flight envelopes, and broadcasts to Supabase Realtime. |
| /api/aar | POST | Mission ID, Final Touchdown Metrics | Triggers post-flight After-Action Review audit, evaluates G-force/timelines, and logs pilot career hours. |
| /api/hospitals | GET | Coordinates, Radial Distance | Queries PostGIS database for nearest trauma facilities and helipad specs. |
| /api/virs | POST | Incident Category, Pilot Narrative | Logs non-punitive incident reports to the Safety Management System database. |

## **5\. Verification & Application Navigation Audit**

`+---------------------------------------------------------------------------------------------------+`  
`|                                 APPLICATION NAVIGATION AUDIT MATRIX                               |`  
`+-------------------+------------------------------------+------------------------------------------+`  
`| Navigation Route  | Expected Target Component          | Validation Pass Condition                |`  
`+-------------------+------------------------------------+------------------------------------------+`  
``| `/`               | Landing Hero & Public Charter      | Unauthenticated landing page loads[span_152](start_span)[span_152](end_span) |``  
``| `/downloads`      | Desktop Bridge Download Links      | Client installers (.exe/.dmg) available[span_153](start_span)[span_153](end_span)[span_154](start_span)[span_154](end_span)|``  
``| `/command`        | Live Theater Map Engine            | Renders OpenStreetMap with active assets[span_155](start_span)[span_155](end_span)[span_156](start_span)[span_156](end_span)|``  
``| `/dispatcher`     | 4-Stage Dispatch Planner           | Progresses through Stages 1 to 4[span_157](start_span)[span_157](end_span)|``  
``| `/hospitals`      | Helipad Directory & Overlays       | Displays 106+ regional medical nodes[span_158](start_span)[span_158](end_span)[span_159](start_span)[span_159](end_span)[span_160](start_span)[span_160](end_span)|``  
``| `/efb`            | Electronic Flight Bag Terminal     | Live Golden Hour countdown timer active[span_161](start_span)[span_161](end_span)[span_162](start_span)[span_162](end_span)|``  
`+-------------------+------------------------------------+------------------------------------------+`

**Authored By:** Lead Tactical Architect & Lead Software Engineer, Virtual HEMS **Approved By:** Directorate of Technology & Operational Safety Council **Repository Location:** virtualhems-monorepo/docs/APP-MAP.md