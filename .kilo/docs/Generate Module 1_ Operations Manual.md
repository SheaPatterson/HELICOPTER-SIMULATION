# **Virtual HEMS Operations Manual (VHOP-01)**

**Document Designation:** VHOP-01 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Standard Operating Procedures, Safety Management System, and Crew Resource Management Protocols for High-Fidelity Aeromedical Flight Simulation

## **1\. Administrative & Regulatory Framework**

### **1.1 Document Administrative Control & Policy Directive**

This manual, designated **VHOP-01**, constitutes the supreme operational policy document for all flight crews, V-Medics (Flight Nurses, Flight Paramedics, and Communications Specialists), and flight-following personnel operating within the **Virtual HEMS** platform. Standardizing procedures is a fundamental requirement for maintaining operational safety and consistency across all missions. Adherence to the provisions of VHOP-01 is mandatory across all active virtual flight simulation operations (supporting Microsoft Flight Simulator 2020/2024 and X-Plane 11/12 via the HEMS OPS-CENTER v5.3.0 bridge).  
`+-----------------------------------------------------------------------------------+`  
`|                            VHOP-01 REVISION CONTROL MATRIX                        |`  
`+-------------------+-------------------+----------------------+--------------------+`  
`| Cycle Designation | Review Frequency  | Approving Authority  | Target Operational |`  
`|                   |                   |                      |    Environment     |`  
`+-------------------+-------------------+----------------------+--------------------+`  
`| Annual Review     | Mandatory 365 days| Executive Board /    | Platform-wide      |`  
`|                   |                   | Safety Officer [1, 2]| Baseline [1]       |`  
`| Direct Action     | Immediate (Ad-hoc)| Executive / Safety   | Critical Safety /  |`  
`| Revision (DAR)    |                   | Lead [1, 2]          | Sim Bug Fixes [1,2]|`  
`+-------------------+-------------------+----------------------+--------------------+`

All revisions must be logged within the HEMS Content Management system. Modifications to procedures, checklists, or weather minimums are synchronized across the desktop bridge and web-based command terminal immediately upon publication.

### **1.2 Administrative Governance**

> * **Executive Board Approval:** The Executive Team maintains sole approval authority over VHOP-01 modifications.  
> * **Controlled Distribution:** Official distribution is executed digitally through virtualhems.com. Local modified copies are non-authoritative.  
> * **Annual Review Cycle:** The Safety Officer and Executive Team conduct an annual audit of all operational directives to align with real-world FAA Part 135 regulations, CAMTS standards, and evolving simulator physics/telemetry APIs.

### **1.3 Operational Philosophy & Core Mandate**

Virtual HEMS operates under the philosophy that flight simulation must transcend basic flight physics to encompass the full operational complexity of emergency aeromedical transport.  
                              `+--------------------------+`  
                              `|   OPERATIONAL MANDATE    |`  
                              `+------------+-------------+`  
                                           `|`  
         `+---------------------------------+---------------------------------+`  
         `|                                 |                                 |`  
`+--------v--------+               +--------v--------+               +--------v--------+`  
`|    INTEGRITY    |               |   RELIABILITY   |               |     SERVICE     |`  
`| Flight logging, |               | Strict SOP      |               | Clinical care,  |`  
`| honest VIRS     |               | adherence &     |               | patient dignity |`  
`| reporting [1]   |               | dispatch compliance [1]         | & safety [1]    |`  
`+-----------------+               +-----------------+               +-----------------+`

> 1. **Integrity:** Honest reporting of flight telemetry, simulation software glitches, weather conditions, and pilot errors without fear of punitive action.  
> 2. **Reliability:** Strict adherence to assigned flight profiles, clinical time-on-scene requirements, and standard radiotelephony protocols.  
> 3. **Service:** Delivering realistic critical care transport while upholding simulated patient dignity and absolute confidentiality across public networks.

### **1.4 Virtual Regulatory Adaptation (FAA Part 135 & CAMTS)**

Virtual HEMS adapts principles from Federal Aviation Regulation (FAR) Part 135 (Helicopter Air Ambulance Operations) and Commission on Accreditation of Medical Transport Systems (CAMTS) guidelines to structure virtual flight operations:

