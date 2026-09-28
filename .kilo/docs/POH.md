# **VIRTUAL HEMS: OPERATIONAL MANUAL & PILOT GUIDE**

**System Version:** 5.3.0-STABLE **Platform:** VirtualHEMS.com

## **PART I: PLATFORM ARCHITECTURE & INTERFACE**

### **1.1 HEMS Ops Operations Center**

Virtual HEMS is not a simple data entry form; it is an integrated **Regional Surveillance and Flight Coordination Terminal**. The platform uses a "Tactical Integration Hub" to bridge your flight simulator (X-Plane) with the web application in real-time.

* **Operations Command:** The central dashboard provides a live view of the theater.  
  * **Service Record:** Tracks your "Active Designation" (e.g., Junior First Officer), total dispatches, and flight hours. It visually displays progress toward the next rank.  
  * **Regional Weather Ops:** Real-time METAR/TAF parsing for key sectors including **Allegheny**, **Mon Valley**, and **Erie/Shore**. It categorizes conditions as VFR, MVFR, or LIFR (Low Instrument Flight Rules) to assist with Go/No-Go decisions.  
  * **Asset Readiness:** Monitors the status of the Fleet (FMC \- Fully Mission Capable) and the availability of **106 Medical Nodes/Trauma Hubs**.

### **1.2 Tactical Integration & Connectivity**

To enable "Live Theater" capabilities, pilots must install the data link.

* **The Uplink Script:** For X-Plane users, a Lua script (`hems-dispatch-xp.lua`) must be installed in the `FlyWithLua/Scripts`folder. This pipe reads aircraft position and telemetry.  
* **Authentication:** The system generates a unique **Secure API Key** which authenticates your simulator connection to the HEMS Ops server.  
* **Telemetry:** Once connected, the **COMSAT\_UPLINK** module in the dashboard will display signal status (Nominal) and facilitate automated ETA calculations and fuel state tracking.

---

## **PART II: OPERATIONAL THEATER (WESTERN PA)**

The simulation environment covers Western Pennsylvania, Eastern Ohio, Northern West Virginia, and Maryland. The visual assets (scenery) are critical for X-Plane users to identify landing zones.

### **2.1 Regional Fleet & Base Structure**

The platform simulates two primary real-world operators.

#### **A. STAT MedEvac**

A service of the Center for Emergency Medicine of Western Pennsylvania.

* **Fleet:** Primarily **Airbus H135** (EC135 T2+) and **H145** (EC145 C-2).  
* **Hub:** The base of operations is **Allegheny County Airport (KAGC)**.  
* **Key Bases (Examples from Platform Registry):**  
  * **Stat 6:** Clarion County Airport (KAXQ) \- *H135*.  
  * **Stat 4:** UPMC Children's Hospital (Rooftop) \- *H135*.  
  * **Stat 11:** UPMC Altoona (Rooftop) \- *H135*.  
  * **Stat 18 (SkyBear):** Children's National Hospital, DC \- *H145*.

#### **B. AHN LifeFlight**

Operated by Metro Aviation, Inc., serving the Allegheny Health Network.

* **Fleet:** Utilizes **EC145** and **EC135** airframes.  
* **Key Bases:**  
  * **LifeFlight 1:** Canonsburg Hospital (PA67).  
  * **LifeFlight 2:** Clarion Hospital (91PA).  
  * **LifeFlight 4:** Butler Airport (KBTP).

### **2.2 Hospital Landing Zones (LZ)**

The platform tracks **106 verified medical nodes**. Pilots must be familiar with the physical constraints of these facilities:

* **Rooftop Pads:**  
  * **UPMC Presbyterian (PS78):** 96' x 48' Concrete Rooftop (Elev. 1124 MSL).  
  * **Allegheny General (42PN):** 65' x 65' Concrete Rooftop (Elev. 804 MSL).  
* **Ground Pads:**  
  * **Penn Highlands DuBois (PA10):** 32' x 32' Concrete Ground Pad (Tight maneuvering area).  
  * **Clarion Hospital (91PA):** 50' x 50' Concrete Ground Pad.

---

## **PART III: STANDARD OPERATING PROCEDURES (SOP)**

### **3.1 Mission Dispatch & Planning**

Pilots utilize the **Mission Dispatch Planner** to generate sorties. The workflow consists of four phases:

1. **Details:** Select Mission Profile (**Scene Call** or **Transfer**) and Dispatch Base. The system auto-populates current weather (METAR).  
2. **Crew:** Assign a roster. Standard HEMS configuration is **Pilot**, **Flight Nurse**, and **Flight Paramedic**.  
3. **Patient Info:** The system (or AI Tactical Briefing) generates clinical data, including Age, Weight, Clinical Summary (e.g., "MVA, Crushed Leg"), and Stabilizing Interventions (e.g., "IV Started, Fentanyl for pain").  
4. **Flight Plan:** The system calculates the "Operational Circuit," displaying Total Distance, Estimated Fuel Burn (lbs), and Reserve Margin. **Pilots must confirm flight metrics meet safety thresholds before initializing dispatch**.

### **3.2 Tactical Communications**

* **Radio Logic:** The **Regional Tactical Frequency** panel allows pilots to broadcast status updates.  
* **Protocol:** Standard calls include "Departing Scene," "En Route," "At Scene," and "Starting Engines".  
* **Voice Comms:** The app supports "Push to Talk" functionality for simulated radio traffic.

### **3.3 HEMS Flight Logging**

Post-flight logging is mandatory for the **Mission Archive**. Data points required include:

* **Timestamps:** Dispatch, Enroute, On Scene, Transporting, Arrival.  
* **Fuel State:** Fuel on Board (FOB) at departure and arrival (in lbs).  
* **Medical Status:** Condition codes (e.g., "Critical Condition with Unstable Vital Signs") and whether a **Hot-Load**(rotors turning) was required.

---

## **PART IV: PILOT OPERATING HANDBOOK (POH)**

### **4.1 Aircraft Systems: EC135 (H135)**

* **General:** A light twin-engine helicopter featuring a bearingless main rotor and Fenestron tail rotor for reduced noise and increased safety during ground ops.  
* **Avionics:** Simulates the **CPDS (Central Panel Display System)** consisting of the **CAD (Caution and Advisory Display)** and **VEMD (Vehicle and Engine Multifunction Display)**.  
* **Start-Up:** Ensure **PRIM PMP** (Prime Pumps) are ON before engine start, otherwise N1 may not exceed \~20%. Monitor the **FLI (First Limit Indicator)** for TOT/N1 limits during start.  
* **Limitations:**  
  * **VNE:** 155 KIAS (Sea Level).  
  * **Max Operating Altitude:** 20,000 ft.  
  * **Slope Landing:** Max 14°.  
  * **Rotor RPM:** Continuous operating range 97% \- 104%.

### **4.2 Aircraft Systems: EC145 (H145)**

* **General:** A larger twin-engine utility helicopter with rear clamshell doors, ideal for loading litters. Newer variants (H145) feature the Helionix avionics suite and a 4-axis autopilot.  
* **Performance:** Capable of Category A operations. High clearance of the main rotor boom allows for safer rear loading while rotors are turning (Hot-Loading).  
* **Capabilities:** Often equipped with Weather Radar and Night Vision Imaging Systems (NVIS) compatible lighting.

### **4.3 Emergency Procedures (Simulation Focus)**

* **Vortex Ring State (VRS):**  
  * *Causes:* High rate of descent (\>300 fpm) at low airspeed (\<30 kts) with power applied (e.g., steep approach to a confined scene).  
  * *Recovery:* Forward cyclic to gain airspeed, lower collective slightly to break the vortex.  
* **Unanticipated Yaw / LTE:**  
  * *Risk Areas:* High power settings (OGE Hover) with wind from critical azimuths (left/rear).  
  * *Recovery:* Apply full opposite pedal and gain forward airspeed immediately.  
* **Inadvertent IMC (IIMC):**  
  * *Procedure:* Level the wings, apply climb power, announce "Inadvertent IMC," and transition to instrument scan. Do not attempt to maneuver visually in fog.

### **4.4 Landing Zone (LZ) Operations**

* **Reconnaissance:** Conduct a High Recce (500ft AGL) to assess the **5 S's**: Size, Shape, Surrounds (Obstacles), Slope, and Surface.  
* **Power Check:** Perform a power check on approach to ensure sufficient margin for an Out of Ground Effect (OGE) hover if the LZ is confined.  
* **Lighting:** For night ops at hospital pads, simulate a "Call for Lights" procedure to activate pilot-controlled lighting \[User Prompt\].