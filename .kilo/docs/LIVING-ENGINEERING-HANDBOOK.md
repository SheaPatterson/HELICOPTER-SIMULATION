# **LIVING-ENGINEERING-HANDBOOK.md**

**Document Designation:** HBK-ENG-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Dynamic Engineering Reference, Mathematical Physics Foundations, Control Loop Mechanics, and Full-Stack Platform Architecture for virtualhems.com

## **1\. Executive Summary & Monorepo Architecture**

The Virtual HEMS platform (virtualhems.com) combines high-fidelity helicopter aerodynamics, real-time medical patient decay algorithms, and cloud-native dispatch logistics into a unified simulation ecosystem. It serves desktop simulators—specifically Microsoft Flight Simulator 2020/2024 and X-Plane 11/12—via cross-platform desktop bridge clients.  
\+---------------------------------------------------------------------------------------------------+  
|                        VIRTUAL HEMS FULL-STACK ARCHITECTURE                                       |  
\+---------------------------------------------------------------------------------------------------+  
|  \[MSFS 2020/2024 (SimConnect)\]  |  \[X-Plane 11/12 (FlyWithLua UDP)\]\[span\_7\](start\_span)\[span\_7\](end\_span)                          |  
\+---------------------------------+-----------------------------------------------------------------+  
                                  │  
                                  ▼  
\+---------------------------------------------------------------------------------------------------+  
|  apps/bridge-desktop/ (Tauri \+ Rust Local Listening Engine @ UDP 8080)\[span\_8\](start\_span)\[span\_8\](end\_span)                  |  
\+---------------------------------------------------------------------------------------------------+  
                                  │  
                                  ▼ (Encrypted WebSocket / Supabase Realtime)\[span\_9\](start\_span)\[span\_9\](end\_span)  
\+---------------------------------------------------------------------------------------------------+  
|  apps/web/ (Next.js 14+ App Router Client @ virtualhems.com)\[span\_10\](start\_span)\[span\_10\](end\_span)                            |  
|  ├── /command      \--\> Live Tactical Overwatch Map\[span\_11\](start\_span)\[span\_11\](end\_span)                                       |  
|  ├── /dispatcher   \--\> 4-Stage Mission Dispatch Planner\[span\_12\](start\_span)\[span\_12\](end\_span)                                  |  
|  ├── /efb          \--\> Cockpit Electronic Flight Bag & Clinical Engine\[span\_13\](start\_span)\[span\_13\](end\_span)                  |  
|  └── /api/dispatch \--\> Ironpine AI Tactical Dispatch & Briefing Route\[span\_14\](start\_span)\[span\_14\](end\_span)                    |  
\+---------------------------------------------------------------------------------------------------+  
|  packages/database/ \--\> PostgreSQL \+ PostGIS Spatial Engine & Seed Libraries\[span\_15\](start\_span)\[span\_15\](end\_span)            |  
\+---------------------------------------------------------------------------------------------------+

## **2\. Flight Dynamics & Aerodynamic Mechanics**

### **2.1 Helicopter Equations of Motion**

The non-linear rigid-body 6-Degrees-of-Freedom (6 DoF) translational and rotational equations of motion are expressed in the body-fixed reference frame:

\\begin{aligned} m \\left( \\dot{u} \+ q w \- r v \\right) &= X\_R \+ X\_f \+ X\_{tp} \+ X\_{fn} \- m g \\sin\\theta \\\\ m \\left( \\dot{v} \+ r u \- p w \\right) &= Y\_R \+ Y\_{TR} \+ Y\_f \+ Y\_{fn} \+ m g \\cos\\theta \\sin\\phi \\\\ m \\left( \\dot{w} \+ p v \- q u \\right) &= Z\_R \+ Z\_f \+ Z\_{tp} \+ m g \\cos\\theta \\cos\\phi \\\\ I\_{xx} \\dot{p} \- I\_{xz} \\dot{r} \+ (I\_{zz} \- I\_{yy}) q r \- I\_{xz} p q &= L\_R \+ L\_{TR} \+ L\_f \+ L\_{tp} \+ L\_{fn} \\\\ I\_{yy} \\dot{q} \+ (I\_{xx} \- I\_{zz}) p r \+ I\_{xz} (p^2 \- r^2) &= M\_R \+ M\_f \+ M\_{tp} \+ M\_{fn} \\\\ I\_{zz} \\dot{r} \- I\_{xz} \\dot{p} \+ (I\_{yy} \- I\_{xx}) p q \+ I\_{xz} q r &= N\_R \+ N\_{TR} \+ N\_f \+ N\_{fn} \\end{aligned}