> * **Flight & Duty Time Limitations:** Pilots shall not exceed 4 consecutive hours of active virtual flight duty without a mandatory 30-minute rest interval.  
> * **Two-Pilot vs. Single-Pilot IFR:** Single-pilot IFR operations require an active, certified 4-axis Autopilot / Flight Control System (AFCS) with Stability Augmentation System (SAS) enabled. Otherwise, a dual-pilot configuration (PF and PM) is mandatory under IFR conditions.  
> * **Clinical Staffing Standard:** Primary HEMS scene responses and inter-facility critical care transports mandate a minimum crew of two medical professionals (e.g., Flight Nurse PHRN \+ Flight Paramedic/Communications Specialist) alongside the Pilot-in-Command.

## **2\. Safety Management System (SMS) & VIRS Protocols**

### **2.1 The Four Pillars of Virtual SMS**

Virtual HEMS formally implements the standard four-pillar Safety Management System architecture, customized for a networked virtual aviation ecosystem:  
`+-----------------------------------------------------------------------------------+`  
`|                        SAFETY MANAGEMENT SYSTEM (SMS) PILLARS                     |`  
`+-------------------+-------------------+-------------------+-----------------------+`  
`|  SAFETY POLICY    |    SAFETY RISK    | SAFETY ASSURANCE  |   SAFETY PROMOTION    |`  
`|                   |    MANAGEMENT     |                   |                       |`  
`+-------------------+-------------------+-------------------+-----------------------+`  
`| Executive safety  | Identification of | VIRS auditing,    | Training pipeline,    |`  
`| commitment, non-  | low-level hazards,| flight telemetry  | recurrent checks every|`  
`| punitive reporting| weather, sim crash| analysis, AAR     | 120 days, safety      |`  
`| policy [1]        | threats [1]       | monitoring [1, 2] | bulletins [1]         |`  
`+-------------------+-------------------+-------------------+-----------------------+`

> 1. **Safety Policy:** Establishes safety as the overriding operational priority, superseding mission completion or time pressures.  
> 2. **Safety Risk Management (SRM):** Continuous hazard identification, focus on low-level obstacles, Inadvertent Entry into IMC (IIMC), terrain proximity, and hardware/software instability.  
> 3. **Safety Assurance (SA):** Systematic analysis of recorded telemetry via the HEMS OPS-CENTER bridge and evaluation of submitted incident reports.  
> 4. **Safety Promotion:** Dissemination of lessons learned through After-Action Reviews (AAR), mandatory safety bulletins, and recurrent training cycles.

### **2.2 Virtual Incident Reporting System (VIRS)**

The Virtual Incident Reporting System (VIRS) is a non-punitive, web-integrated reporting framework. Its goal is to identify systemic vulnerabilities in simulation software, flight dynamics models, custom scenery helipads, or procedural execution.  
`VIRS REPORTING FLOW:`  
`[ Incident / Failure Event ]`   
            `│`  
            `▼`  
`[ Submit VIRS via OPS-CENTER Terminal ] ──(Mandatory within 24 Hours) [1, 3]`  
            `│`  
            `▼`  
`[ Safety Officer Root Cause Analysis ] ──(Categorization: Hardware / WX / Human / Sim) [1]`  
            `│`  
            `▼`  
`[ Operational Strategy Adjustment / Safety Bulletin Dissemination ] [1]`

#### **Mandatory Reporting Triggers:**

> * Unintentional entry into Instrument Meteorological Conditions (IIMC).  
> * Controlled Flight Toward Terrain (CFTT) or Ground Proximity Warning (GPWS) activation.  
> * Hard landing or dynamic rollover event.  
> * Simulator application crash, frame-rate degradation below 20 FPS during critical phases, or telemetry bridge disconnect.  
> * Helipad elevation misalignment or scenery obstacle collision (e.g., floating trees, unmapped power lines).  
> * Breach of sterile cockpit protocol or standard communication loss lasting \> 5 minutes.

## **3\. Quantified Operational Risk Management (ORM) & PAVE Matrix**

### **3.1 Quantified Operational Risk Assessment**

