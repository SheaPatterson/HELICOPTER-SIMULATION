# **Module 4: Clinical Logistics & Mission Execution**

**Document Designation:** VHOP-04-CLIN **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Technical Dispatch Architecture, Medical Engine Protocols, Regional Hospital Infrastructure, and Operational Execution for Western Pennsylvania and Tri-State HEMS Operations

## **4.1 Dispatch & Operations Center (OPS-CENTER) Architecture**

### **4.1.1 Bridge Technology & Telemetry Pipeline**

The core of the Virtual HEMS platform relies on the **HEMS OPS-CENTER v5.3.0**, a standalone mission coordination bridge connecting flight simulation engines directly to a cloud-based tactical hub.  
\+-----------------------------------------------------------------------------------+  
|                        UNIVERSAL SIMULATOR TELEMETRY PIPELINE                     |  
\+-----------------------------------------------------------------------------------+  
|  \[ MSFS 2020 / 2024 \]  ──► SimConnect API  ──┐                                    |  
|                                             ├──► Low-Latency Bridge (.exe / Lua)   |  
|  \[ X-Plane 11 / 12 \]   ──► Custom UDP Link ─┘          │                          |  
|                                                        ▼                          |  
|  \[ Global Telemetry Hub \] ◄── Supabase Realtime ───────┘                          |  
|  (Sub-Second Latency Data Engine) \[1\]                                             |  
|            │                                                                      |  
|            ├──► Global Theater Map (OpenStreetMap Overwatch Layer) \[1\]            |  
|            ├──► Tactical AI Engine (Ironpine Dispatch & Integrity Monitor) \[1\]     |  
|            └──► Pilot Cockpit EFB / Command Terminal \[1, 4\]                      |  
\+-----------------------------------------------------------------------------------+

> * **Universal Simulator Uplink:** Operates across Windows and macOS (Intel & Apple Silicon) via platform-agnostic telemetry bridges. Microsoft Flight Simulator (MSFS 2020/2024) utilizes a native SimConnect interface, while X-Plane (11/12) connects via custom UDP data streams.  
> * **Global Telemetry Hub (Supabase Realtime):** Aircraft state vectors (latitude, longitude, MSL altitude, ground speed, heading, outside air temperature, fuel state) are transmitted at sub-second intervals to cloud infrastructure.  
> * **Tactical AI Engine (Ironpine):** Analyzes incoming flight telemetry against dispatch constraints, weather conditions, speed envelopes, and clinical timelines.  
> * **Global Theater Map:** Renders active HEMS assets, base stations, and regional medical nodes on a live tracking interface.

\+-----------------------------------------------------------------------------------+  
|                       TELEMETRY BRIDGE DATA MATRIX SPECIFICATION                  |  
\+--------------------------+-----------------------+--------------------------------+  
| Telemetry Parameter      | Acquisition Source    | Operational Function           |  
\+--------------------------+-----------------------+--------------------------------+  
| Latitude / Longitude     | SimConnect / UDP      | Real-time Map Plotting & Recce |  
| Altitude (MSL & AGL)     | Radar Altimeter / Baro| Terrain Clearance / GPWS Audit |  
| Ground Speed / Airspeed  | Flight Dynamic Engine | ETL Verification / Speed Rules |  
| Fuel Mass (LBS / GAL)    | Engine Telemetry      | Reserve Fuel Margin Auditing   |  
| Engine Torque / TOT      | VEMD Output           | OEI & Over-Torque Event Logging|  
| Outside Air Temp (OAT)   | Environmental Engine  | Density Altitude & Icing Checks|  
\+--------------------------+-----------------------+--------------------------------+

### **4.1.2 Real-World Dispatch UI Modeling**

Modeled after real-world dispatch networks (such as STAT MedEvac Command and AHN LifeFlight Communications), the UI provides a four-stage mission workflow:  
                       MISSION DISPATCH WORKFLOW STAGES  
                         
  \[ 1\. Details \] ──► \[ 2\. Crew \] ──► \[ 3\. Patient Info \] ──► \[ 4\. Flight Plan \] \[7, 15\]  
        │                   │                 │                      │  
  Mission Type         Roster Entry      Clinical Triage        Performance Briefing  
  (Scene / Transfer)  (Pilot/Nurse/      & GCS Scoring          (Fuel / Distance /  
  \[7, 12\]              Paramedic) \[10\]   \[1, 5\]                 Go-No-Go Clearance) \[15\]

