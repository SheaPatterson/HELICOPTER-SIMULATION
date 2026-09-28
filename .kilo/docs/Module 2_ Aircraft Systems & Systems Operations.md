# **Module 2: Aircraft Systems & Systems Operations**

**Document Designation:** VHOP-02-SYS **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** High-Fidelity Technical Systems, Cockpit Avionics, Flight Control Logic, and Operational Checklists for EC135, EC145, and H135 Airframes

## **2.1 Technical Profile: Eurocopter EC135 (P2+ / T2+)**

### **2.1.1 Structural & Airframe Specifications**

The Eurocopter EC135 is a light twin-engine multipurpose helicopter utilizing a hingeless, four-bladed main rotor head composed of fiber-composite materials and a shrouded Fenestron anti-torque system. The structural airframe incorporates anti-resonance isolation systems to dampen main rotor vibrations, delivering reduced external acoustic signatures and low cabin vibration levels.  
`+-----------------------------------------------------------------------------------+`  
`|                        EC135 P2+ / T2+ DIMENSIONAL SCHEMATIC                      |`  
`+-----------------------------------------------------------------------------------+`  
`|  Main Rotor Diameter: 10.20 m (33 ft 6 in) [1]                                    |`  
`|  Tail Rotor Type: Fenestron Shrouded Fan (10 asymmetric blades) [1, 5]            |`  
`|  Overall Length (Rotors Turning): 12.16 m (39 ft 11 in)                           |`  
`|  Fuselage Length: 10.20 m (33 ft 6 in) [1]                                        |`  
`|  Overall Height: 3.51 m (11 ft 6 in) [1]                                          |`  
`|  Skid Width (Standard Gear): 2.00 m (6 ft 7 in)                                   |`  
`+-----------------------------------------------------------------------------------+`

#### **Weight & Loading Envelope (EC135 P2+ / T2+ Standard):**

> * **Maximum Takeoff Weight (MTOW):** 2,910\\text{ kg} (6,415\\text{ lbs}).  
> * **Alternate Gross Weight (AGW / Cat A Envelope):** 2,950\\text{ kg} (6,504\\text{ lbs}).  
> * **Baseline Empty Weight (HEMS Configuration):** 1,455\\text{ kg} (3,208\\text{ lbs}).  
> * **Maximum Useful Payload:** 1,455\\text{ kg} (3,208\\text{ lbs}).  
> * **Floor Loading Limit (Cabin):** 600\\text{ kg/m}^2 (123\\text{ lbs/ft}^2).

                      `EC135 CENTER OF GRAVITY (CG) ENVELOPE`  
    `Weight (kg)`  
      `2950 ─────────────────────────────┐ (AGW Limit) [1]`  
      `2910 ───────────────────────────┐ │ (Standard MTOW) [1]`  
           `│                          │ │`  
      `2500 │    PERMISSIBLE C.G.      │ │`  
           `│        REGION            │ │`  
      `2000 │                          │ │`  
           `└──────────────────────────┴─┘`  
         `3.05m                       3.25m    Station (m aft of datum)`

### **2.1.2 Powerplant Configuration & FADEC Logic**

The EC135 airframe supports two primary engine integration models:

> 1. **Pratt & Whitney Canada PW206B2 (P2+ Variant):** Rated at 463\\text{ kW} (621\\text{ shp}) Takeoff Power (TOP) per engine.  
> 2. **Safran Turbomeca Arrius 2B2 (T2+ Variant):** Rated at 452\\text{ kW} (606\\text{ shp}) TOP per engine.

`+-----------------------------------------------------------------------------------+`  
`|                        POWERPLANT RATINGS & TORQUE LIMITS                         |`  
`+--------------------------+------------------------+-------------------------------+`  
`| Rating Regime            | PW206B2 Torque Limit   | Arrius 2B2 Torque Limit       |`  
`+--------------------------+------------------------+-------------------------------+`  
`| All Engines Operative    | $2 \times 69\%$        | $2 \times 68\%$               |`  
`| Continuous (AEO Max)     |                        |                               |`  
`+--------------------------+------------------------+-------------------------------+`  
`| Takeoff Power (TOP)      | $2 \times 78\%$        | $2 \times 78\%$               |`  
`| (5-Minute Limit)         |                        |                               |`  
`+--------------------------+------------------------+-------------------------------+`  
`| One Engine Inoperative   | $128\%$                | $128\%$                       |`  
`| (OEI 2-Minute Limit)     |                        |                               |`  
`+--------------------------+------------------------+-------------------------------+`  
`| OEI Continuous Limit     | $89.5\%$               | $89.5\%$                      |`  
`+--------------------------+------------------------+-------------------------------+`