Before every flight, the Pilot-in-Command (PIC) must complete the **Quantified PAVE Risk Assessment Matrix** directly within the HEMS Mission Dispatch Planner. Each hazard factor is assigned a numeric value from 1 (Lowest Risk) to 5 (Highest Risk). The cumulative score dictates the mission authorization level.  
`+------------------------------------------------------------------------------------------------------+`  
`|                         QUANTIFIED OPERATIONAL RISK MATRIX (PAVE)                                    |`  
`+------------------+------------------------------+-------+--------------------------------+-----------+`  
`| Risk Element     | Identified Hazard Parameter  | Score | Mandatory Mitigation Strategy   | Go Threshold|`  
`+------------------+------------------------------+-------+--------------------------------+-----------+`  
`| Pilot (P)        | Night/NVG Currency > 90 days  |   4   | Execute daytime VFR or assignment| Score <= 2|`  
`|                  | Lapsed IFR Currency (>120d)  |   5   | Re-assign to VFR-only mission  | Automatic |`  
`|                  | Flight Duty > 3 Continuous hrs|   3   | Mandatory 30-min break [1]     | NO-GO [1] |`  
`+------------------+------------------------------+-------+--------------------------------+-----------+`  
`| Aircraft (A)     | Hardware Unchecked / Dynamic  |   3   | Full axis calibration check    | Score <= 2|`  
`|                  | Sim FPS Unstable (< 25 FPS)  |   4   | Reduce graphics settings       |           |`  
`|                  | Single-Engine (OEI) Flight   |   3   | En-route drift-down planning   |           |`  
`+------------------+------------------------------+-------+--------------------------------+-----------+`  
`| enVironment (V)  | Cloud Base < 500 ft AGL      |   5   | Delay until WX improves or IFR | Automatic |`  
`|                  | Visibility < 1.0 SM          |   5   | Re-route to Category I ILS Apt | NO-GO [1] |`  
`|                  | Surface Winds > 25 kts/G35   |   4   | Evaluate rotor start limits    |           |`  
`|                  | Severe Icing Forecast        |   5   | Abort / Ground Delay           | Automatic |`  
`|                  | Unlit Scene LZ at Night      |   4   | Mandate high-recce / Night Vision| NO-GO [1] |`  
`+------------------+------------------------------+-------+--------------------------------+-----------+`  
`| External (E)     | Time-Critical Patient        |   4   | Enforce Sterile Cockpit;       | Do NOT    |`  
`|                  | (Golden Hour Timer Active)   |       | PM monitors PF speed/altitude  | rush flight|`  
`|                  | High-Traffic Online Network  |   2   | Verify ATC frequency handover  | mechanics |`  
`+------------------+------------------------------+-------+--------------------------------+-----------+`

#### **Scoring Decision Logic:**

> * **Total Score 4–10 (Green):** Operational **GO**. Proceed under standard SOPs.  
> * **Total Score 11–15 (Yellow):** Operational **CAUTION**. Requires explicit mitigation (e.g., selecting IFR flight plan, switching airframe) before departure.  
> * **Total Score \>= 16 or ANY Single "5" Factor (Red):** Mandatory **NO-GO**. Mission must be delayed, re-routed, or declined.

### **3.2 Weather Minimums Matrix**

HEMS operations require weather minimums based on operational environment, lighting, and crew qualification:  
`+------------------------------------------------------------------------------------+`  
`|                         VIRTUAL HEMS WEATHER MINIMUMS MATRIX                       |`  
`+-------------------+--------------------+----------------------+--------------------+`  
`| Operational Zone  | Flight Regime      | Day Ceiling / Vis    | Night Ceiling / Vis|`  
`+-------------------+--------------------+----------------------+--------------------+`  
`| Non-Congested     | Local VFR          | 500 ft / 1.0 SM [1]  | 800 ft / 2.0 SM    |`  
`| Surface / Rural   | Cross-Country VFR  | 800 ft / 2.0 SM      | 1,000 ft / 3.0 SM  |`  
`+-------------------+--------------------+----------------------+--------------------+`  
`| High-Density Urban| Local VFR          | 800 ft / 2.0 SM      | 1,000 ft / 3.0 SM  |`  
`| / Rooftop Helipad | Cross-Country VFR  | 1,000 ft / 3.0 SM    | 1,500 ft / 5.0 SM  |`  
`+-------------------+--------------------+----------------------+--------------------+`  
`| Off-Field Scene   | Unaided Night      | PROHIBITED           | 1,500 ft / 5.0 SM  |`  
`| Landing Zone (LZ) | NVG Assisted       | N/A                  | 1,000 ft / 3.0 SM  |`  
`+-------------------+--------------------+----------------------+--------------------+`  
`| Standard IFR      | En-Route / Terminal| Published Approach   | Published Approach |`  
`|                   |                    | Minima (Low-Vector)  | Minima             |`  
`+-------------------+--------------------+----------------------+--------------------+`

