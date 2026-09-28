# Implementation Plan: Helicopter Simulation (Virtual HEMS)

## Overview

This plan converts the approved design (`design.md`) into an incremental, test-driven implementation sequence. It follows the documented language split confirmed for this spec:

- **TypeScript** (Next.js 14+ App Router, React) for the web command terminal, cloud/API boundaries, and the shared telemetry/dispatch/clinical/AAR contracts. Property-based tests use **fast-check** with the project test runner (Vitest/Jest).
- **Rust** (Tauri v2) for the desktop bridge, MSFS SimConnect and X-Plane UDP adapters, the SQLite offline ring buffer, and the TLS uplink. Property-based tests use **proptest**.

The build order moves from shared contracts and schema outward: contracts and database/RLS first, then the bridge and adapters, telemetry ingestion, the four-stage dispatcher, the clinical Golden Hour engine, spatial recommendation, the cockpit EFB, the AAR engine, security/RLS enforcement, degraded-state behavior, public surfaces, and safety reporting. Each task builds on prior ones and ends by wiring components into an integrated path. Property tests are placed next to the deterministic core they validate so errors surface early.

Every property test task references a specific correctness property (design "Correctness Properties" section) and the requirements clause it checks. Tasks marked with `*` are optional test sub-tasks and are not implemented by default.

## Tasks

- [x] 1. Establish monorepo foundation and shared contracts
  - [x] 1.1 Set up Turborepo workspace, package boundaries, and test tooling
    - Create the workspace layout (web app, cloud/API package, shared `contracts` package, Rust `bridge` crate) with TypeScript and Rust toolchains
    - Configure the TS test runner with fast-check and the Rust crate with proptest
    - Add lint/typecheck/build scripts wired into the Turborepo pipeline
    - _Requirements: 1.8_

  - [x] 1.2 Define shared telemetry, mission, clinical, and AAR contract types
    - Implement `SimulatorEngine`, `PositionVector`, `FlightVector`, `SystemsVector`, `TelemetryFrame`, mission/dispatch structures, clinical structures, and AAR structures from design Sections 4.1–4.6 as versioned TypeScript types with a `schema_version` constant
    - Mirror the telemetry contract in the Rust bridge crate so adapters and ingestion share one definition
    - Implement pure unit-conversion and normalization helpers used by adapters and ingestion
    - _Requirements: 1.1, 1.4, 4.8_

  - [x] 1.3 Write unit tests for contract normalization helpers
    - Test unit conversions, engine enumeration, and field-name normalization
    - _Requirements: 1.4_

- [x] 2. Create database schema, spatial model, and RLS policies
  - [x] 2.1 Author PostgreSQL/PostGIS schema and migrations
    - Create `profiles`, `hems_bases`, `hospitals`, `medical_conditions`, `missions`, `flight_telemetry`, `mission_events`, `clinical_snapshots`, `tactical_briefings`, `aar_reports`, `virs_reports`, and `audit_log` tables per design Section 5.1
    - Store geometry as `GEOGRAPHY(POINT, 4326)`, add GIST indexes for base/hospital/scene geometry, and index telemetry by mission and descending timestamp
    - Record source, observed, and cloud-receive timestamps as separate columns; use UTC and explicit schema version columns
    - _Requirements: 1.7, 5.6_

  - [x] 2.2 Implement RLS policies and role scoping
    - Add RLS so a pilot may mutate only records whose owner equals the pilot identifier for profile and telemetry records
    - Define explicit broader-access operational roles and their record scope
    - Restrict patient, clinical, and VIRS records from public routes; enforce idempotency uniqueness on `(pilot_id, session_id, sequence_number)` for telemetry
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 2.7_

  - [x] 2.3 Seed medical condition matrix and regional infrastructure
    - Seed `medical_conditions` with category, ICD reference, GCS range, RSI flag, decay rate, and required facility capability for each condition
    - Seed `hems_bases` and `hospitals` with FAA identifiers, elevation, helipad attributes, coordinates, and capability
    - _Requirements: 4.8, 5.6_

  - [x] 2.4 Write integration tests for RLS and spatial indexes
    - Test that unauthorized mutation is rejected and public queries exclude private records
    - Test PostGIS proximity/radial/elevation queries against known fixtures (e.g. PS78/KAXQ)
    - _Requirements: 8.3, 8.5, 8.6, 5.6_

