# Requirements Document

## Introduction

Virtual HEMS is a flight-following, mission-dispatch, clinical-simulation, and safety-management platform for helicopter simulation. It connects Microsoft Flight Simulator 2020/2024 and X-Plane 11/12 to a cross-platform desktop bridge, a Supabase/PostgreSQL/PostGIS backend, and a Next.js web command terminal that hosts a live theater map, a four-stage dispatcher, a cockpit Electronic Flight Bag (EFB), a clinical deterioration model, and an automated after-action review.

These requirements are derived from the approved design document (`.kiro/specs/helicopter-simulation/design.md`) and the project documentation under `.kilo/docs` (notably `REQUIREMENTS.md`, `APP-MAP.md`, `ARCHITECTURE.md`, `FRAMEWORK.md`, `TECH-STACK.md`, `HEMS Service Overview.md`, `POH.md`, `SCHEMATICS.md`, Module 2, Module 3, Module 4, and `TASKS.md`). Each requirement is traceable to the design's components, contracts, and low-level algorithms.

The design defines seven correctness properties provisionally mapped to Requirements 1.1 through 7.1. This document establishes that mapping normatively: Requirement 1 (Simulator Integration and Telemetry) aligns with Property 1, Requirement 2 (Bridge Buffering and Replay) with Property 2, Requirement 3 (Four-Stage Dispatch) with Property 3, Requirement 4 (Clinical and Golden Hour Simulation) with Property 4, Requirement 5 (Spatial Facility Recommendation) with Property 5, Requirement 7 (After-Action Review) with Property 6, and Requirement 9 (Degraded-State Behavior) with Property 7. Requirements 6 (Cockpit EFB), 8 (Security, Privacy, and Authorization), and 10 (Public and Marketing Surfaces) cover the remaining design surfaces.

This is a simulation and training system. It is not a real-world dispatch, medical-decision, or aviation-safety authority, and it uses only simulated, minimized patient data.

## Glossary

- **Platform**: The complete Virtual HEMS system, comprising the desktop bridge, cloud backend, and web command terminal.
- **Bridge**: The cross-platform Tauri/Rust desktop application that samples simulator state, normalizes and buffers telemetry, and transmits it to the cloud backend.
- **Simulator_Adapter**: A bridge component that reads state from one simulator engine (MSFS 2020/2024 via SimConnect, or X-Plane 11/12 via FlyWithLua UDP) and maps it to the normalized telemetry contract.
- **Telemetry_Ingestion_Service**: The cloud service that authenticates, validates, and persists telemetry frames and broadcasts current asset state.
- **Offline_Queue**: The local SQLite ring buffer that persists unsent telemetry frames and mission events during network loss.
- **Mission_Service**: The cloud service that creates missions and transitions them through documented lifecycle states.
- **Dispatch_Planner**: The four-stage web workflow (Details, Crew, Patient Info, Flight Plan) that validates and authorizes missions.
- **Clinical_Engine**: The deterministic service that resolves medical conditions, runs the Golden Hour timer, and derives patient physiological state.
- **Recommendation_Service**: The spatial service that evaluates receiving facilities against capability, helipad, weather, and route constraints.
- **Ironpine_Briefing**: The server-side AI boundary that generates explainable tactical facility and landing-zone recommendations.
- **EFB**: The cockpit Electronic Flight Bag client that displays the mission package, patient state, checklists, navigation/LZ data, and service status.
- **AAR_Engine**: The After-Action Review service that audits a completed mission's telemetry, route, flight envelope, reserves, timeline, and clinical outcome, then scores the mission.
- **Safety_Service**: The service that captures non-punitive Virtual Incident Reporting System (VIRS) submissions.
- **Web_Terminal**: The Next.js web application that hosts public, authentication, and authenticated operational routes.
- **Telemetry_Frame**: A normalized, versioned, timestamped record of simulator position, flight, and systems state.
- **Golden_Hour**: The 60-minute clinical timing model that begins at scene dispatch.
- **GCS**: Glasgow Coma Scale, an integer patient score between 3 and 15.
- **PAVE**: The Pilot, Aircraft, enVironment, External risk assessment producing a GO, CONDITIONAL, or NO_GO disposition.
- **RLS**: PostgreSQL Row Level Security.
- **Policy_Version**: The identified set of clinical, reserve, and audit thresholds in effect for a mission, recorded with derived state and reports.