## **4\. Crew Resource Management (CRM) & Communication Protocols**

### **4.1 Crew Roles & Workload Division**

Clear task allocation prevents task saturation during critical phases of flight (Takeoff, Approach, Scene Reconnaissance, Landing):  
`+-----------------------------------------------------------------------------------+`  
`|                        CREW TASK ALLOCATION (PF vs. PM)                           |`  
`+---------------------------------------+-------------------------------------------+`  
`| Pilot Flying (PF)                     | Pilot Monitoring (PM) / V-Medic           |`  
`+---------------------------------------+-------------------------------------------+`  
`| Primary Aircraft Control & Handling   | Monitoring Flight Instruments & Telemetry |`  
`| Navigation Execution                  | Radio Communications & ATC Coordination   |`  
`| Obstacle Clearance & Hover Management | Checklist Challenge and Response          |`  
`| Directing LZ Reconnaissance Descent   | Patient Deterioration Monitoring & Logins  |`  
`| Decision to Execute Go-Around         | LZ Obstacle Spotting & Altimeter Callouts |`  
`+---------------------------------------+-------------------------------------------+`

### **4.2 Sterile Cockpit Directive**

> * **Enforcement Threshold:** The Sterile Cockpit Protocol is active during all ground ops, hover taxi, takeoff, climb-out below 1,000 ft AGL, en-route low-level operations, and final approach to landing.  
> * **Prohibition:** All non-flight-essential conversation, administrative radio chatter, or unnecessary clinical discussions are prohibited.  
> * **Safety Exception:** Any crew member (Pilot, Nurse, Paramedic) can break sterile cockpit to call out an immediate safety threat (e.g., *"UNMAPPED POWER LINE \- CLIMB\!"* or *"TRAFFIC, 2 O'CLOCK HIGH"*).

### **4.3 Standard Radiotelephony (RTF) Phraseology**

Virtual HEMS crews adhere to ICAO Doc 9432 standard phraseology combined with HEMS priority descriptors.  
`TYPICAL MULTI-STATION CALL FLOW:`

`[HEMS Unit] ──► "HEMS Radio, Stat MedEvac 6 with Priority 1 Trauma Traffic." [1, 3]`  
`[HEMS Radio] ◄── "Stat MedEvac 6, HEMS Radio, go ahead." [3]`  
`[HEMS Unit] ──► "Patch us to UPMC Presbyterian. En-route from scene, ETA 12 minutes." [3, 11]`  
`[HEMS Radio] ──► "UPMC Presby Emergency, HEMS Radio, Priority 1 patch for Stat MedEvac 6." [3]`  
`[Hospital]  ◄── "UPMC Presby copying, go ahead Stat MedEvac 6." [3]`

#### **Key Telephony Guidelines:**

> 1. **Priority Designation:** Always prefix initial radio contact with mission priority (Priority 1: Critically Ill/Trauma; Priority 2: Serious/Stable; Priority 3: Non-Emergency/Transfer).  
> 2. **Callsign Integration:** Use official operator callsigns (e.g., *"Stat MedEvac 6"*, *"LifeFlight 2"*, or *"Helimed 01"*).

### **4.4 Patient Confidentiality Protocol**

Under no circumstances should real-world patient identifiers, actual personal names, or non-simulated HIPAA-sensitive information be transmitted over public VATSIM/IVAO radio networks or public discord channels. All patient transmissions must utilize simulated randomized data generated by the HEMS Mission Dispatcher (e.g., *"43-year-old female, MVA, blunt trauma, GCS 12"*).

## **5\. Standard Operating Procedures (SOPs) — Flight Cycle**

`+-----------------------------------------------------------------------------------+`  
`|                        VHOP-01 COMPLETE FLIGHT CYCLE                              |`  
`+-----------------------------------------------------------------------------------+`  
`| 1. PRE-FLIGHT      │ Load Manifest, Fuel Planning, PAVE Risk Matrix, WX Briefing |`  
`| 2. START & TAXI    │ Cold & Dark Checklist, FADEC Checks, Hover Power Check      |`  
`| 3. DEPARTURE       │ Clear Air Corridor, Tower Handover, En-route Navigation    |`  
`| 4. SCENE / TRANS   │ High Recce (500'), Low Recce (200'), Touchdown / Hot Load    |`  
`| 5. CLINICAL TRANS  │ En-route Monitoring, Golden Hour Timer, Hospital Patch Call|`  
`| 6. TERMINAL ARR   │ Helipad Approach, Rotor Shutdown / Post-Flight Telemetry Log|`  
`+-----------------------------------------------------------------------------------+`