- [x] 3. Checkpoint - contracts and schema
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement simulator adapters (Rust bridge)
  - [x] 4.1 Implement the SimulatorAdapter interface and X-Plane UDP adapter
    - Implement `connect`/`disconnect`/`sample`/`health` and the X-Plane FlyWithLua listener bound to `127.0.0.1:8080`, validating and mapping units into the shared contract
    - Identify the source engine as `XPLANE11`/`XPLANE12`; mark the source disconnected after 5 seconds without data and record a diagnostic
    - _Requirements: 1.4, 1.6, 1.8_

  - [x] 4.2 Implement the MSFS SimConnect adapter
    - Read SimConnect rotorcraft state, map units into the shared contract, and identify the engine as `MSFS2020`/`MSFS2024`
    - Reject unsupported engine/version with an actionable compatibility error without coercing unknown fields
    - _Requirements: 1.2, 1.4, 1.8_

  - [x] 4.3 Write unit tests for adapter mapping and source-loss handling
    - Test unit conversion, supported-engine mapping, malformed sample rejection, and 5-second source-loss detection
    - _Requirements: 1.2, 1.4, 1.6_

- [x] 5. Implement bridge runtime, offline queue, and TLS uplink (Rust)
  - [x] 5.1 Implement bridge runtime, sampling loop, and telemetry validation/normalization
    - Implement `BridgeRuntime` (`start`/`stop`/`register_adapter`/`connection_status`/`flush_offline_queue`), enforce a fixed configured sample rate of 2–10 Hz, and run the `ingest_sample` validation/normalization pipeline (design Section 6.1)
    - Reject invalid coordinates, non-finite values, out-of-range headings, unsupported engines, and sequence regressions (unless flagged replayed); assign sequence, timestamp, and schema version to accepted frames
    - Apply delta compression only after validation, retaining periodic full snapshots
    - _Requirements: 1.1, 1.3, 1.5_

  - [x] 5.2 Write property test for telemetry validity
    - **Property 1: Telemetry validity**
    - **Validates: Requirements 1.1, 1.3** — every accepted frame has a supported engine, finite values, schema version, timestamp, and strictly increasing session sequence; invalid frames are never published
    - _Requirements: 1.1, 1.3_

  - [x] 5.3 Implement the SQLite offline ring buffer and durable append
    - Persist each created frame durably before initiating transmission; retain unsent frames and events in ascending session-then-sequence order across restart
    - Apply the configured retention/backpressure policy at capacity with a durable diagnostic and user alert rather than silent discard
    - _Requirements: 2.1, 2.2, 2.8_

  - [x] 5.4 Implement offline replay with retry, backoff, and permanent-failure handling
    - Implement `replay_offline_queue` (design Section 6.2): begin replay within 5 seconds of uplink availability, remove frames only after acknowledgement, preserve order, apply 1–60s backoff up to 10 attempts, and retain permanent failures as diagnostics while continuing
    - _Requirements: 2.3, 2.4, 2.5, 2.6_

  - [x] 5.5 Write property test for durable delivery and replay idempotency/ordering
    - **Property 2: Durable delivery**
    - **Validates: Requirements 2.1, 2.4, 2.7** — a frame leaves the queue only after acknowledgement, remaining records stay in ascending session-then-sequence order, and replay is idempotent per pilot/session/sequence
    - _Requirements: 2.1, 2.4, 2.7_

  - [x] 5.6 Implement the TLS uplink client
    - Encrypt bridge-to-cloud traffic with TLS 1.2+; abort transmission and send no telemetry when a session cannot be established or negotiates below TLS 1.2
    - Reference API keys securely and keep no service-role secrets in the bridge package
    - _Requirements: 8.8, 8.8a, 8.12_

  - [x] 5.7 Write unit tests for TLS abort and queue capacity behavior
    - Test that sub-1.2 negotiation aborts transmission and that capacity backpressure records a diagnostic without discarding
    - _Requirements: 8.8, 8.8a, 2.8_

- [x] 6. Checkpoint - bridge, adapters, and offline durability
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement telemetry ingestion and realtime fanout (cloud/TS)
  - [x] 7.1 Implement the telemetry ingestion API and idempotent persistence
    - Authenticate and validate incoming frames server-side, persist with separate source and cloud-receive timestamps, and treat `(pilot_id, session_id, sequence_number)` collisions as idempotent, returning an acknowledgment equivalent to the original
    - Reject unsupported engines with a compatibility error that names the engine and leaves prior session state unchanged
    - _Requirements: 1.1, 1.2, 1.7, 2.7_

  - [x] 7.2 Implement realtime asset-state fanout
    - Broadcast current asset state and mission updates to authorized clients via the realtime channel, scoped by region, mission, and role
    - _Requirements: 6.3_

  - [x] 7.3 Write integration tests for ingestion and idempotency
    - Test MSFS and X-Plane fixtures mapping to one contract and duplicate-frame idempotency on replay
    - _Requirements: 1.1, 2.7_