## **4.2 Medical Simulation Engine & Clinical Logic**

### **4.2.1 Medical Emergency Database Structure**

The medical simulation engine contains a clinical database of **over 260 distinct medical conditions** spanning traumatic, cardiac, neurological, pediatric, and environmental conditions.  
\+-----------------------------------------------------------------------------------+  
|                        CLINICAL CATEGORIZATION SAMPLE                             |  
\+------------------------+------------------------------------+---------------------+  
| Condition Category     | Sample Pathology                   | Required Center     |  
\+------------------------+------------------------------------+---------------------+  
| Major Blunt Trauma     | Multi-System Polytrauma / Flail    | Level 1 Trauma      |  
| Penetrating Trauma     | GSW to Chest/Abdomen               | Level 1 Trauma      |  
| Neurotrauma            | Epidural Hematoma / GCS \< 8        | Level 1 Comprehensive|  
| Cardiac Emergency      | Acute STEMI / Cardiogenic Shock    | Cath-Capable Hub    |  
| Cerebrovascular        | Acute Ischemic Stroke / LVO        | Comprehensive Stroke|  
| High-Risk OB           | Eclampsia / Severe Abruptio        | Specialty OB Center |  
\+------------------------+------------------------------------+---------------------+

### **4.2.2 The "Golden Hour" Timed Deterioration Engine**

Every dispatched scene mission activates a dynamic countdown timer simulating human physiological decay.  
                     GOLDEN HOUR PHYSIOLOGICAL TIMELINE  
                       
     \[ Scene Dispatch \] ──► Golden Hour Clock Initiated (60:00 Min Countdown) \[1\]  
                                       │  
     \[ On-Scene Arrival \] ─► Max On-Scene Time Threshold: 10-15 Minutes  
                                       │  
                                       ├─ On-Time Departure ──► Patient Stable  
                                       └─ Extended Delay    ──► Patient Deteriorates  
                                                                (GCS Drops / Vitals Collapse) \[1, 5\]  
                                       │  
     \[ Hospital Touchdown\] ─► Automated After-Action Review (AAR) Assessment \[1, 4\]

> * **Clinical Score Calculation:** S\_{\\text{Final}} \= S\_{\\text{Baseline}} \- \\left( \\Delta T\_{\\text{Scene}} \\times K\_1 \\right) \- \\left( \\Delta T\_{\\text{Transit}} \\times K\_2 \\right) Where K\_1 is the on-scene delay penalty factor, and K\_2 is the flight inefficiency penalty factor.  
> * **After-Action Review (AAR):** Upon landing at the destination helipad, the flight telemetry, time-on-scene, route efficiency, and landing metrics are compiled into an automated performance audit.

\+-----------------------------------------------------------------------------------+  
|                      AFTER-ACTION REVIEW (AAR) AUDIT MATRIX                       |  
\+--------------------------+-----------------------+--------------------------------+  
| Metric Monitored         | Target Threshold      | Deviation Penalty              |  
\+--------------------------+-----------------------+--------------------------------+  
| Time on Scene            | \$\\le 15.0\\text{ Mins}\$| Score Deduction / Vitals Drop  |  
| En-Route Flight Route    | \$\\le \+10\\%\$ Direct Dist| Extended Transit Time Penalty  |  
| Max Pitch/Roll Limits    | Pitch \$\\pm 15^\\circ\$, | Patient Agitation / GCS Drop   |  
|                          | Roll \$\\pm 30^\\circ\$   |                                |  
| Reserve Fuel at Touchdown| \$\\ge 20\\text{ Mins}\$  | Safety Compliance Violation    |  
| Touchdown G-Force        | \$\\le 1.5\\text{ G}\$    | Hard Landing / Dynamic Risk    |  
\+--------------------------+-----------------------+--------------------------------+