### **5.1 Pre-Flight & Performance Planning**

> 1. **Load Manifest Calculation:** Verify total gross weight (Aircraft Basic Empty Weight \+ Crew Weight \+ Patient Weight \+ Required Fuel) does not exceed Max Gross Takeoff Weight (MGTOW).  
> 2. **Performance Verification:** Check Hover In-Ground Effect (HIGE) and Hover Out-of-Ground Effect (HOGE) performance tables against current temperature and density altitude. Ensure a minimum 10% power margin exists for OGE hover requirements at uncontrolled scene locations.  
> 3. **Fuel Reserve Mandatory:** HEMS flights must land with a minimum of 20 minutes (VFR) or 30 minutes (IFR) reserve fuel remaining.

### **5.2 Hover Power & Systems Checks**

Upon establishing a 5-foot hover over the departure pad:

> * Perform a **Hover Power Check**: Compare actual engine torque/TOT against pre-flight calculated HOGE limits.  
> * Verify flight control responsiveness (Cyclic, Collective, Anti-torque pedals).  
> * Confirm center-of-gravity (CG) stability and verify hydraulic pressure indicators are green.

### **5.3 Landing Zone (LZ) Reconnaissance Procedures**

Landing at unmapped off-field scene locations requires a structured two-stage reconnaissance procedure:  
                     `STAGE 1: HIGH RECONNAISSANCE (500 ft AGL / 60-80 kts) [9]`  
                     `├─ Evaluate 5 S's: Size, Shape, Surrounds, Slope, Surface [9]`  
                     `├─ Identify wind direction, wires, hazards, and escape routes [6, 9]`  
                     `└─ Complete LZ Safety Crew Briefing [1]`  
                                        `│`  
                                        `▼`  
                     `STAGE 2: LOW RECONNAISSANCE (200 ft AGL / 40 kts) [9]`  
                     `├─ Verify specific touchdown spot free of debris (FOD) [9]`  
                     `├─ Final check for power lines, antennas, and slope severity [6, 9]`  
                     `└─ Select final approach angle and commit point [9]`

#### **Mandatory LZ Crew Briefing Format:**

> * **PF:** *"Executing High Recce. LZ size looks adequate, wind is from the west at 8 knots. Main threat is power lines running along the north road. Approach will be from the east, termination to a 5-foot hover over the baseball diamond. Escape path is a straight-ahead climb to the west. PM, confirm LZ clear."*  
> * **PM:** *"LZ clear north and east. Power lines identified. Clear to proceed to Low Recce."*

### **5.4 Hot-Loading Operations**

When clinical urgency demands a "Hot Load" (loading the patient while engines/rotors are actively turning):

> 1. **Rotor Control:** Pilot Flying must keep hands on flight controls at all times; collective locked down, friction applied.  
> 2. **Approach Vector:** Ground crew and V-Medics must approach the helicopter ONLY within the forward 45^\\circ field of view of the pilot. **NEVER** approach from the rear or pass behind the tail rotor.  
> 3. **Security Check:** Confirm all litter latches, medical equipment, cables, and doors are secured before signaling for liftoff.

## **6\. Simulated Emergency & Network Contingency Procedures**

### **6.1 Aviation Emergency Execution Rules**

In-flight emergencies during simulation must be managed according to standard aviation priorities: **AVIATE, NAVIGATE, COMMUNICATE**.  
`+-----------------------------------------------------------------------------------+`  
`|                        CRITICAL EMERGENCY PROCEDURES                              |`  
`+----------------------+------------------------------------------------------------+`  
`| Failure Event        | Immediate Action Sequence                                  |`  
`+----------------------+------------------------------------------------------------+`  
`| Engine Failure       | 1. Lower collective immediately to maintain rotor RPM [9]. |`  
`| (Single-Engine / OEI)| 2. Adjust cyclic to maintain autorotation air speed [9].   |`  
`|                      | 3. Select landing spot into wind; flare at 40 ft AGL [9].  |`  
`+----------------------+------------------------------------------------------------+`  
`| Inadvertent IMC      | 1. Announce "INADVERTENT IMC - EXECUTING RECOVERY" [1].    |`  
`| (IIMC Entry)         | 2. Levelling cyclic, apply climb power (Level wings) [1].  |`  
`|                      | 3. Climb to minimum vectoring altitude / safe IFR altitude |`  
`|                      | 4. Engage Autopilot ATT/ALT Mode; contact ATC [1, 28].     |`  
`+----------------------+------------------------------------------------------------+`  
`| Loss of Tail Rotor   | 1. Maintain forward airspeed (> 60 kts) to preserve        |`  
`| Effectiveness (LTE)  |    vertical fin directional stability [9].                 |`  
`|                      | 2. Apply forward cyclic and reduce collective if able [9]. |`  
`|                      | 3. Perform running landing at safe airfield [9].           |`  
`+----------------------+------------------------------------------------------------+`

