# **MCP.md**

**Document Designation:** MCP-SPEC-2026.1 **Revision:** 2026.1 **Effective Date:** January 1, 2026 **Subject:** Model Context Protocol (MCP) Server Architecture, Context Injection Pipeline, Data Schemas, Tool Binding Specifications, and AI Swarm Interoperability for virtualhems.com

## **1\. Architecture & Model Context Protocol Overview**

The Virtual HEMS Model Context Protocol (MCP) server acts as a contextual data-link bridge. It standardizes how external artificial intelligence agents, desktop bridge applications, and automated dispatchers interface with real-time flight telemetry, PostGIS spatial data, and patient vitals engines across the virtualhems.com ecosystem.  
`+---------------------------------------------------------------------------------------------------+`  
`|                             VIRTUAL HEMS MCP ARCHITECTURE TOPOLOGY                                |`  
`+---------------------------------------------------------------------------------------------------+`  
`|  LLM / AI Swarm Clients (Ironpine Engine, Tactical AI, Safety Audit Agents)[span_10](start_span)[span_10](end_span)[span_11](start_span)[span_11](end_span)[span_12](start_span)[span_12](end_span)            |`  
`+---------------------------------------------------------------------------------------------------+`  
                                                 `│`  
                                                 `▼ (Model Context Protocol / JSON-RPC over Standard I/O or SSE)`  
`+---------------------------------------------------------------------------------------------------+`  
`|  apps/web/src/app/api/mcp/route.ts (Virtual HEMS MCP Server Instance)[span_13](start_span)[span_13](end_span)[span_14](start_span)[span_14](end_span)[span_15](start_span)[span_15](end_span)             |`  
`|  ├── Resource Providers  --> Spatial DB (PostGIS), METAR Feeds, Clinical Condition Engine[span_16](start_span)[span_16](end_span)[span_17](start_span)[span_17](end_span)[span_18](start_span)[span_18](end_span) |`  
`|  ├── Context Prompts     --> AI Tactical Briefings, Pre-Flight PAVE Risk Matrix Assessments[span_19](start_span)[span_19](end_span)[span_20](start_span)[span_20](end_span) |`  
`|  └── Executable Tools    --> Route Calculations, Helipad Queries, VIRS Incident Filings[span_21](start_span)[span_21](end_span)[span_22](start_span)[span_22](end_span)    |`  
`+---------------------------------------------------------------------------------------------------+`  
                                                 `│`  
                                                 `▼`  
`+---------------------------------------------------------------------------------------------------+`  
`|  packages/database/ (Supabase PostgreSQL + PostGIS Spatial Indexing)[span_23](start_span)[span_23](end_span)[span_24](start_span)[span_24](end_span)[span_25](start_span)[span_25](end_span)                |`  
`+---------------------------------------------------------------------------------------------------+`

## **2\. MCP Resource Providers**

MCP Resources supply structured context directly into the AI agent prompt space without requiring active tool execution.

### **2.1 Spatial Infrastructure Resources**

> * hems://infrastructure/bases: Returns operational metadata, active assets, and locations for all 18 STAT MedEvac and 5 AHN LifeFlight base stations.  
> * hems://infrastructure/hospitals/{faa\_id}: Resolves regional hospital helipad specs (e.g., UPMC Presbyterian PS78, Allegheny General 42PN, UPMC Children's 30PN, UPMC Mercy PN23) including surface type, dimensions, and elevation.

### **2.2 Telemetry & Active Flight Resources**

> * hems://telemetry/active-sorties: Exposes real-time 2\\text{ Hz} vector streams (latitude, longitude, MSL/AGL altitude, groundspeed, heading, pitch, roll, FLI percentage) for all online simulator bridge links.  
> * hems://clinical/conditions: Provides access to the 260+ condition medical database, default GCS baselines, and decay parameters (\\lambda).

## **3\. MCP Tool Binding & Execution Directory**