## **4.3 Mission Execution Profiles: Scene Calls vs. Inter-Facility Transfers**

### **4.3.1 Primary Scene Response Mission Profile**

                 PRIMARY SCENE RESPONSE EXECUTION CIRCUIT  
                   
  \[ Base Station \] ──► High-Speed VFR Transit ──► Scene High/Low Recce \[1\]  
                                                        │  
  \[ Level 1 Trauma Center \] ◄── Priority Transport ◄── \[ Touchdown / Hot Load \] \[5\]

#### **Operational Sequence:**

> 1. **Dispatch Receipt:** Receive scene coordinates, localized weather (METAR/TAF), and initial clinical status.  
> 2. **En-Route Operations:** Fly direct or obstacle-cleared corridor; monitor density altitude and hover performance limits.  
> 3. **Scene Arrival & LZ Recce:** Perform High Reconnaissance at 500\\text{ ft AGL}, then Low Reconnaissance at 200\\text{ ft AGL} to verify hazards, slope, and downwash security.  
> 4. **On-Scene Care & Hot-Loading:** Land, complete patient loading within the 15-minute window, and secure the litter.  
> 5. **Priority Transport:** Establish climb to safe altitude, submit radio report (Priority 1 Patch Call) to receiving Trauma Center, and execute final landing.

### **4.3.2 Inter-Facility Critical Care Transfer Profile**

               INTER-FACILITY TRANSFER EXECUTION CIRCUIT  
                 
  \[ Base Station \] ──► Community Hospital ──► Patient Transfer ──► Level 1 / Specialty  
                       Rooftop/Ground LZ       & Stabilization     Trauma Center \[1, 3\]

#### **Operational Sequence:**

> 1. **Transfer Dispatch:** Issued when a community hospital requires advanced tertiary care (e.g., Cath Lab, ECMO, Level 1 Trauma) for a patient.  
> 2. **Origin Facility Approach:** Navigate to community hospital helipad, executing published visual or instrument approach profiles.  
> 3. **Clinical Handover:** Transfer patient from hospital ICU/ED team to air medical crew.  
> 4. **Secondary En-Route Cruise:** Perform continuous clinical monitoring via cockpit EFB terminal.  
> 5. **Destination Offload:** Land at tertiary receiving facility helipad (e.g., UPMC Presbyterian, Allegheny General).

## **4.4 Regional Infrastructure Specification (Western PA & Tri-State Focus)**

### **4.4.1 STAT MedEvac Base Station Network**

Operated by the Center for Emergency Medicine of Western Pennsylvania, headquartered at Allegheny County Airport (KAGC) in West Mifflin, PA:  
\+----------------------------------------------------------------------------------------------------+  
|                         STAT MEDEVAC BASE STATION REGISTRY                                         |  
\+---------------+---------+--------+-------------+------------------------------------+------+-------+  
| Base ID       | FAA ID  | Tail \# | Aircraft    | Base Location / Facility           | Elev | State |  
\+---------------+---------+--------+-------------+------------------------------------+------+-------+  
| Stat MedEvac 1| 60PN    | N527ME | EC135       | Washington Hospital                | 1156 | PA \[3\]|  
| Stat MedEvac 2| PA28    | N530ME | H135        | Air Rescue East (Latrobe)          | 1251 | PA \[3\]|  
| Stat MedEvac 3| PA56    | N536ME | H135        | UPMC Passavant \- Cranberry         | 1100 | PA \[3\]|  
| Stat MedEvac 4| KAGC    | N507ME | EC145       | Allegheny County Airport (HQ)      | 1251 | PA \[3\]|  
| Stat MedEvac 5| KVVS    | N307ME | EC145       | Joseph A. Hardy Connellsville Apt  | 1264 | PA \[3\]|  
| Stat MedEvac 6| KAXQ    | N533ME | H135        | Clarion County Airport             | 1457 | PA \[3\]|  
| Stat MedEvac 7| KGKJ    | N884ME | EC135       | Port Meadville Airport             | 1399 | PA \[3\]|  
| Stat MedEvac 8| 29D     | N536ME | H135        | Grove City Airport                 | 1370 | PA \[3\]|  
| Stat MedEvac 9| KFIG    | N855ME | EC135       | Clearfield-Lawrence Airport        | 1516 | PA \[3\]|  
| Stat MedEvac 10|0MD3    | N522ME | EC145       | Johns Hopkins Hospital             | 260  | MD \[3\]|  
| Stat MedEvac 11|74PN    | N448ME | EC135       | UPMC Altoona                       | 1259 | PA \[3\]|  
| Stat MedEvac 12|4NK0    | N639ME | EC135       | UPMC Chautauqua                    | 1340 | NY \[3\]|  
| Stat MedEvac 13|KTHV    | N442ME | EC135       | York Airport                       | 494  | PA \[3\]|  
| Stat MedEvac 14|4G4     | N845ME | EC135       | Youngstown Elser Metro Airport     | 1069 | OH \[3\]|  
| Stat MedEvac 15|2G2     | N446ME | EC135       | Jefferson County Airpark           | 1198 | OH \[3\]|  
| Stat MedEvac 16|81PN    | N915ME | EC135       | Armstrong County Memorial Hospital | 1141 | PA \[3\]|  
| Stat MedEvac 17|39PS    | N87ME  | EC135       | Harborcreek Heliport               | 760  | PA \[3\]|  
| Stat MedEvac 18|DC17    | N932ME | EC145       | Children's National Hospital        | 285  | DC \[3\]|  
\+---------------+---------+--------+-------------+------------------------------------+------+-------+