### **6.2 Network & Simulator Technical Contingencies**

> * **Simulator Crash / Crash to Desktop (CTD):**  
  1. Immediately inform the V-Medic crew / network ATC via text interface or Discord if feasible.  
  2. File a VIRS report within 24 hours detailing the exact sim time, location, aircraft state, and crash error code.  
  3. If CTD occurs with a critical patient aboard, the flight may be re-spawned at the last verified way-point only if authorized by the Safety Lead; otherwise, the sortie is logged as "Incomplete \- Technical Failure".  
> * **Communications Failure Procedure:**  
  1. In the event of total voice connection failure with virtual ATC or HEMS Dispatch, attempt contact via backup frequencies or text channels.  
  2. If unresolvable, squawk **7600** on virtual transponder.  
  3. Proceed under standard IFR route or VFR terrain clearance to the intended destination hospital or base helipad.  
  4. Log a formal Radio Failure Report within 24 hours per protocol.

## **7\. Medical Patient Assessment & Triage Integration**

### **7.1 Primary & Secondary Clinical Survey Protocols**

V-Medics must follow the standardized survey sequence during scene interventions, entering clinical updates into the HEMS Mission Dispatcher:  
                                `PRIMARY SURVEY (Immediate Life Threats) [3]`  
                                `├─ 1. Airway / Cervical Spine Stabilization [3]`  
                                `├─ 2. Breathing / Ventilation Check [3]`  
                                `├─ 3. Circulation / Hemorrhage Control [3]`  
                                `├─ 4. Major Bleeding Management [3]`  
                                `├─ 5. Neurological Assessment (GCS) & Shock Check [3]`  
                                `└─ 6. Chief Complaint Identification [3]`  
                                                   `│`  
                                                   `▼`  
                                `SECONDARY SURVEY (Detailed Clinical Scan) [3]`  
                                `├─ Head-to-toe physical examination [3]`  
                                `├─ Baseline Vital Signs (BP, HR, SpO2, RR) [3]`  
                                `└─ History of present illness / Mechanism of Injury [3]`

### **7.2 Glasgow Coma Scale (GCS) Assessment Matrix**

The GCS score dictates patient priority and trauma center destination requirements:  
`+-----------------------------------------------------------------------------------+`  
`|                            GLASGOW COMA SCALE (GCS) MATRIX                        |`  
`+-------------------------+-------------------------+-------------------------------+`  
`| Eye Opening (1-4)       | Verbal Response (1-5)   | Motor Response (1-6)          |`  
`+-------------------------+-------------------------+-------------------------------+`  
`| 4 = Spontaneous         | 5 = Oriented            | 6 = Obeys commands            |`  
`| 3 = To verbal command   | 4 = Confused conversation| 5 = Localizes pain            |`  
`| 2 = To painful stimulus | 3 = Inappropriate words | 4 = Withdraws from pain       |`  
`| 1 = No response         | 2 = Incomprehensible    | 3 = Abnormal flexion (Decort) |`  
`|                         | 1 = No response         | 2 = Extension (Decerebrate)   |`  
`|                         |                         | 1 = No response               |`  
`+-------------------------+-------------------------+-------------------------------+`

> * **GCS Total \<= 8:** Severe Brain Injury. Mandates immediate airway protection (RSI/Intubation) and direct transport to Level 1 Trauma Center.  
> * **GCS Total 9–12:** Moderate Injury.  
> * **GCS Total 13–15:** Minor Injury.

### **7.3 Mass Casualty Incident (MCI) START Triage System**