## Requirements

### Requirement 1: Simulator Integration and Telemetry Validity

**User Story:** As a simulator pilot, I want authentic rotorcraft state streamed from MSFS or X-Plane into a single normalized contract, so that the platform can track my flight accurately regardless of which simulator I use.

Aligns with design Section 4.1 (Simulator adapter contract), Section 4.3 (Telemetry contract), Section 6.1 (Telemetry ingestion algorithm), and Correctness Property 1.

#### Acceptance Criteria

1. WHEN a Simulator_Adapter produces a telemetry sample, THE Telemetry_Ingestion_Service SHALL accept the resulting Telemetry_Frame only WHERE the frame declares a supported engine of MSFS2020, MSFS2024, XPLANE11, or XPLANE12, carries finite normalized numeric values, and includes a non-empty schema version string of at most 32 characters, an observed timestamp within the range from 60 seconds in the past to 5 seconds in the future relative to the cloud receive time, and a session sequence number that is a non-negative integer strictly greater than the previously accepted sequence number for the same session.
2. WHEN a telemetry sample declares a simulator engine or version other than MSFS2020, MSFS2024, XPLANE11, or XPLANE12, THE Telemetry_Ingestion_Service SHALL reject the sample without persisting it and return a compatibility error that names the unsupported engine value and leaves prior accepted session state unchanged.
3. IF a telemetry sample contains a latitude outside -90 to 90 degrees inclusive, a longitude outside -180 to 180 degrees inclusive, any non-finite numeric value, a heading outside 0 to 360 degrees (360 exclusive), or a session sequence number less than or equal to the previously accepted sequence number that is not flagged as replayed historical data, THEN THE Telemetry_Ingestion_Service SHALL reject the sample without persisting it and record a diagnostic entry identifying the failed validation field.
4. WHEN the MSFS Simulator_Adapter reads SimConnect state or the X-Plane Simulator_Adapter receives FlyWithLua data on the local UDP socket bound to `127.0.0.1:8080`, THE Simulator_Adapter SHALL map the state to the normalized telemetry contract with all units converted to the shared contract unit definitions.
5. WHILE the Bridge is sampling an active session, THE Bridge SHALL sample simulator kinematic state at a configured fixed rate between 2 and 10 Hz inclusive.
6. IF the X-Plane Simulator_Adapter receives no FlyWithLua data on the UDP socket for 5 consecutive seconds during an active session, THEN THE Simulator_Adapter SHALL mark the session source as disconnected and record a diagnostic identifying the source loss.
7. WHEN the Telemetry_Ingestion_Service accepts a Telemetry_Frame, THE Telemetry_Ingestion_Service SHALL persist the frame with its source timestamp and cloud receive timestamp recorded as separate fields.
8. THE Simulator_Adapter SHALL restrict itself to reading and normalizing simulator state, and SHALL delegate persistence and cloud transmission to other Bridge and cloud components.

### Requirement 2: Bridge Buffering and Durable Replay

**User Story:** As a simulator pilot flying through unreliable connectivity, I want the bridge to buffer telemetry locally and replay it losslessly after reconnect, so that no acknowledged flight data is lost or duplicated.

Aligns with design Section 4.2 (Bridge runtime contract), Section 6.1 (Telemetry ingestion), Section 6.2 (Offline replay algorithm), and Correctness Property 2.

#### Acceptance Criteria