#### **Dual-Channel Full Authority Digital Engine Control (FADEC):**

Each powerplant is controlled by an independent dual-channel FADEC unit. The FADEC manages fuel metering, automatic blade acceleration profiling, turbine temperature (TOT/N\_4) supervision, and main rotor speed governor matching (100\\%\\ N\_2/N\_R in standard flight mode; adjusted automatically up to 104\\%\\ N\_R during high-power or HI N\_R noise-optimization modes).  
                          `FADEC DUAL-CHANNEL CONTROL ARCHITECTURE`  
                            
     `Engine Sensors ──► [ Channel A (Active) ] ───┐`  
      `(N1, N2, TOT,     [ Channel B (Standby)] ───┼─► Metering Valve ──► Combustion`  
       `P3 Air, Oil)     [ Automatic Failover ] ───┘   Actuator          Chamber`

## **2.2 Technical Profile: Eurocopter EC145 & Airbus H135**

### **2.2.1 Airframe Expansion & Payload Capabilities**

The EC145 (BK117 C-2) and the five-bladed H135 (EC135 T3/P3 / Helionix line) represent scaled operational platforms tailored for expanded clinical interior capacities. The EC145 combines the forward cockpit design of the EC135 with the enlarged cabin and rear clamshell doors of the BK117 series.  
`+-----------------------------------------------------------------------------------+`  
`|                        AIRFRAME COMPARATIVE SPECIFICATIONS                        |`  
`+----------------------------+-----------------------+------------------------------+`  
`| Parameter                  | Eurocopter EC145      | Airbus H135 (5-Blade D-3)    |`  
`+----------------------------+-----------------------+------------------------------+`  
`| Main Rotor Diameter        | 11.00 m (36 ft 1 in)  | 10.20 m (33 ft 6 in)         |`  
`| Main Rotor Blade Count     | 4 Blades (Standard)   | 5 Blades (Bearingless) [2]   |`  
`| Anti-Torque System         | Tail Rotor / Fenestron| Fenestron Shrouded Fan [1, 2]|`  
`| Cabin Internal Volume      | $6.03\text{ m}^3$ [2]  | $4.80\text{ m}^3$            |`  
`| Max Takeoff Weight (MTOW)  | $3,800\text{ kg}$ [2] | $2,980\text{ kg}$ [1]        |`  
`| Standard Useful Payload    | $1,905\text{ kg}$ [2] | $1,505\text{ kg}$ [1]        |`  
`+----------------------------+-----------------------+------------------------------+`

                          `EC145 REAR CLAMSHELL LOADING ACCESS`  
                            
              `┌─────────────────────────────────────────────────┐`  
              `│                FUSILAGE CABIN                   │`  
              `│   [Nurse]    [Paramedic]     [Primary Stretcher]│`  
              `└───────────────┬─────────────────┬───────────────┘`  
                              `│                 │`  
                      `┌───────┴─────────────────┴───────┐`  
                      `│ Rear Opening Clamshell Doors    │`  
                      `│ (Unobstructed Straight Loading) │`  
                      `└─────────────────────────────────┘`

### **2.2.2 Avionics Integration: MEGHAS vs. Helionix Suite**

> * **MEGHAS Flight Control Display System (EC145 Standard):** Employs high-resolution active-matrix liquid crystal displays (AMLCD) driven by dual Smart Multifunction Displays (SMD45). Engine parameters are monitored via a Vehicle and Engine Management Display (VEMD) integrated with a First Limit Indicator (FLI).  
> * **Helionix Avionics Suite (H135 / H145):** A fully integrated multi-display architecture featuring three interchangeable displays linked to dual Automatic Flight Control Systems (AFCS) with integrated flight management systems (FMS), terrain awareness warning systems (HTAWS), and synthetic vision.