### **2.2 First-Order Blade Flapping Dynamics**

Main rotor blade flapping response is modeled as a first-order dynamic system driven by cyclic pitch inputs (\\theta\_{1s}, \\theta\_{1c}) and angular rates (p, q):  
\\tau\_{flap} \\dot{\\beta}\_{1s} \+ \\beta\_{1s} \= \-\\theta\_{1c} \+ \\frac{p}{\\Omega} \- \\left( \\frac{16}{\\gamma \\Omega} \\right) q \\tau\_{flap} \\dot{\\beta}\_{1c} \+ \\beta\_{1c} \= \\theta\_{1s} \- \\frac{q}{\\Omega} \- \\left( \\frac{16}{\\gamma \\Omega} \\right) p  
Where:

> * \\gamma \= \\frac{\\rho c a R^4}{I\_\\beta} represents the Lock Number (aerodynamic vs. inertial blade forces).  
> * \\tau\_{flap} \= \\frac{16}{\\gamma \\Omega} is the rotor flapping time constant.  
> * \\beta\_{1s}, \\beta\_{1c} are the longitudinal and lateral first-harmonic flapping angles.

## **3\. Avionics, Flight Control & AFCS Architecture**

### **3.1 First Limit Indicator (FLI) Logic**

The Airbus H135 / Eurocopter EC135 features a Central Panel Display System (CPDS) incorporating a First Limit Indicator (FLI). The FLI consolidates three primary engine parameters into a single thermal/mechanical margin pointer:

> 1. **N\_1 / \\Delta N\_1:** Gas generator speeds.  
> 2. **TOT:** Turbine Outlet Temperature.  
> 3. **TRQ:** Engine Output Torque.

\+---------------------------------------------------------------------------------------------------+  
|                               FIRST LIMIT INDICATOR (FLI) STRUCTURE                               |  
\+---------------------------------------------------------------------------------------------------+  
|  Analog Pointer Value:  FLI\_Val \= MAX( %N1\_Limit, %TOT\_Limit, %TRQ\_Limit )                        |  
|                                                                                                   |  
|  \[0.0 \- 8.5\]  \--\> Normal Continuous Operation Range (Green Arc)                                   |  
|  \[8.5 \- 10.0\] \--\> Takeoff Power Limit (TOP \- 5 Minute Max Limit)                                  |  
|  \[10.0+\]      \--\> Transient / OEI Limit (Red Line / Contingency Rating)                          |  
\+---------------------------------------------------------------------------------------------------+

### **3.2 4-Axis Automatic Flight Control System (AFCS)**

The 4-axis AFCS operates through parallel and series actuators:

> * **Series Actuators:** High-speed, low-authority (typically \\pm 10\\%) fast stability augmentation system (SAS) inputs.  
> * **Parallel Actuators (Trim Motors):** Low-speed, 100% full-authority stick positioning via **Auto Trim** and **Beep Trim** modes.  
> * **Beep Trim:** Allows manual modulation of reference trim attitudes at a constant pitch/roll rate via cyclic hat-switch commands.

## **4\. Operational Protocols & Clinical Transport Engine**

### **4.1 PAVE Risk Assessment Matrix**

Prior to mission authorization, Stage 4 of the Mission Dispatch Planner computes a quantified PAVE score:  
\\text{Risk Score} \= P\_{\\text{Pilot}} \+ A\_{\\text{Aircraft}} \+ V\_{\\text{EnVironment}} \+ E\_{\\text{External}}