1. WHEN the Bridge creates a Telemetry_Frame, THE Bridge SHALL append the frame to the Offline_Queue as a durable record that survives process restart and host power loss, and SHALL complete the append before initiating cloud transmission of that frame.
2. WHILE the cloud uplink is unavailable, THE Bridge SHALL retain all unsent frames and mission events in the Offline_Queue in ascending session-and-sequence order, where ordering is defined as ordering first by session identifier and then by sequence number.
3. WHEN the cloud uplink transitions from unavailable to available AND the Offline_Queue contains one or more unsent records, THE Bridge SHALL begin replaying the records in ascending session-and-sequence order within 5 seconds of detecting availability.
4. WHEN the Telemetry_Ingestion_Service returns an acknowledgment for a replayed frame, THE Bridge SHALL remove that frame from the Offline_Queue and SHALL preserve the ascending session-and-sequence order of the remaining records.
5. IF a replayed frame receives a retryable failure, THEN THE Bridge SHALL retain the frame in the Offline_Queue, defer further replay for a configured retry backoff interval between 1 second and 60 seconds, and retry the frame up to a configured maximum of 10 attempts before treating it as a permanent failure.
6. IF a replayed frame receives a permanent failure, or reaches the configured maximum retry attempts, THEN THE Bridge SHALL mark the frame as failed, retain it as a diagnostic record without removing it from durable storage, present an error indication to the user identifying the affected frame, and continue replaying subsequent records without interruption.
7. WHEN the Telemetry_Ingestion_Service receives a frame whose combination of pilot identifier, session identifier, and sequence number matches an already-persisted frame, THE Telemetry_Ingestion_Service SHALL treat the frame as idempotent, SHALL NOT create a duplicate persisted record, and SHALL return an acknowledgment equivalent to that of the original persisted frame.
8. WHERE the Offline_Queue reaches its configured maximum capacity, THE Bridge SHALL apply the configured retention or backpressure policy, present an alert to the user indicating that the capacity limit has been reached, and record the retention action as a durable diagnostic entry rather than silently discarding records.

### Requirement 3: Four-Stage Mission Dispatch and Gating

**User Story:** As a dispatcher, I want to build a mission through gated Details, Crew, Patient Info, and Flight Plan stages, so that a mission reaches the cockpit only after all required operational, clinical, risk, and reserve checks pass.

Aligns with design Section 4.4 (Mission and dispatch contracts), Section 6.3 (Mission dispatch state machine), and Correctness Property 3.

#### Acceptance Criteria

1. WHEN a dispatcher submits Stage 1 Details, THE Dispatch_Planner SHALL validate that the mission type is one of the defined mission types, that the assigned base and airframe are each present and reference an existing configured record, that the origin and destination facilities are each present, reference an existing facility, and are not identical, and that a weather snapshot has been captured with an age of 60 minutes or less at submission time, before opening Stage 2 Crew.
2. IF any Stage 1 Details field is missing, references a non-existent record, has identical origin and destination facilities, or has a weather snapshot older than 60 minutes, THEN THE Dispatch_Planner SHALL reject the Stage 1 submission, SHALL keep Stage 2 Crew closed, and SHALL return an error indication identifying each failed field while retaining the previously entered Stage 1 values.
3. WHEN a dispatcher submits Stage 2 Crew, THE Dispatch_Planner SHALL require exactly one crew member designated as pilot in command, SHALL require that the crew roster contains between 2 and 6 members inclusive with no duplicate member and each member assigned a defined role, and SHALL open Stage 3 Patient Info only when these conditions are satisfied.
3a. IF Stage 2 Crew validation fails, THEN THE Dispatch_Planner SHALL reject the Stage 2 submission, SHALL keep Stage 3 Patient Info closed, and SHALL return an error indication identifying each specific failed condition, including any of multiple crew members designated as pilot in command, no crew member designated as pilot in command, a duplicate crew member, a crew member with no defined role, or a roster size outside the range of 2 to 6 members inclusive, while retaining the previously entered Stage 2 values.
4. WHEN a dispatcher submits Stage 3 Patient Info, THE Dispatch_Planner SHALL validate that the simulated patient input is present and complete, SHALL resolve the selected medical condition to an existing condition record, and SHALL derive a baseline GCS as an integer from 3 to 15 inclusive, before opening Stage 4 Flight Plan.
5. WHEN a dispatcher submits Stage 4 Flight Plan, THE Dispatch_Planner SHALL calculate the PAVE risk disposition, SHALL calculate the flight plan, and SHALL verify that the computed reserve fuel margin is greater than or equal to the reserve margin required by the reserve policy.
6. IF any required Details, Crew, Patient Info, PAVE disposition, flight plan, or reserve check is invalid, THEN THE Mission_Service SHALL prevent the mission from becoming DISPATCHED, SHALL prevent delivery of the mission package to the EFB, and SHALL return an error indication identifying the failed check while retaining the mission in its pre-dispatch state.
7. WHEN all required Stage 1 through Stage 4 checks are valid, THE Mission_Service SHALL issue an authorization code, set the mission status to DISPATCHED, and publish the mission package to the EFB.
8. WHEN the Dispatch_Planner receives a request to advance to a target stage, THE Dispatch_Planner SHALL permit advancement only to the current stage or a previously completed stage, and SHALL reject any request that targets a stage beyond the current stage or that skips an incomplete stage, returning an error indication identifying the incomplete stage.
9. WHEN a mission transitions between dispatch stages or lifecycle states, THE Mission_Service SHALL append one auditable mission event recording the source state, the target state, and the transition timestamp.
10. WHERE a dispatcher records an explicit training override for a failed check, THE Mission_Service SHALL record the override together with its rationale as a non-empty text entry in the mission event history before authorizing the mission, and IF the rationale is absent or empty, THEN THE Mission_Service SHALL reject the override and SHALL prevent authorization.