`+-----------------------------------------------------------------------------------+`  
`|                     AVIONICS SUITE ARCHITECTURE COMPARISON                        |`  
`+-------------------+--------------------------------+------------------------------+`  
`| Subsystem         | MEGHAS (EC135 / EC145)         | Helionix (H135 / H145)      |`  
`+-------------------+--------------------------------+------------------------------+`  
`| Primary Display   | Dual SMD45 LCD Screens [1]     | 3x Interchangeable Displays |`  
`| Engine Instrument | VEMD + First Limit Indicator [1]| Integrated Engine Page      |`  
`| Flight Controls   | 3-Axis / 4-Axis AFCS [1]       | Dual 4-Axis Autopilot [1, 7] |`  
`| Navigation Engine | Dual Garmin GNS430/GTN650      | Dual FMS + HTAWS + SVS [2, 7]|`  
`+-------------------+--------------------------------+------------------------------+`

## **2.3 Cockpit Avionics & Systems Architecture**

`+-----------------------------------------------------------------------------------+`  
`|                        COCKPIT INSTRUMENTATION LAYOUT                             |`  
`+-----------------------------------------------------------------------------------+`  
`|   [ SMD45 / PFD ]    [ Central Panel Display System ]    [ SMD45 / ND ]           |`  
`|  (Airspeed, Att,     ┌──────────────────────────────┐   (Navigation Map,          |`  
`|   Alt, VSI, HDG)     │ VEMD Top Screen (FLI Engine) │    Radar, Traffic)          |`  
`|                      ├──────────────────────────────┤                             |`  
`|   [ HELLAS RADAR ]   │ CAD Bottom Screen (Fuel/Sys) │   [ AUTOPILOT PANEL ]       |`  
`|   (Obstacle Mon) [5] └──────────────────────────────┘   (AFCS Control Mode) [5]   |`  
`+-----------------------------------------------------------------------------------+`

### **2.3.1 Central Panel Display System (CPDS)**

The CPDS consists of two integrated flat-panel liquid crystal units positioned centrally on the main panel:

> 1. **Vehicle and Engine Management Display (VEMD \- Top Screen):**  
   * **First Limit Indicator (FLI):** Consolidates three main engine parameters into a single scale needle indicator: N\_1 (Gas Generator Speed), TOT (Turbine Outlet Temperature), and TRQ (Torque).  
   * The needle indicates the parameter closest to its maximum thermal or mechanical limit, eliminating the need to monitor separate gauges during critical flight phases.

                          `FIRST LIMIT INDICATOR (FLI) SCALE`  
                            
              `FLI Scale Value`  
                  `11.5  ├──────── Redline (OEI 2-Min Limit / 128%) [1]`  
                  `10.0  ├──────── Yellow / Red Boundary (Takeoff Limit / 5-Min) [1]`  
                   `8.5  ├──────── Green Arc Upper Bound (Continuous AEO Limit) [1]`  
                        `│   ▲`  
                   `5.0  │  ─┼─  FLI Pointer (Displays Highest Limit Engine Load) [1]`  
                        `│   │`  
                   `0.0  └─────── Baseline`

> 1. **Caution and Advisory Display (CAD \- Bottom Screen):**  
   * Monitors fuel levels, system supply pressures, electrical bus voltages, generator outputs, and real-time caution messages.  
   * Displays real-time fuel quantity calculations, differential fuel burn values, and estimated remaining endurance.

### **2.3.2 Electronic Flight Bag (EFB) & Telemetry Bridge**

The cockpit configuration integrates digital Electronic Flight Bag (EFB) terminals linked via low-latency telemetry protocol to the **HEMS OPS-CENTER** platform.  
`+-----------------------------------------------------------------------------------+`  
`|                         TELEMETRY & EFB DATA INTEGRATION                          |`  
`+--------------------------+--------------------------------------------------------+`  
`| Telemetry Parameter      | Destination Subsystem & Function                       |`  
`+--------------------------+--------------------------------------------------------+`  
`| Altitude, Position, HDG  | SimConnect / Lua Bridge ──► Real-Time Map Tracking     |`  
`| Fuel Quantity & Burn     | CAD Screen ──► Mission Range & Endurance Calculation   |`  
`| Engine Torque & ROT      | CPDS VEMD ──► Automated Post-Flight Maintenance Log    |`  
`| Clinical Patient State   | Medical EFB Terminal ──► Patient Condition Algorithm   |`  
`+--------------------------+--------------------------------------------------------+`