MCP Tools enable autonomous agents to execute state modifications, query complex spatial boundaries, or trigger serverless platform actions.  
`+---------------------------------------------------------------------------------------------------+`  
`|                                MCP EXECUTABLE TOOLS DIRECTORY                                     |`  
`+------------------------+---------------------------------------+----------------------------------+`  
`| Tool Name              | Input Parameters                      | Primary Function                 |`  
`+------------------------+---------------------------------------+----------------------------------+`  
``| `get_nearest_helipad`  | `lat` (float), `lng` (float), `rad`   | Queries PostGIS for helipads[span_41](start_span)[span_41](end_span)[span_42](start_span)[span_42](end_span)|``  
``| `calculate_pave_risk`  | Pilot, Aircraft, WX, External factors | Returns quantified PAVE score[span_43](start_span)[span_43](end_span)[span_44](start_span)[span_44](end_span)|``  
``| `compute_gcs_decay`    | `baseline_gcs`, `decay_rate`, `time`  | Computes $GCS(t) = GCS_0 \cdot e^{-\lambda t}$[span_45](start_span)[span_45](end_span)[span_46](start_span)[span_46](end_span)|``  
``| `submit_virs_report`   | `pilot_id`, `category`, `narrative`   | Logs non-punitive SMS report[span_47](start_span)[span_47](end_span)[span_48](start_span)[span_48](end_span)|``  
`+------------------------+---------------------------------------+----------------------------------+`

### **3.1 Tool Schema Example: calculate\_pave\_risk**

`{`  
  `"name": "calculate_pave_risk",`  
  `"description": "Evaluates quantified PAVE risk assessment score for HEMS flight authorization.",`  
  `"parameters": {`  
    `"type": "object",`  
    `"properties": {`  
      `"pilot_risk": { "type": "number", "description": "Score based on currency, night flight, and fatigue" },`  
      `"aircraft_risk": { "type": "number", "description": "Score based on MEL items, fuel margins, and airframe state" },`  
      `"environment_risk": { "type": "number", "description": "Score based on METAR, ceiling, visibility, and LZ lighting" },`  
      `"external_risk": { "type": "number", "description": "Score based on scene urgency, pediatric status, and stress" }`  
    `},`  
    `"required": ["pilot_risk", "aircraft_risk", "environment_risk", "external_risk"]`  
  `}`  
`}`

## **4\. MCP Context Prompt Templates**

MCP Prompts generate pre-formatted instruction sets to guide LLM reasoning for specific flight stages.

### **4.1 Tactical Dispatch Briefing Prompt (hems-briefing-prompt)**

Constructs an AI brief combining stage 1 dispatch weather, stage 2 crew assignments, stage 3 patient demographics, and stage 4 PAVE matrix calculations:  
\\text{Risk Score} \= P\_{\\text{Pilot}} \+ A\_{\\text{Aircraft}} \+ V\_{\\text{EnVironment}} \+ E\_{\\text{External}}  
**Mandatory Policy Constraint:** If the computed PAVE Risk Score exceeds **30**, the prompt instructs the agent to enforce an immediate **MISSION NO-GO** determination.

## **5\. Verification & MCP Compliance Matrix**

| Target Interface | Audit Methodology | Pass Threshold / Verification |
| :---- | :---- | :---- |
| **Resource Resolution** | Read URI hems://infrastructure/hospitals/PS78 | Returns valid PostGIS JSON payload for UPMC Presbyterian. |
| **Tool Execution** | Execute calculate\_pave\_risk with total score \> 30 | Validates that authorization is blocked (NO-GO). |
| **Clinical Formula** | Execute compute\_gcs\_decay | Confirms decay logic against baseline GCS(t) \= GCS\_0 \\cdot e^{-\\lambda t}. |
| **Bridge Link** | Test UDP 8080 to MCP JSON-RPC conversion | Streaming latency remains \\le 50\\text{ ms} at 2\\text{ Hz} sync. |

**Authored By:** Lead Systems Architect & Lead AI Engineer, Virtual HEMS Platform **Approved By:** Directorate of Technology & Operational Safety Council **Repository Location:** virtualhems-monorepo/docs/MCP.md