| Parameter Domain | Evaluated Risk Factors | Threshold Criteria |
| :---- | :---- | :---- |
| **Pilot (P)** | Night flying, instrument currency, pilot duty hours. | Score \> 15: Mandatory PIC Risk Mitigation. |
| **Aircraft (A)** | MEL deferrals, fuel margin \< 30\\text{ min}, rotor trim state. | Score \> 20: Alternate Aircraft Required. |
| **EnVironment (V)** | Marginal VFR, gust spread \> 15\\text{ kts}, night unlit LZ. | Score \> 25: Two-Pilot / IFR Mandate. |
| **External (E)** | High-urgency pediatric trauma, high-stress family presence. | Score \> 30: **MISSION NO-GO**. |

### **4.2 Clinical Engine & Golden Hour Decay Logic**

Patient physiological deterioration across 260+ medical conditions is tracked using an exponential decay function linked to transport time:  
\\text{GCS}(t) \= \\text{GCS}\_{\\text{baseline}} \\cdot e^{-\\lambda \\cdot t}  
Where \\lambda represents the condition decay constant and t is the elapsed time in minutes from call acceptance.

## **5\. Regional Infrastructure & Database Seeds**

### **5.1 Primary Air Ambulance Bases (Western PA)**

\+---------------------------------------------------------------------------------------------------+  
|                           REGIONAL HEMS BASE OPERATIONAL MATRIX                                  |  
\+-----------------+-------------------------------+--------------------+----------------------------+  
| Facility ID     | Operator / Base Name          | Location           | Stationed Asset            |  
\+-----------------+-------------------------------+--------------------+----------------------------+  
| STAT 1          | STAT MedEvac 1                | Washington, PA     | Eurocopter EC135\[span\_38\](start\_span)\[span\_38\](end\_span) |  
| STAT 3          | STAT MedEvac 3                | Cranberry, PA      | Airbus H135\[span\_39\](start\_span)\[span\_39\](end\_span)      |  
| STAT 4 (HQ)     | STAT MedEvac HQ               | KAGC Airport, PA   | Airbus H145\[span\_40\](start\_span)\[span\_40\](end\_span)\[span\_41\](start\_span)\[span\_41\](end\_span)  |  
| STAT 6          | STAT MedEvac 6                | KAXQ Clarion, PA   | Eurocopter EC135\[span\_42\](start\_span)\[span\_42\](end\_span) |  
| LifeFlight 1    | AHN LifeFlight 1              | Canonsburg, PA     | EC145 / H145\[span\_43\](start\_span)\[span\_43\](end\_span)\[span\_44\](start\_span)\[span\_44\](end\_span) |  
| LifeFlight 4    | AHN LifeFlight 4              | Butler, PA         | EC145 / H145\[span\_45\](start\_span)\[span\_45\](end\_span)\[span\_46\](start\_span)\[span\_46\](end\_span) |  
\+-----------------+-------------------------------+--------------------+----------------------------+

### **5.2 Key Level 1 Trauma Centers & Helipad Specifications**

> * **UPMC Presbyterian (PS78):** Pittsburgh, PA — Rooftop Helipad, 65 \\times 65\\text{ ft}, Concrete.  
> * **Allegheny General Hospital (42PN):** Pittsburgh, PA — Rooftop Helipad, 60 \\times 60\\text{ ft}, Steel/Concrete.  
> * **UPMC Mercy (PN23):** Pittsburgh, PA — Rooftop Helipad, Level 1 Trauma & Burn Center.  
> * **UPMC Children's Hospital (30PN):** Pittsburgh, PA — Dedicated Pediatric Trauma Rooftop Deck.

**Authored By:** Chief Systems Architect & Lead Software Engineer, Virtual HEMS **Approved By:** Directorate of Technology & Operational Safety Council **Repository Location:** virtualhems-monorepo/docs/LIVING-ENGINEERING-HANDBOOK.md