### Requirement 4: Clinical Simulation and Golden Hour Deterioration

**User Story:** As a training officer, I want deterministic patient deterioration driven by the Golden Hour timer and on-scene delay, so that clinical outcomes are reproducible and tied to crew timing decisions.

Aligns with design Section 4.5 (Clinical contracts), Section 6.4 (Golden Hour and clinical deterioration algorithm), and Correctness Property 4.

#### Acceptance Criteria

1. WHEN a mission is dispatched for a scene call, THE Clinical_Engine SHALL initiate a 3600-second Golden Hour timer for the associated patient, anchored to the dispatch event time.
2. WHEN the Clinical_Engine derives patient state at an event time, THE Clinical_Engine SHALL compute elapsed Golden Hour time and elapsed scene time deterministically in whole seconds from the recorded mission events and the effective Policy_Version, such that identical inputs always produce identical elapsed values.
3. WHILE on-scene elapsed time exceeds the configured scene target (default 1200 seconds, configurable within 300 to 3600 seconds), THE Clinical_Engine SHALL apply a deterioration penalty derived from the condition decay rate and the effective Policy_Version once per elapsed whole minute beyond the target.
4. THE Clinical_Engine SHALL clamp the current GCS to the integer range 3 through 15 inclusive, setting any computed value below 3 to 3 and any computed value above 15 to 15.
5. WHEN the Clinical_Engine updates patient state, THE Clinical_Engine SHALL set the deteriorated flag to true WHERE the current GCS is below the baseline GCS or a vital-sign effect is present, and SHALL set it to false otherwise.
6. IF the Clinical_Engine receives an event whose event time precedes the last recorded update time, THEN THE Clinical_Engine SHALL reject the update, preserve the existing monotonic state, and record an error indication identifying the out-of-order event.
7. WHEN the Clinical_Engine derives patient state, THE Clinical_Engine SHALL record the Policy_Version used to derive that state.
8. THE medical condition matrix SHALL categorize each condition as exactly one of Trauma, Cardiac, Stroke, Neuro, OB, Pediatric, Environmental, or Other, and SHALL map each condition to a baseline GCS range within 3 to 15 and to exactly one required receiving-facility capability.
9. IF a resolved medical condition record is missing its category, baseline GCS range, decay rate, or required facility capability, THEN THE Clinical_Engine SHALL reject use of that condition and record an error indication identifying the incomplete condition record.