- [x] 8. Implement the four-stage dispatch state machine (cloud/TS)
  - [x] 8.1 Implement Stage 1 Details and Stage 2 Crew validation
    - Implement `advance_dispatch` gating (design Section 6.3): validate mission type, existing base/airframe, non-identical existing origin/destination, and a weather snapshot ≤60 minutes old; on failure keep the next stage closed and return each failed field while retaining entered values
    - Validate exactly one PIC, a 2–6 member roster with no duplicates and each member assigned a role; on failure name each specific failed crew condition while retaining Stage 2 values
    - Permit advancement only to the current or a previously completed stage
    - _Requirements: 3.1, 3.2, 3.3, 3.3a, 3.8_

  - [x] 8.2 Implement Stage 3 Patient Info and Stage 4 Flight Plan
    - Validate simulated patient completeness, resolve the condition, and derive baseline GCS (3–15); calculate PAVE disposition and flight plan and verify reserve margin meets policy
    - _Requirements: 3.4, 3.5_

  - [x] 8.3 Implement mission authorization, gating enforcement, and audit events
    - Prevent DISPATCHED status and EFB delivery until all required checks pass; on success issue an authorization code, set DISPATCHED, and publish the mission package
    - Append one auditable mission event per stage/lifecycle transition recording source, target, and timestamp; require non-empty rationale for any training override before authorization
    - _Requirements: 3.6, 3.7, 3.9, 3.10_

  - [x] 8.4 Write property test for dispatch gating
    - **Property 3: Dispatch gating**
    - **Validates: Requirements 3.6, 3.7, 3.9** — a mission cannot reach DISPATCHED/EFB until details, crew, patient, PAVE disposition, flight plan, and reserve checks are valid, and each transition is auditable
    - _Requirements: 3.6, 3.7, 3.9_

  - [x] 8.5 Write unit tests for stage validation and override rules
    - Test per-field/per-condition error reporting, stage-advance restrictions, and override rationale enforcement
    - _Requirements: 3.2, 3.3a, 3.8, 3.10_

- [x] 9. Implement the clinical Golden Hour engine (cloud/TS)
  - [x] 9.1 Implement condition resolution and Golden Hour timer initiation
    - Initiate a 3600-second Golden Hour timer anchored to the dispatch event for scene calls; reject conditions missing category, GCS range, decay rate, or required capability
    - Validate condition categorization and single required receiving capability
    - _Requirements: 4.1, 4.8, 4.9_

  - [x] 9.2 Implement deterministic deterioration, GCS clamp, and monotonic state
    - Implement `update_patient_state` (design Section 6.4): compute elapsed Golden Hour and scene time deterministically in whole seconds by Policy_Version, apply the decay penalty once per whole minute beyond the configurable scene target (default 1200s, range 300–3600s), clamp GCS to 3–15, set the deteriorated flag, reject out-of-order events, and record the Policy_Version
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 9.3 Write property test for clinical monotonicity
    - **Property 4: Clinical monotonicity**
    - **Validates: Requirements 4.2, 4.4, 4.6** — elapsed time and derived state advance monotonically by policy version, GCS stays within 3–15, and identical inputs yield identical deterministic state
    - _Requirements: 4.2, 4.4, 4.6_

  - [x] 9.4 Write unit tests for decay boundaries and condition validation
    - Test scene-target boundary, per-minute penalty granularity, deteriorated-flag logic, and incomplete-condition rejection
    - _Requirements: 4.3, 4.5, 4.9_

- [x] 10. Checkpoint - ingestion, dispatch, and clinical core
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement spatial facility recommendation (cloud/TS)
  - [x] 11.1 Implement eligibility filtering and deterministic ordering
    - Implement `recommend_facility` (design Section 6.5): include a facility only when capability matches, helipad is operational under current weather, and route is permissible; treat missing helipad/weather/route data as ineligible and record it in provenance
    - Order eligible facilities by descending suitability score, then ascending distance, then ascending facility identifier for stable output; never select solely by nearest
    - Return an explicit no-match result requiring authorized human selection or mission hold when nothing qualifies
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.8_

  - [x] 11.2 Implement provenance records and Ironpine fallback
    - Attach evaluated capability, helipad status, weather observation, route-constraint result, and score to each recommendation
    - When the Ironpine briefing boundary is unavailable, return deterministic spatial-only results and mark AI output absent
    - _Requirements: 5.2, 5.7_

  - [x] 11.3 Write property test for recommendation safety
    - **Property 5: Recommendation safety**
    - **Validates: Requirements 5.1, 5.3, 5.4** — every recommended facility satisfies all applicable constraints or the service returns an explicit no-match, never silently selecting an unsafe facility
    - _Requirements: 5.1, 5.3, 5.4_

  - [x] 11.4 Write unit tests for ordering determinism and ineligibility
    - Test tie-breaking order and missing-input ineligibility with provenance
    - _Requirements: 5.5, 5.8_

