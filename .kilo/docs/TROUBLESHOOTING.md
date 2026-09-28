# **TROUBLESHOOTING.md**

**Document Designation:** TBL-SPEC-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Comprehensive System Fault Diagnosis, Network Connectivity Resolution, Simulator Plugin Debugging, Avionics Malfunction Procedures, and Clinical Engine Error Recovery for virtualhems.com

## **1\. Diagnostics & Fault Decision Tree Architecture**

When encounters with hardware, software, or network anomalies occur within the Virtual HEMS ecosystem, pilots and administrators must follow a structured decision-making protocol adapted from the aviation **DODAR** cycle (**D**etect, **O**btain Information, **D**ecide, **A**ct, **R**eview):  
`+---------------------------------------------------------------------------------------------------+`  
`|                            VIRTUAL HEMS TROUBLESHOOTING PIPELINE                                  |`  
`+---------------------------------------------------------------------------------------------------+`  
`|  1. DETECT (Identify visual, aural, or telemetry anomalies) [1]                                   |`  
`|     └── Check CAD Cautions, Bridge UI Error Logs, or Web Socket Status Badges [1, 5, 6]           |`  
`|  2. OBTAIN INFORMATION (Cross-check system indicators) [1]                                        |`  
`|     └── Inspect UDP Port 8080, SimConnect memory blocks, or FlyWithLua debug output [5, 6]       |`  
`|  3. DECIDE (Determine primary fault root cause) [1]                                               |`  
`|     └── Isolate issue to Bridge Client, Simulator Plugin, Web API, or Avionics Logic [1, 5, 6]   |`  
`|  4. ACT (Apply corrective procedures) [1]                                                         |`  
`|     └── Execute terminal resets, configuration updates, or emergency overrides [1, 5, 6]          |`  
`|  5. REVIEW (Evaluate recovery and log report) [1]                                                 |`  
`|     └── Verify 2 Hz telemetry recovery; file VIRS incident report if required [1, 5]             |`  
`+---------------------------------------------------------------------------------------------------+`

## **2\. Simulator & Desktop Bridge Connection Issues**

### **2.1 Desktop Bridge UI Fails to Bind to UDP Port 8080**

> * **Symptom:** Desktop Bridge displays Error: EADDRINUSE: Address already in use 0.0.0.0:8080 or fails to launch.  
> * **Root Cause:** Another application or background process is utilizing local UDP port 8080\.  
> * **Resolution:**  
  1. Open Terminal or Command Prompt.  
  2. Locate the process occupying port 8080:  
     * *Windows:* netstat \-ano | findstr :8080  
     * *macOS/Linux:* lsof \-i :8080  
  3. Terminate the conflicting process or update virtualhems-bridge.json to route telemetry via an alternate local port.

### **2.2 X-Plane Telemetry Disconnected (FlyWithLua)**

> * **Symptom:** X-Plane is running, but the Bridge UI shows X-Plane Status: Waiting for UDP Stream...  
> * **Root Cause:** FlyWithLua script missing, disabled, or failing execution during initialization.  
> * **Resolution:**  
  1. Ensure hems-dispatch-xp.lua is placed in X-Plane/Resources/plugins/FlyWithLua/Scripts/.  
  2. Open X-Plane and navigate to **Plugins \-\> FlyWithLua \-\> Reload Lua Script Files**.  
  3. Check X-Plane/Log.txt and FlyWithLua\_debug.txt for script syntax errors.

### **2.3 MSFS SimConnect Memory Bridge Unresponsive**

> * **Symptom:** MSFS 2020/2024 is loaded in a flight, but altitude/airspeed telemetry remains static (0\\text{ kts}, 0\\text{ ft}) on the web command map.  
> * **Root Cause:** SimConnect SDK library mismatch or shared memory hook timed out.  
> * **Resolution:**  
  1. Restart the **Virtual HEMS Bridge Desktop Client** with administrator privileges.  
  2. Verify the official MSFS SimConnect runtime (SimConnect.dll) is installed in your system directory.  
  3. Re-engage flight from the MSFS main menu to force a re-initialization of memory blocks.

## **3\. Avionics & Aircraft Systems Malfunctions**