### **4.4.2 AHN LifeFlight Base Station Network**

Operated by Allegheny Health Network (AHN), providing 24/7 critical care air transport across Western PA, Ohio, West Virginia, and Maryland:  
\+----------------------------------------------------------------------------------------------------+  
|                         AHN LIFEFLIGHT BASE STATION REGISTRY                                       |  
\+---------------+---------+--------+-------------+------------------------------------+------+-------+  
| Base ID       | FAA ID  | Tail \# | Aircraft    | Base Location / Facility           | Elev | State |  
\+---------------+---------+--------+-------------+------------------------------------+------+-------+  
| LifeFlight 1  | PA67    | N878LF | EC135       | Canonsburg Hospital                | 1169 | PA \[3\]|  
| LifeFlight 2  | 91PA    | N131LF | EC145       | Clarion Hospital                   | 1489 | PA \[3\]|  
| LifeFlight 3  | PN32    | N474LF | EC145       | Indiana Regional Medical Center    | 1285 | PA \[3\]|  
| LifeFlight 4  | KBTP    | N373LF | EC145       | Pittsburgh/Butler Regional Airport | 1248 | PA \[3\]|  
| LifeFlight 5  | KFWQ    | N575LF | EC145       | Rostraver Airport                  | 1228 | PA \[3\]|  
\+---------------+---------+--------+-------------+------------------------------------+------+-------+

### **4.4.3 Primary Hospital Helipad Directory (Selected Regional Nodes)**