In multi-patient scene calls, crews apply the **Simple Triage and Rapid Treatment (START)** protocol:  
                                        `[ ALL CASUALTIES ]`  
                                                `│`  
                                                `▼`  
                                    `Can the patient walk?`  
                                    `├─ YES ──► [ GREEN: MINOR ] [1]`  
                                    `└─ NO  ──► Check Respirations [1]`  
                                                `│`  
                          `┌─────────────────────┴─────────────────────┐`  
                          `▼                                           ▼`  
                 `Respirations Present?                     Respirations > 30/min?`  
                 `├─ NO  ──► Position Airway                ├─ YES ──► [ RED: IMMEDIATE ] [1]`  
                 `│          ├─ Breathing? ──► RED          └─ NO  ──► Check Perfusion / Pulse [1]`  
                 `│          └─ No? ─────────► [ BLACK ]                │`  
                 `└─ YES ──► Check Rate                                 ▼`  
                                                            `Radial Pulse Absent or Cap Refill > 2s?`  
                                                            `├─ YES ──► [ RED: IMMEDIATE ] [1]`  
                                                            `└─ NO  ──► Check Mental Status [1]`  
                                                                        `├─ Cannot Follow Commands ──► [ RED ] [1]`  
                                                                        `└─ Follows Commands ────────► [ YELLOW: DELAYED ] [1]`

## **8\. Training Academy & Recurrent Qualification Pipeline**

### **8.1 Training Pipeline Overview**

To maintain high operational standards, all pilots progress through a structured, 4-tier qualification framework:  
`+------------------------------------------------------------------------------------------------------+`  
`|                           TRAINING ACADEMY PROGRESSION PIPELINE                                      |`  
`+--------------------+--------------+----------------------------+-----------------+-------------------+`  
`| Rank Designation   | Min Flight   | Required Certifications    | Certified Fleet | Mandatory Training|`  
`|                    | Hours        |                            | Access          | Modules           |`  
`+--------------------+--------------+----------------------------+-----------------+-------------------+`  
`| HEMS Trainee (HT)  | 0 - 25 hrs   | Theoretical Entrance Exam  | Ground / Sim    | CRM Fundamentals, |`  
`|                    | [1]          | (VHOP-01 / RTF) [1]        | Trainers Only   | LZ Safety Ops [1] |`  
`+--------------------+--------------+----------------------------+-----------------+-------------------+`  
`| HEMS Officer (HO)  | 25 - 150 hrs | Practical VFR Checkride;   | Single-Engine   | ORM Matrix, GCS & |`  
`|                    | [1]          | Basic Clinical Endorsement | HEMS (B407) [1] | Trauma Assessment |`  
`+--------------------+--------------+----------------------------+-----------------+-------------------+`  
`| HEMS Captain (HC)  | 150 - 300 hrs| Practical IFR/NVG Checkride| Multi-Engine    | Advanced Decision |`  
`|                    | [1]          | Advanced Trauma (TPATC Sim)| H135 / EC145    | Making, IIMC Rec  |`  
`+--------------------+--------------+----------------------------+-----------------+-------------------+`  
`| HEMS Instructor    | 300+ hrs     | Instructor Board Evaluation| All Platforms   | VIRS Analysis,    |`  
`| (HI)               | [1]          | Safety SME Endorsement [1] | & Checkflights  | Scenario Design   |`  
`+--------------------+--------------+----------------------------+-----------------+-------------------+`

### **8.2 Recurrent Evaluation Mandate**

Every **120 days**, all active Virtual HEMS pilots must complete a Recurrent Proficiency Evaluation. This check includes:

> 1. **3-Axis Instrument Flight Evaluation:** ILS/RNAV approaches to published minimums.  
> 2. **Inadvertent IMC Recovery Simulation:** Unannounced entry into IMC during low-level visual flight.  
> 3. **Emergency Autorotation Entry & Flare:** Execution of power-off glide and touchdown/cushion maneuvering in the simulator.  
> 4. **Night Vision Goggle (NVG) Off-Field Reconnaissance & Landing:** Operation into an unlit scene LZ.

Failure to complete the 120-day recurrent check results in automatic suspension of operational flight privileges until a successful checkride is logged.

## **Document Control & Sign-Off**

**Authored By:** Lead Operations Specialist & Safety Lead, Virtual HEMS **Approved By:** Executive Director, Virtual HEMS Operational Council **Repository Distribution:** Document synced with virtualhems.com Core Operations Module