# **ACCOUNT-SETUP.md**

**Document Designation:** SETUP-GUIDE-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Pilot Account Registration, Authentication Workflow, Desktop Bridge Client Pairing, and Community Integration Guide for virtualhems.com

## **1\. Registration & Authentication Architecture**

To participate in live mission dispatching, clinical transport tracking, and flight logging within the Virtual HEMS ecosystem, pilots must establish a credentialed account.  
`+---------------------------------------------------------------------------------------------------+`  
`|                            ACCOUNT CREATION & PAIRING PIPELINE                                    |`  
`+---------------------------------------------------------------------------------------------------+`  
`|  1. Web Registration (virtualhems.com/register)                                                   |`  
`|     └── Account Creation & Credentials Issuance[span_11](start_span)[span_11](end_span)[span_12](start_span)[span_12](end_span)                                       |`  
`|  2. Security Authorization                                                                        |`  
`|     └── Unique Simulator API Key Generation[span_13](start_span)[span_13](end_span)[span_14](start_span)[span_14](end_span)                                          |`  
`|  3. Bridge Client Linking (apps/bridge-desktop/)                                                  |`  
`|     └── Local Port 8080 UDP Socket Binding + WebSocket Realtime Uplink[span_15](start_span)[span_15](end_span)                  |`  
`+---------------------------------------------------------------------------------------------------+`

### **1.1 Account Registration Steps**

> 1. Navigate to [virtualhems.com/register](https://virtualhems.com).  
> 2. Provide your full name, valid email address, and select a secure password.  
> 3. Complete profile initialization by selecting your primary digital role (e.g., Pilot IFR Commercial, Flight Nurse, or Communications Specialist).  
> 4. Access the **Account Settings** tab to retrieve your generated **Secure API Key**.

## **2\. Desktop Bridge Client Installation & Pairing**

The Desktop Bridge client connects desktop flight simulators (Microsoft Flight Simulator 2020/2024 and X-Plane 11/12) directly to the web-based Command Dashboard.

### **2.1 Installation**

> * **Windows:** Download the .exe installer from [virtualhems.com/downloads](https://virtualhems.com). It manages SimConnect SDK dependencies automatically.  
> * **macOS:** Download the .dmg installer and drag **HEMS Ops** into your Applications folder.

### **2.2 Telemetry Plugin Setup**

> * **X-Plane 11/12:** Ensure FlyWithLua is installed. Copy the provided hems-dispatch-xp.lua script into X-Plane/Resources/plugins/FlyWithLua/Scripts/.  
> * **MSFS 2020/2024:** Launch the standalone desktop application; it uses native SimConnect shared memory calls to poll flight variables automatically.

### **2.3 Authentication & Pairing**

> 1. Launch the **Virtual HEMS Bridge UI** application.  
> 2. Paste your **Secure API Key** copied from the web terminal into the authentication field.  
> 3. Ensure your network firewall permits incoming/outgoing UDP traffic on local port 8080\.  
> 4. Start your simulator. The bridge automatically establishes a 2 Hz WebSocket link between your aircraft and the web-based Tactical Overwatch Center.

## **3\. Pilot Profile Data Management**

Pilot account profiles manage credentials, assigned callsigns, and historical flight data across all modules.

| Database Column / Field | System Purpose | User Configuration Option |
| :---- | :---- | :---- |
| HEMS Credential ID | Tracks flight certification level and assigned pilot callsign. | Managed via User Profile Settings. |
| Primary Home Base | Sets default deployment station (e.g., STAT 6 KAXQ, LifeFlight 4 KBTP). | Selectable in Dispatcher Preferences. |
| MFA Enabled | Multi-Factor Authentication status for account protection. | Optional via Security Settings. |
| Data Sync Frequency | Telemetry refresh rate configuration. | Configurable in User Preferences. |

## **4\. Community Support & External Platforms**

Virtual HEMS offers community hubs, technical assistance, and voluntary platform support options.

> * **Discord Server:** Connect with other virtual aviators, request flight partners, and get technical support for simulator bridging.  
> * **YouTube & Video Guides:** Access interactive walkthroughs covering startup SOPs, 4-axis AFCS usage, and clinical engine management.  
> * **Platform Membership & Support:** Virtual HEMS utilizes membership platforms (e.g., Ko-fi, Patreon) to support server hosting, PostGIS database maintenance, and continuous software updates.

`+---------------------------------------------------------------------------------------------------+`  
`|                                  ACCOUNT SETUP AUDIT MATRIX                                       |`  
`+-------------------+------------------------------------+------------------------------------------+`  
`| Audit Step        | Verification Method                | Success Criteria                         |`  
`+-------------------+------------------------------------+------------------------------------------+`  
`| Web Profile       | Registration Form Completion       | Valid User ID & API Key generated[span_68](start_span)[span_68](end_span)[span_69](start_span)[span_69](end_span) |`  
`| Local UDP Port    | Port 8080 Binding Check            | Desktop Bridge shows "Socket Listening[span_70](start_span)"[span_70](end_span) |`  
`| Telemetry Uplink  | In-Browser Tester / Live Flight    | Active aircraft track appears on map[span_71](start_span)[span_71](end_span)[span_72](start_span)[span_72](end_span)|`  
`+-------------------+------------------------------------+------------------------------------------+`

**Authored By:** Lead Tactical Architect & Lead Software Engineer, Virtual HEMS **Approved By:** Directorate of Technology & Operational Safety Council **Repository Location:** virtualhems-monorepo/docs/ACCOUNT-SETUP.md