### Requirement 5: Spatial Facility Recommendation

**User Story:** As a dispatcher, I want facility recommendations that satisfy clinical capability, helipad, weather, and route constraints, so that the platform never silently proposes an unsafe receiving facility.

Aligns with design Section 4.6 (Infrastructure and AAR contracts), Section 5.1 to 5.2 (spatial data model), Section 6.5 (Spatial facility recommendation algorithm), and Correctness Property 5.

#### Acceptance Criteria

1. WHEN the Recommendation_Service evaluates receiving facilities for a patient, THE Recommendation_Service SHALL include a facility in the eligible set only IF the facility capability matches the patient condition's required facility type, the helipad status is operational under the current weather observation, and the route is permissible under all applicable route constraints, and SHALL exclude any facility that fails one or more of these checks.
2. WHEN the Recommendation_Service returns a recommendation, THE Recommendation_Service SHALL attach to each recommended facility a provenance record containing the evaluated facility capability, helipad status, weather observation, route-constraint result, and the computed suitability score.
3. IF no facility satisfies all applicable capability, helipad, weather, and route constraints, THEN THE Recommendation_Service SHALL return an explicit no-match result, SHALL NOT return any facility as recommended, and SHALL indicate that authorized human selection or a mission hold is required.
4. THE Recommendation_Service SHALL NOT recommend a facility solely because it is the geographically nearest facility when that facility fails any applicable capability, helipad, weather, or route constraint.
5. WHEN two or more facilities are eligible, THE Recommendation_Service SHALL order the results in descending order of suitability score, and SHALL break ties by ascending straight-line distance from the patient location, breaking any remaining ties by ascending facility identifier so that identical inputs always produce identical ordering.
6. WHEN the Recommendation_Service queries regional infrastructure, THE Recommendation_Service SHALL use indexed PostGIS proximity, radial, and elevation operations over the stored base, hospital, and helipad geometry.
7. WHERE the Ironpine_Briefing boundary is unavailable, THE Recommendation_Service SHALL return deterministic facility and landing-zone query results derived solely from the stored spatial data, and SHALL mark the AI recommendation as absent in the returned result.
8. IF a facility's helipad status, weather observation, or route-constraint data is missing or unavailable at evaluation time, THEN THE Recommendation_Service SHALL treat that facility as ineligible and SHALL record the missing input in that facility's provenance record.

### Requirement 6: Cockpit Electronic Flight Bag

**User Story:** As a flight crew member, I want a cockpit EFB that presents the authorized mission package, live patient state, checklists, and navigation data, so that I can execute and monitor the mission from the aircraft.

Aligns with design Section 3.2 (component model), Section 3.4 (operational sequence), Section 3.5 (route and client surface), and the `/dashboard/efb` surfaces in `APP-MAP.md`.

#### Acceptance Criteria

1. WHEN the Mission_Service publishes an authorized mission package, THE EFB SHALL display the mission details, assigned crew, simulated patient information, and flight plan for the authenticated crew within 3 seconds of receipt.
2. IF an authenticated user who is not assigned to the mission requests the EFB mission package, THEN THE EFB SHALL withhold the mission package and display an unauthorized-access indication.
3. WHILE a mission is active, THE EFB SHALL display live telemetry and current patient state received from the realtime channel, refreshing the displayed values at least once every 2 seconds when data is available.
4. WHILE the Golden Hour timer is running, THE EFB SHALL display the current Golden Hour elapsed time in HH:MM:SS format updated at least once per second, and the current patient GCS as an integer from 3 to 15.
5. WHEN a crew member records a scene arrival, scene departure, intervention, or status event in the EFB, THE EFB SHALL submit the event to the Clinical_Engine and Mission_Service with provenance identifying the recording crew member and the event timestamp.
6. IF submission of a crew-recorded event fails, THEN THE EFB SHALL retain the entered event data, display a submission-failure indication, and allow the crew member to retry the submission.
6a. WHEN a crew member records an event, THE EFB SHALL treat submission to the Clinical_Engine and submission to the Mission_Service as independent destinations, and IF submission to one destination fails while submission to the other destination succeeds, THEN THE EFB SHALL retain the event data and allow retry for only the failed destination, SHALL NOT resubmit to the destination that already succeeded, and SHALL display a partial-failure indication identifying the failed destination.
7. THE EFB SHALL provide interactive checklists and hospital helipad navigation and landing-zone briefing content for the assigned mission.
8. WHEN realtime telemetry or patient state has a data age greater than 10 seconds or is unavailable, THE EFB SHALL display the last-known values with an age indicator showing elapsed time since the last update and SHALL indicate the degraded state.