High-fidelity hospital helipads modeled across the regional flight environment:  
\+------------------------------------------------------------------------------------------------------+  
|                         PRIMARY HOSPITAL HELIPAD DIRECTORY                                           |  
\+-----------------------------------+--------+-------------------+------+-----------+-----------+------+  
| Hospital Facility Name            | FAA ID | Location          | Elev | Surface   | Placement | Size |  
\+-----------------------------------+--------+-------------------+------+-----------+-----------+------+  
| UPMC Presbyterian                 | PS78   | Pittsburgh, PA    | 1124 | Concrete  | Rooftop   | 96x48|  
| UPMC Mercy                        | PN23   | Pittsburgh, PA    | 886  | Concrete  | Rooftop   | 65x65|  
| UPMC Children's Hospital          | 30PN   | Pittsburgh, PA    | 1088 | Concrete  | Rooftop   | 45x45|  
| Allegheny General Hospital        | 42PN   | Pittsburgh, PA    | 804  | Concrete  | Rooftop   | 65x65|  
| UPMC Hamot                        | 0PS8   | Erie, PA          | 900  | Concrete  | Rooftop   | 60x65|  
| UPMC Altoona                      | 74PN   | Altoona, PA       | 1259 | Concrete  | Rooftop   | 65x65|  
| Penn Highlands DuBois             | PA10   | DuBois, PA        | 1463 | Concrete  | Ground    | 32x32|  
| Forbes Hospital                   | 54PN   | Pittsburgh, PA    | 1198 | Asphalt   | Ground    | 44x44|  
| Clarion Hospital                  | 91PA   | Clarion, PA       | 1489 | Concrete  | Ground    | 50x50|  
| Canonsburg Hospital               | PA67   | Canonsburg, PA    | 1169 | Concrete  | Ground    | 75x75|  
| Butler Memorial Hospital          | PA41   | Butler, PA        | 1190 | Asphalt   | Ground    | 65x65|  
| St Vincent Hospital               | 29PN   | Erie, PA          | 731  | Asphalt   | Rooftop   | 65x65|  
| Warren General Hospital           | PA97   | Warren, PA        | 1179 | Asphalt   | Ground    | 40x40|  
| Cleveland Clinic Main Campus      | 6OI8   | Cleveland, OH     | 724  | Concrete  | Rooftop   | 50x50|  
\+-----------------------------------+--------+-------------------+------+-----------+-----------+------+

## **4.5 Communications Interoperability & Failure Protocol**

### **4.5.1 Radio Frequency & Network Topology**

Virtual HEMS crews utilize dedicated voice and data channels to simulate regional emergency dispatch operations:  
\+-----------------------------------------------------------------------------------+  
|                        COMMUNICATIONS TOPOLOGY SPECIFICATION                      |  
\+-------------------+----------------------+----------------------------------------+  
| Channel Purpose   | Operational Frequency| Network Protocol                       |  
\+-------------------+----------------------+----------------------------------------+  
| HEMS Dispatch     | 340 / 400 VHF HEAR   | Voice Channel / Web Command Terminal   |  
| Emergency Trunk   | 800 MHz MPSCS System | Regional Interoperability Talkgroup    |  
| Hospital Patch    | UHF / Direct Patch   | Primary Inbound Medical Direct Line    |  
| Telemetry Data    | Supabase Port 443    | Encrypted Real-Time UDP Data Link      |  
\+-------------------+----------------------+----------------------------------------+

### **4.5.2 Standard Patch Call Execution**

When transporting Priority 1 or Priority 2 patients, a patch call must be made to the receiving trauma facility prior to arrival:  
                        STANDARD PATCH CALL STRUCTURE  
                          
   1\. Identification   ──► "UPMC Presby, Stat MedEvac 6 on Priority 1 Patch." \[3, 5\]  
   2\. Patient Demographics ─► "42-year-old male, driver in high-speed MVA." \[5\]  
   3\. Clinical Vitals   ──► "GCS 7, Intubated, BP 90/60, HR 120, SpO2 94%." \[3, 5\]  
   4\. Injuries / Care  ──► "Blunt chest trauma, bilateral chest decompression." \[5\]  
   5\. ETA & Requests   ──► "ETA 8 minutes. Request Trauma Team activation." \[5\]

### **4.5.3 Communications Failure Contingency**

In the event of total voice connection failure or network loss during critical flight phases:  
                       COMMUNICATIONS FAILURE FLOW (SECTION 8.12)  
                         
  \[ Local Comms Failure Identified \] ──► Execute Autonomous Clinical Protocols \[2, 5\]  
                                                       │  
  \[ Re-establish Radio / Telemetry \] ──► Report Care Rendered to Medical Control \[5\]  
                                                       │  
  \[ Mission Completion \] ──────────────► File Radio Incident Failure Report \[2, 5\]  
                                         (Mandatory within 24 Hours) \[2, 5\]

## **Document Control & Operational Compliance**

**Authored By:** Lead Tactical Dispatch Architect & Clinical Logistics Coordinator, Virtual HEMS **Approved By:** Directorate of Medical Operations & Systems Engineering, Virtual HEMS Council **Repository Distribution:** Document synced with virtualhems.com Master Architecture Index