## **2.4 Automatic Flight Control Systems (AFCS), SAS & Beep Trim Mechanics**

### **2.4.1 System Architecture & Control Loops**

The AFCS manages aircraft stability and automated trajectory guidance. It combines a high-rate inner loop (Stability Augmentation System \- SAS) with an outer-loop control system (Attitude Hold and Navigation Coupling).  
                          `AFCS DUAL-LOOP CONTROL SYSTEM`  
                            
     `Pilot Inceptors  ───► [ Force Trim / Spring Retainers ]`  
                                    `│`  
                                    `▼`  
     `Aircraft Gyros   ───► [ Inner Loop (SAS Solenoids) ]   ──► High-Speed / Low-Authority`  
     `& Air Data            (Rate Damping - Pitch/Roll/Yaw)      Control Surface Actuation`  
                                    `│`  
                                    `▼`  
     `Navigation / AP  ───► [ Outer Loop (Parallel Drives) ] ──► Low-Speed / Full-Authority`  
     `Mode Commands         (Attitude Hold / ALT / HDG / NAV)    Stick Positioning Actuation`

> * **Stability Augmentation System (SAS \- Inner Loop):** Operates fast-acting electro-hydraulic actuators with limited authority (\\pm 10\\%-15\\% control range). It damps aerodynamic disturbances and rate errors without moving the cockpit controls, providing artificial pitch, roll, and yaw damping.  
> * **Autopilot Outer Loop:** Operates full-authority parallel trim actuators that move the cyclic, collective, and anti-torque pedals to maintain selected flight parameters (e.g., ATT, ALT, HDG, IAS, VS, NAV, GA).

### **2.4.2 Force Trim & Trim Release Mechanisms**

> 1. **Force Trim System:** Uses magnetic brakes and spring feel units to provide artificial stick resistance and establish a mechanical trim reference position.  
> 2. **Trim Release Switch (TRIM REL):** Located on the pilot's cyclic grip. Pressing and holding TRIM REL disengages the magnetic brakes, allowing the pilot to reposition the cyclic freely without spring gradient resistance. Releasing the button resets the magnetic reference point to the current stick location, holding the new pitch/roll attitude.

                          `TRIM RELEASE OPERATIONAL SEQUENCE`  
                            
     `[ Press TRIM REL ]  ──► Brakes Disengage  ──► Reposition Cyclic Manually [5]`  
                                                          `│`  
     `[ Hold Desired ATT] ──► Release Button    ──► Brakes Engage at New Position [5]`

### **2.4.3 Beep Trim Switches & Multi-Axis Trim Mechanics**

The four-way BEEP TRIM switch on the cyclic allows fine adjustment of the autopilot reference attitude:  
`+-----------------------------------------------------------------------------------+`  
`|                           BEEP TRIM SWITCH FUNCTIONS                              |`  
`+------------------+------------------------------+---------------------------------+`  
`| Direction        | Uncoupled Mode Action        | Coupled Autopilot Mode Action   |`  
`+------------------+------------------------------+---------------------------------+`  
`| Forward / Aft    | Adjusts Pitch Attitude       | Adjusts Airspeed ($IAS \pm 1\text{ kt/sec}$) |`  
`|                  | ($1.5^\circ/\text{sec}$) [5] | or Vertical Speed ($VS$)        |`  
`| Left / Right     | Adjusts Roll Attitude        | Adjusts Heading ($HDG \pm 1^\circ/\text{sec}$)|`  
`|                  | ($3.0^\circ/\text{sec}$) [5] | or Navigation Track             |`  
`+------------------+------------------------------+---------------------------------+`

## **2.5 Standard Operating Procedures (SOPs) & Systems Checklists**

### **2.5.1 Cold & Dark Pre-Start Inspection**