### Requirement 7: Automated After-Action Review

**User Story:** As a pilot, I want an automatic after-action review generated at touchdown, so that my mission is scored against documented flight, timing, and clinical criteria with auditable evidence.

Aligns with design Section 4.6 (AAR contract), Section 6.6 (AAR audit algorithm), and Correctness Property 6.

#### Acceptance Criteria

1. WHEN a touchdown event is recorded for a completed mission, THE AAR_Engine SHALL generate an after-action report for that mission within 30 seconds of the touchdown event.
2. WHEN the AAR_Engine generates a report, THE AAR_Engine SHALL compute telemetry coverage as a percentage, route efficiency as planned-versus-direct distance percentage, maximum absolute pitch in degrees, maximum absolute roll in degrees, touchdown G-force, destination reserve fuel in minutes, and scene time in minutes from the recorded telemetry and mission events.
3. WHEN the AAR_Engine evaluates compliance, THE AAR_Engine SHALL apply the audit thresholds of the effective Policy_Version (default targets: scene time no more than 15 minutes, route deviation no more than +10 percent, absolute pitch no more than 15 degrees, absolute roll no more than 30 degrees, destination reserve fuel at least 20 minutes VFR, touchdown G-force no more than 1.5 G) and record the Policy_Version in the report.
4. IF telemetry coverage is below 100 percent, touchdown detection is absent, or another evidence source is incomplete, THEN THE AAR_Engine SHALL record the specific coverage limitation in the report.
4a. THE AAR_Engine SHALL derive every reported metric solely from recorded telemetry and mission events, and SHALL NOT substitute a fabricated value for any reported metric, regardless of whether a coverage limitation exists.
5. WHEN the AAR_Engine completes a report, THE AAR_Engine SHALL persist the report as an immutable record and update the pilot logbook with the mission hours and outcome.
6. WHERE a touchdown is not detected from telemetry, THE Mission_Service SHALL permit an authorized manual completion event with recorded provenance and SHALL cause the report to mark the telemetry coverage limitation.

### Requirement 8: Security, Privacy, and Authorization

**User Story:** As a platform operator, I want authenticated access, row-level data isolation, and protected clinical and incident data, so that operational and simulated-patient information is handled with least privilege and full auditability.

Aligns with design Section 5.3 (authorization model) and Section 9 (Security, Privacy, and Safety Considerations).

#### Acceptance Criteria