- [x] 12. Implement degraded-state derivation and shared status client (TS)
  - [x] 12.1 Implement service-state derivation and status indicators
    - Implement `derive_user_visible_status` (design Section 6.7) producing NOMINAL, OFFLINE, DEGRADED, STALE, RECOVERING per the documented age thresholds
    - Display current state and last-known timestamp with data age updating at least once per second, a continuously visible indicator, disabled actions when data is unavailable/stale, and no fabricated values; block automatic GO when required current weather is unavailable/stale
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

  - [x] 12.2 Write property test for degraded-state honesty
    - **Property 7: Degraded-state honesty**
    - **Validates: Requirements 9.1, 9.3, 9.4, 9.8** — derived state matches the age/connection thresholds and clients never substitute fabricated telemetry, clinical values, or recommendations when services are unavailable
    - _Requirements: 9.1, 9.3, 9.4, 9.8_

- [x] 13. Implement the cockpit EFB (web/TS)
  - [x] 13.1 Implement authorized mission-package display and live state
    - Display the authorized mission package (details, crew, patient, flight plan) to assigned crew within 3 seconds; withhold and show an unauthorized indication for non-assigned users
    - Refresh live telemetry and patient state at least every 2 seconds when available; render the Golden Hour timer in HH:MM:SS at least once per second and GCS as an integer 3–15; show last-known values with an age indicator when data age exceeds 10 seconds
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.8_

  - [x] 13.2 Implement crew event capture, checklists, and independent-destination submission
    - Provide interactive checklists and helipad navigation/LZ briefing content; submit scene arrival/departure/intervention/status events with recording-crew and timestamp provenance to the Clinical_Engine and Mission_Service as independent destinations
    - On partial failure, retain event data, retry only the failed destination, never resubmit the succeeded one, and show a partial-failure indication naming the failed destination
    - _Requirements: 6.5, 6.6, 6.6a, 6.7_

  - [x] 13.3 Write unit tests for authorization gating and partial-failure retry
    - Test unauthorized-access withholding and independent-destination retry semantics
    - _Requirements: 6.2, 6.6a_

- [x] 14. Implement the AAR engine (cloud/TS)
  - [x] 14.1 Implement metric derivation and no-fabrication guarantee
    - Implement `generate_aar` (design Section 6.6): on a touchdown event generate the report within 30 seconds, computing telemetry coverage, route efficiency, max absolute pitch/roll, touchdown G-force, destination reserve minutes, and scene minutes solely from recorded telemetry and events
    - Record specific coverage limitations when evidence is incomplete and never substitute a fabricated value; permit an authorized manual completion event that marks the telemetry coverage limitation
    - _Requirements: 7.1, 7.2, 7.4, 7.4a, 7.6_

  - [x] 14.2 Implement compliance scoring, immutable persistence, and logbook update
    - Apply effective Policy_Version audit thresholds, record the Policy_Version, persist the report immutably, and update the pilot logbook with mission hours and outcome
    - _Requirements: 7.3, 7.5_

  - [x] 14.3 Write property test for auditability
    - **Property 6: Auditability**
    - **Validates: Requirements 7.2, 7.4a, 7.3** — every reported metric derives solely from recorded evidence, no value is fabricated regardless of coverage, and the report retains Policy_Version context
    - _Requirements: 7.2, 7.4a, 7.3_

  - [x] 14.4 Write integration test for touchdown-to-report flow
    - Test AAR generation from a touchdown fixture including incomplete-coverage behavior
    - _Requirements: 7.1, 7.4_

- [x] 15. Checkpoint - recommendation, EFB, AAR, and degraded state
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement authentication, authorization, and audit enforcement (cloud/TS)
  - [x] 16.1 Implement credential validation and audit logging
    - Validate presented credentials within 5 seconds and deny access without a valid, unexpired credential; reject clinical text containing detectable real-world patient identifiers under the simulation-only policy
    - Append one audit-log record (actor, action, target, timestamp) within 5 seconds for authorization, mission state change, telemetry replay, clinical policy change, AI override, and report publication; reject the associated action when the audit append fails
    - _Requirements: 8.1, 8.2, 8.9, 8.10, 8.11_

  - [x] 16.2 Write unit/integration tests for auth denial and audit-failure rollback
    - Test unauthenticated denial, simulation-only rejection, and action rejection when audit append fails
    - _Requirements: 8.2, 8.9, 8.11_