`+---------------------------------------------------------------------------------------------------+`  
`|                               CPDS CAUTION & FAULT DIAGNOSTICS                                    |`  
`+-------------------+------------------------------------+------------------------------------------+`  
`| CAD Caution Light | Underlying System Failure          | Immediate Pilot Corrective Procedure     |`  
`+-------------------+------------------------------------+------------------------------------------+`  
``| `ENG FAIL`        | $N_1$ RPM dropped below threshold  | Establish OEI flight; emergency shutdown |``  
``| `FADEC FAIL`      | Fuel metering valve blocked        | Lock collective; manual fuel control     |``  
``| `HYD PRESS`       | Hydraulic pressure loss in Sys 1/2 | Limit aggressive cyclic; land ASAP       |``  
``| `AUTOPILOT` / `TRIM`| AFCS auto-trim or actuator fail  | Disengage AFCS; fly manually             |``  
``| `XMSN OIL P`      | Transmission oil pressure minimum  | Reduce power; land as soon as practical  |``  
`+-------------------+------------------------------------+------------------------------------------+`

### **3.1 First Limit Indicator (FLI) Exceedances & Engine Degradation**

> * **Symptom:** CPDS FLI needle enters the Red Arc (\> 10.0), or ENG OIL P / FADEC FAIL cautions appear on the CAD display.  
> * **Resolution:**  
  1. Lower collective immediately to bring engine parameters (N\_1, TOT, TRQ) back into the Green Arc (\\le 8.5).  
  2. If FADEC FAIL occurs, avoid rapid collective movements; automatic engine acceleration and deceleration are disabled.  
  3. Confirm fuel prime pumps are turned **OFF** during normal flight operations to prevent fuel pressure anomalies.

### **3.2 AFCS / Auto Trim Disconnect & Cyclic Unresponsiveness**

> * **Symptom:** TRIM, P/R SAS, or YAW SAS cautions appear; cyclic stick feels locked or unstable.  
> * **Resolution:**  
  1. Check that the cyclic stick unlock mechanism is engaged in your simulator controls setup.  
  2. Press the **AP / SAS Disconnect** button on the cyclic to reset servo actuators.  
  3. If auto-trim fails, rely on manual beep trim inputs or fly the rotorcraft in manual mode.

## **4\. Web Application, Clinical Engine & API Faults**

### **4.1 Golden Hour Countdown or GCS Decay Freeze**

> * **Symptom:** Patient vitals on /efb stop updating, or the 60-minute Golden Hour timer pauses.  
> * **Root Cause:** Browser WebSocket stream interrupted or background tab throttled by browser power-saving features.  
> * **Resolution:**  
  1. Refresh the /efb web interface or toggle the telemetry connection switch.  
  2. Ensure the browser tab is focused or running in an unthrottled window.  
  3. Verify system clock synchronization (NTP) on your desktop client.

### **4.2 Medical Communication & Radio Protocol Failure**

> * **Symptom:** Unable to establish direct contact with receiving medical control via the web EFB terminal during transport.  
> * **Protocol Deviation Procedure:**  
  1. Continue patient care in accordance with established medical protocols.  
  2. Contact medical control as soon as secondary communications can be established and inform them of all care rendered.  
  3. File a written **Radio Failure Report** detailing the situation and actions taken within 24 hours.

## **5\. Build, Environment & Dependency Troubleshooting**

For developers compiling the monorepo workspace from source (virtualhems-monorepo):  
`+---------------------------------------------------------------------------------------------------+`  
`|                                COMMON MONOREPO BUILD ERRORS                                       |`  
`+-----------------------------------+---------------------------------------------------------------+`  
`| Reported Terminal Error           | Diagnostic & Resolution Steps                                 |`  
`+-----------------------------------+---------------------------------------------------------------+`  
``| `Unknown argument: electron:build` | Build tool mismatch. Use Tauri compiler instead of Electron [6]|``  
``| `PostGIS Spatial Query Timeout`   | Verify PostgreSQL service is active & spatial indexes built   |``  
``| `TypeScript Interface Mismatch`   | Run `pnpm --filter shared-types build` to sync type contracts |``  
`+-----------------------------------+---------------------------------------------------------------+`

**Authored By:** Lead Systems Architect & Lead Software Engineer, Virtual HEMS Platform **Approved By:** Directorate of Technology & Operational Safety Council **Repository Location:** virtualhems-monorepo/docs/TROUBLESHOOTING.md