1. WHEN a client requests an authenticated operational route or a Bridge opens a cloud session, THE Platform SHALL validate the presented authentication credential and grant access only if the credential is valid and unexpired within 5 seconds of the request.
2. IF a client requests an authenticated operational route or a Bridge opens a cloud session without a valid, unexpired authentication credential, THEN THE Platform SHALL deny access, return an error response indicating authentication is required, and grant no access to the requested resource.
3. THE Platform SHALL enforce PostgreSQL RLS so that a pilot can create, update, or delete only records where the record's owner identifier equals that pilot's identifier, for that pilot's profile and telemetry records.
4. WHERE an operational role is explicitly authorized for broader access, THE Platform SHALL permit that role to mutate records beyond the acting pilot's own profile and telemetry records, limited to the record scope defined for that role.
5. IF a pilot attempts to create, update, or delete a record whose owner identifier does not equal that pilot's identifier and the pilot holds no explicitly authorized operational role for that record, THEN THE Platform SHALL reject the mutation, return an error response indicating the operation is not authorized, and leave the target record unchanged.
6. THE Platform SHALL restrict patient, clinical, and VIRS records so that those records are never returned on public (unauthenticated) routes.
7. WHERE a public map or marketing route requests operational data, THE Platform SHALL return aggregate or de-identified operational data only, containing no patient, clinical, or VIRS record and no field that identifies an individual pilot, patient, or incident.
8. WHEN the Bridge transmits telemetry to the cloud, THE Bridge SHALL encrypt the transmission using TLS version 1.2 or higher and SHALL abort the transmission without sending telemetry if a TLS session cannot be established.
8a. IF a TLS session is established but negotiates a TLS version below 1.2, THEN THE Bridge SHALL treat the session as equivalent to a TLS session that cannot be established, SHALL abort the transmission, and SHALL send no telemetry over that session.
9. IF a simulated clinical text input contains a detectable real-world patient identifier, THEN THE Platform SHALL reject the input under the simulation-only data policy, return an error response indicating the input violates the simulation-only data policy, and persist none of the submitted input.
10. WHEN an actor performs authorization, mission state change, telemetry replay, clinical policy change, AI override, or report publication, THE Platform SHALL append one audit-log record identifying the actor, action, target, and timestamp within 5 seconds of the action completing.
11. IF appending an audit-log record fails for an authorization, mission state change, telemetry replay, clinical policy change, AI override, or report publication action, THEN THE Platform SHALL reject the associated action and return an error response indicating the action could not be recorded.
12. THE Platform SHALL keep service-role secrets out of the browser client bundle and out of the desktop bridge distributable package.

### Requirement 9: Degraded-State Behavior

**User Story:** As an operator relying on live data, I want clients to expose stale or degraded status honestly, so that no fabricated telemetry, clinical values, or recommendations are ever presented as authoritative.

Aligns with design Section 6.7 (Bridge and client degradation states) and Correctness Property 7.

#### Acceptance Criteria

1. WHILE the Bridge is connected, the cloud is connected, and the data age is 2 seconds or less, THE Platform SHALL present the service state as NOMINAL.
2. WHILE the Bridge is connected and the cloud is not connected, THE Platform SHALL present the service state as OFFLINE.
3. WHILE the cloud is connected and the data age is greater than 2 seconds and 10 seconds or less, THE Platform SHALL present the service state as DEGRADED.
4. WHILE the cloud is connected and the data age is greater than 10 seconds, THE Platform SHALL present the service state as STALE.
5. WHILE a reconnecting condition is active on the Bridge or cloud connection, THE Platform SHALL present the service state as RECOVERING.
6. WHEN a client displays operational data, THE Platform SHALL display the current service state and the last-known data timestamp, updating the displayed data age at least once every second.
7. THE Platform SHALL present a continuously visible indicator of the current service state on any client screen that displays operational data.
8. IF telemetry, weather, realtime, or AI briefing data is unavailable or has a data age greater than 10 seconds, THEN THE Platform SHALL disable actions that require authoritative current data, SHALL indicate why the action is unavailable, and SHALL NOT substitute fabricated telemetry, clinical values, or recommendations.
9. WHERE current weather is unavailable or has a data age greater than 10 seconds AND the effective policy requires current weather, THE Mission_Service SHALL prevent automatic GO authorization and SHALL indicate that current weather is required.

### Requirement 10: Public and Marketing Surfaces

**User Story:** As a prospective pilot or member of the public, I want public informational and onboarding pages, so that I can learn about the platform, its safety framework, its fleet, and how to download the bridge and register.

Aligns with design Section 3.5 (route and client surface) and the public and authentication routes in `APP-MAP.md`.

#### Acceptance Criteria