`PRE-FLIGHT COLD & DARK CHECKLIST`  
`1. Circuit Breakers (Overhead/Console) .............. CHECK ALL IN`  
`2. Battery Master Switch ........................... ON (Min 24.0 VDC)`  
`3. Rotor Brake Lever ............................... CHECK OFF / LATCHED`  
`4. Engine Control Levers (ECL 1 & 2) ................ OFF / SAFETY LATCHED`  
`5. Fuel Prime Pumps (System 1 & 2) .................. ON (Check Pressure Lights)`  
`6. CPDS / VEMD Initialization ....................... VERIFY NO SYSTEM ERRORS`  
`7. Flight Controls & Collective Lock ................ UNLOCKED / FREE & CORRECT`

### **2.5.2 Engine Startup Procedure (Automated FADEC)**

`ENGINE STARTUP CHECKLIST (ENGINE 1 FIRST)`  
`1. Fuel Main Switches (Sys 1 & 2) .................. ON`  
`2. Anti-Collision Light ............................. ON`  
`3. Engine 1 Engine Control Switch (ENG 1) .......... SWITCH FROM OFF TO IDLE`  
   `- Monitor N1 Acceleration (Min 10% within 5 seconds)`  
   `- Monitor TOT (Max 780°C transient ignition limit)`  
   `- Monitor Oil Pressure rising`  
`4. Engine 1 Main Generator ......................... ON (Verify BUS 1 Voltage nominal)`  
`5. Engine 2 Engine Control Switch (ENG 2) .......... SWITCH FROM OFF TO IDLE`  
   `- Repeat N1, TOT, and Oil Pressure checks`  
`6. Engine 2 Main Generator ......................... ON`  
`7. Both Engine Control Switches .................... SWITCH TO FLIGHT POSITION`  
   `- Rotor RPM (NR) accelerates to 100% nominal`  
   `- VEMD displays green arc on all parameters`

### **2.5.3 Pre-Takeoff System & Hover Checks**

`PRE-TAKEOFF / HOVER CHECKLIST`  
`1. Avionics & Navigation Suite ...................... SET / FREQUENCIES LOADED`  
`2. AFCS / SAS Switches (Pitch, Roll, Yaw) ......... ON / VERIFY NO WARNINGS`  
`3. Caution & Advisory Display (CAD) ................ CLEAR / GREEN LIGHTS ONLY`  
`4. Fuel Quantity & Balance ......................... CHECK EQUAL / SUFFICIENT`  
`5. Execute Hover Taxi (5 ft AGL) ................... PERFORM HOVER POWER CHECK`  
   `- Verify actual FLI torque against calculated HOGE limits`  
   `- Check control response in Cyclic, Collective, Pedals`  
   `- Verify Hydraulic Systems 1 & 2 pressures in green arc`

### **2.5.4 Emergency Procedure: Single Engine Failure (OEI)**

`SINGLE ENGINE FAILURE (OEI) IN-FLIGHT PROCEDURE`  
`1. Rotor RPM (NR) .................................. MAINTAIN WITH COLLECTIVE (Min 96%)`  
`2. Airspeed (IAS) .................................. ADJUST TO Vy (65 KTS)`  
`3. Affected Engine (VEMD indication) .............. IDENTIFY (Check low N1 / TOT)`  
`4. Failed Engine Control Switch ..................... OFF`  
`5. Single Engine Emergency Power (OEI Limit) ........ MONITOR ON FLI (128% TRQ Max)`  
`6. Fuel Crossfeed / Prime Pumps ..................... AS REQUIRED`  
`7. Flight Path ..................................... CLIMB / LAND AT NEAREST SUITABLE`

### **2.5.5 Emergency Procedure: Inadvertent IMC Recovery**

`INADVERTENT IMC (IIMC) RECOVERY CHECKLIST`  
`1. Wings & Attitude Indicator ....................... LEVEL WINGS IMMEDIATELY`  
`2. Power / Collective .............................. APPLY CLIMB POWER (Vy = 65 kts)`  
`3. Heading / Course ................................ MAINTAIN KNOWN SAFE HEADING`  
`4. AFCS Modes .................───────────────────── ENGAGE ALT / HDG / ATT HOLD`  
`5. Transponder .................──────────────────── SQUAWK 7700 / COMMUNICATE ATC`

## **Document Control & Operational Compliance**

**Authored By:** Chief Systems Engineer & Flight Simulation Systems Lead, Virtual HEMS **Approved By:** Executive Director, Virtual HEMS Technical Operations Council **Repository Distribution:** Document synced with virtualhems.com Core Technical Index