- [x] 17. Implement public and marketing surfaces (web/TS)
  - [x] 17.1 Implement public pages and canonical route redirects
    - Serve landing, about, safety, fleet, network, downloads, and contact pages within 3 seconds without authentication; publish the Safety Charter (SMS, CRM, recurrent training sections) and the Operations Manual table of contents
    - Display all four approved airframes (EC135, EC145, H135, Bell 407) with capability info; offer Windows installer, macOS installer, and X-Plane Lua script, showing an error for any unavailable artifact while offering the rest
    - Adopt one canonical authenticated route form and redirect a distinct alternate form to it; treat an identical alternate form as already canonical without a redirect
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8, 10.8a_

  - [x] 17.2 Implement registration and post-auth redirect
    - Redirect an authenticated pilot to the operations dashboard within 3 seconds after registration/authentication; ensure public routes return only aggregate or de-identified operational data
    - _Requirements: 10.6, 8.7_

  - [x] 17.3 Write unit tests for route canonicalization and public de-identification
    - Test distinct-alternate redirect, identical-alternate no-redirect, and public-route data de-identification
    - _Requirements: 10.8, 10.8a, 8.7_

- [x] 18. Implement non-punitive safety reporting (cloud + web/TS)
  - [x] 18.1 Implement VIRS submission, validation, and access control
    - Persist a valid VIRS report (category, 1–10,000 char narrative, timestamp, access-control attributes) within 3 seconds with a confirmation; reject missing category, empty narrative, or over-length narrative with a field-specific validation error while retaining the entered narrative
    - Restrict VIRS narrative retrieval to the safety-reviewer role and never expose it on public routes; on service/network failure preserve a local draft for at least 24 hours without public exposure and show a not-saved status
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 18.2 Write unit tests for VIRS validation and reviewer-only retrieval
    - Test validation branches, reviewer-only access, and draft preservation on failure
    - _Requirements: 11.2, 11.3, 11.4_

- [x] 19. Integration and end-to-end wiring
  - [x] 19.1 Wire the full mission lifecycle path
    - Connect simulator fixture → bridge → normalized telemetry → ingestion → realtime map/EFB → four-stage dispatch → authorized EFB package → scene events → clinical deterioration → touchdown → AAR → logbook/archive update
    - _Requirements: 1.1, 2.4, 3.7, 4.2, 6.1, 7.1_

  - [x] 19.2 Write end-to-end integration tests for the lifecycle and fault recovery
    - Test the full dispatch-to-AAR journey, network-fault buffering with lossless idempotent replay, a 20-minute scene-delay deterioration, and the RLS role matrix
    - _Requirements: 2.4, 3.7, 4.2, 7.1, 8.3, 8.5_

- [x] 20. Final checkpoint - full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirement clauses for traceability.
- Checkpoints ensure incremental validation at natural boundaries.
- Property tests validate the seven universal correctness properties of the deterministic core and are placed next to the implementation they check.
- Unit and integration tests validate specific examples, boundaries, and error conditions.
- Language split: TypeScript for web/cloud/contracts (fast-check for property tests); Rust for the bridge/adapters and SQLite offline queue (proptest for property tests).
- Open decisions in design Section 13 and the requirements "Open Items" list are represented through the effective Policy_Version; resolving them refines thresholds without changing task structure.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "4.1", "4.2"] },
    { "id": 4, "tasks": ["2.4", "4.3", "5.1", "7.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "7.2", "7.3", "8.1"] },
    { "id": 6, "tasks": ["5.4", "5.7", "8.2", "8.5", "9.1"] },
    { "id": 7, "tasks": ["5.5", "5.6", "8.3", "9.2", "9.4", "11.1"] },
    { "id": 8, "tasks": ["8.4", "9.3", "11.2", "11.4", "12.1", "16.1"] },
    { "id": 9, "tasks": ["11.3", "12.2", "13.1", "14.1", "16.2", "17.1"] },
    { "id": 10, "tasks": ["13.2", "14.2", "17.2", "18.1"] },
    { "id": 11, "tasks": ["13.3", "14.3", "14.4", "17.3", "18.2", "19.1"] },
    { "id": 12, "tasks": ["19.2"] }
  ]
}
```