1. WHEN an unauthenticated visitor requests the landing, about, safety, fleet, network, downloads, or contact route, THE Web_Terminal SHALL serve the requested page within 3 seconds without prompting for or requiring authentication.
2. THE Web_Terminal SHALL publish a Safety Charter containing a Safety Management System framework section, a Crew Resource Management rules section, and a recurrent training requirements section.
3. THE Web_Terminal SHALL publish a public summary or table of contents of the Virtual HEMS Operations Manual listing each top-level module or section title.
4. WHEN a visitor requests the fleet page, THE Web_Terminal SHALL display all four approved airframes (EC135, EC145, H135, and Bell 407) each with its capability information.
5. WHEN a visitor requests the downloads page, THE Web_Terminal SHALL provide three downloadable artifacts: the Windows desktop bridge installer, the macOS desktop bridge installer, and the X-Plane Lua script.
6. WHEN a visitor completes registration and authentication, THE Web_Terminal SHALL redirect the authenticated pilot to the operations dashboard within 3 seconds.
7. IF a requested download artifact is unavailable, THEN THE Web_Terminal SHALL display an error indication for that artifact and SHALL continue to offer the remaining available artifacts.
8. THE Web_Terminal SHALL adopt one canonical form for authenticated operational routes and, WHERE the alternate documented path form is distinct from the canonical form, SHALL redirect any request to that alternate form to the canonical form.
8a. WHERE the alternate documented path form is identical to the canonical form, THE Web_Terminal SHALL treat the request as already canonical and SHALL NOT issue a redirect.

### Requirement 11: Non-Punitive Safety Reporting

**User Story:** As a crew member, I want a non-punitive incident reporting portal, so that I can report safety concerns confidentially without fear of exposure.

Aligns with design Section 3.2 (Safety/VIRS boundary), Section 5.1 (`virs_reports`), and the `/dashboard/sms-report` route in `APP-MAP.md`.

#### Acceptance Criteria

1. WHEN an authenticated crew member submits a VIRS incident report with a selected incident category and a narrative of 1 to 10,000 characters, THE Safety_Service SHALL persist the report with its incident category, narrative, submission timestamp, and access-control attributes under the non-punitive policy within 3 seconds, and SHALL display a confirmation status indicating successful submission.
2. IF a VIRS submission is received with no incident category selected, or with an empty narrative, or with a narrative exceeding 10,000 characters, THEN THE Safety_Service SHALL reject the submission, SHALL NOT persist the report, and SHALL display a validation error indicating which field is invalid while retaining the crew member's entered narrative for correction.
3. THE Safety_Service SHALL restrict retrieval of VIRS narratives to authenticated users holding the safety-reviewer access role, and SHALL NOT return VIRS narrative content on any unauthenticated or public route.
4. IF a VIRS submission fails due to a service or network error, THEN THE Safety_Service SHALL preserve the unsent report as a local draft for at least 24 hours where local storage is permitted, SHALL NOT transmit or expose the narrative on any public route, and SHALL display a submission-failure status indicating the report was not saved to the server.

## Open Items Carried From Design

The following design open decisions constrain acceptance criteria and must be resolved before the criteria are locked for implementation. Each is referenced by the requirements above through the effective Policy_Version:

1. The exact Golden Hour decay formula, whether transit time contributes to decay, and how interventions modify decay (affects Requirement 4).
2. Whether on-scene deterioration begins at a fixed 15-minute target or across a 10-to-15-minute operational window, including any airframe or mission exceptions (affects Requirements 4 and 7).
3. The canonical authenticated route form (`/command` versus `/dashboard/command`) and retained redirects (affects Requirement 10).
4. Whether optional telemetry fields such as TOT, rotor RPM, OAT, and touchdown G-force are mandatory across all adapters or optional with coverage flags (affects Requirements 1 and 7).
5. The PAVE scoring scale and the VFR/IFR fuel reserve policy, including airframe-specific performance rules (affects Requirement 3).
6. Ironpine AI explainability, human approval, provider, data residency, and failure fallback (affects Requirements 5 and 9).
7. The weather provider, freshness threshold, and METAR/TAF contract (affects Requirements 3 and 9).
