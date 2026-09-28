"use client";

/**
 * Cockpit EFB client component (task 13.1; Requirements 6.1, 6.2, 6.3, 6.4, 6.8).
 *
 * Presentational shell. It renders the resolved mission-package view and the
 * live-state view; ALL decisions live in the pure core:
 *  - {@link resolveEfbMissionView} decides authorized-package vs. unauthorized
 *    indication (6.1/6.2).
 *  - {@link useEfbLiveState} + `resolveLiveState` provide the refreshing live
 *    telemetry / Golden Hour / GCS / degraded view (6.3/6.4/6.8).
 *
 * This component intentionally contains no authorization or derivation logic of
 * its own so the testable contract stays in the pure modules.
 */

import type { ReactNode } from "react";
import type { Helipad, MissionDispatch } from "@virtualhems/contracts";
import {
  formatDataAge,
  type LastKnownValue,
} from "@virtualhems/contracts";
import {
  resolveEfbMissionView,
  type EfbRealtimeTransport,
  type EfbViewer,
  type EventDestinationPorts,
  type PresentedField,
} from "@/lib/efb";
import { useEfbLiveState } from "./use-efb-live-state";
import { CrewEventCapture } from "./CrewEventCapture";
import { ChecklistBriefingPanel } from "./ChecklistBriefingPanel";

export interface EfbClientProps {
  mission: MissionDispatch;
  viewer: EfbViewer;
  transport: EfbRealtimeTransport;
  /**
   * Independent-destination ports (Clinical_Engine, Mission_Service) for
   * crew-event submission (Requirements 6.5, 6.6, 6.6a). Optional so the shell
   * renders without the event control until the adapters are wired.
   */
  eventPorts?: EventDestinationPorts;
  /**
   * The assigned mission's destination helipad, for the navigation / LZ
   * briefing (Requirement 6.7). Optional; the briefing states unavailable when
   * absent rather than fabricating content.
   */
  destinationHelipad?: Helipad | null;
}

export function EfbClient({
  mission,
  viewer,
  transport,
  eventPorts,
  destinationHelipad,
}: EfbClientProps): ReactNode {
  const view = resolveEfbMissionView(mission, viewer);

  if (!view.authorized) {
    // Requirement 6.2: withhold the package, show an unauthorized indication.
    return (
      <main aria-label="Cockpit EFB">
        <section role="alert" aria-label="Unauthorized access">
          <h1>Access withheld</h1>
          <p>{view.reason}</p>
          <p>Requested mission: {view.requested_mission_id}</p>
        </section>
      </main>
    );
  }

  const pkg = view.package;

  return (
    <main aria-label="Cockpit EFB">
      <header>
        <h1>Mission {pkg.mission_code}</h1>
        <p>Status: {pkg.status}</p>
        <p>Your seat: {pkg.viewer_seat}</p>
        {pkg.authorization_code ? (
          <p>Authorization: {pkg.authorization_code}</p>
        ) : null}
      </header>

      <LiveStatePanel missionId={pkg.mission_id} transport={transport} />

      <section aria-label="Mission details">
        <h2>Details</h2>
        <dl>
          <dt>Type</dt>
          <dd>{pkg.details.mission_type}</dd>
          <dt>Destination hospital</dt>
          <dd>{pkg.details.destination_hospital_id}</dd>
        </dl>
      </section>

      <section aria-label="Assigned crew">
        <h2>Crew</h2>
        <ul>
          <li>PIC: {pkg.crew.pilot_in_command_id}</li>
          {pkg.crew.flight_nurse_id ? (
            <li>Flight nurse: {pkg.crew.flight_nurse_id}</li>
          ) : null}
          {pkg.crew.flight_paramedic_id ? (
            <li>Flight paramedic: {pkg.crew.flight_paramedic_id}</li>
          ) : null}
        </ul>
      </section>

      <section aria-label="Simulated patient">
        <h2>Patient</h2>
        <dl>
          <dt>Age</dt>
          <dd>{pkg.patient.age_years}</dd>
          <dt>Baseline GCS</dt>
          <dd>{pkg.patient.baseline_gcs}</dd>
          <dt>Clinical summary</dt>
          <dd>{pkg.patient.clinical_summary}</dd>
        </dl>
      </section>

      <section aria-label="Flight plan">
        <h2>Flight plan</h2>
        <dl>
          <dt>Planned distance</dt>
          <dd>{pkg.flight_plan.planned_distance_nm} nm</dd>
          <dt>Reserve at destination</dt>
          <dd>{pkg.flight_plan.reserve_at_destination_minutes} min</dd>
          <dt>PAVE disposition</dt>
          <dd>{pkg.risk.disposition}</dd>
        </dl>
      </section>

      {/* Requirement 6.7: interactive checklists + helipad navigation / LZ briefing. */}
      <ChecklistBriefingPanel destinationHelipad={destinationHelipad} />

      {/* Requirements 6.5/6.6/6.6a: crew-event capture to both independent destinations. */}
      {eventPorts ? (
        <CrewEventCapture
          missionId={pkg.mission_id}
          recordingCrewId={viewer.viewer_id}
          ports={eventPorts}
        />
      ) : null}
    </main>
  );
}

/** Live telemetry / patient-state panel driven by the realtime hook. */
function LiveStatePanel({
  missionId,
  transport,
}: {
  missionId: string;
  transport: EfbRealtimeTransport;
}): ReactNode {
  const live = useEfbLiveState({ missionId, transport });

  return (
    <section aria-label="Live state">
      {/* Requirement 6.8: continuously-visible degraded/state indicator. */}
      <p aria-label="Service state" data-degraded={live.degraded}>
        Service: {live.serviceState}
        {live.degraded ? " (showing last-known values)" : null}
      </p>

      {/* Requirement 6.4: Golden Hour HH:MM:SS + GCS integer 3–15. */}
      <div aria-label="Golden Hour">
        <span>Golden Hour: </span>
        <time aria-label="Golden Hour elapsed">{live.goldenHourDisplay}</time>
        <ValueProvenance value={live.goldenHour} />
      </div>
      <div aria-label="Patient GCS">
        <span>GCS: </span>
        {live.gcsDisplay === null ? (
          <span aria-label="GCS unavailable">—</span>
        ) : (
          <span aria-label="GCS value">{live.gcsDisplay}</span>
        )}
        <ValueProvenance value={live.gcs} />
      </div>

      {/* Requirement 6.3: live telemetry, refreshed by the hook. */}
      <ul aria-label="Telemetry">
        {live.telemetry.map((field) => (
          <TelemetryRow key={field.key} field={field} />
        ))}
      </ul>
    </section>
  );
}

function TelemetryRow({ field }: { field: PresentedField }): ReactNode {
  return (
    <li aria-label={field.label}>
      <span>{field.label}: </span>
      {field.value.value === null ? (
        <span aria-label="unavailable">—</span>
      ) : (
        <span>
          {field.value.value} {field.unit}
        </span>
      )}
      <ValueProvenance value={field.value} />
    </li>
  );
}

/**
 * Render a value's provenance (Requirement 6.8). For a last-known value it shows
 * the age indicator; for unavailable it says so; for live it renders nothing.
 * Never fabricates a value — it only annotates provenance the core provided.
 */
function ValueProvenance({ value }: { value: LastKnownValue<unknown> }): ReactNode {
  if (value.source === "LAST_KNOWN" && value.ageSeconds !== null) {
    return (
      <small aria-label="last-known age">
        {" "}
        (last known {formatDataAge(value.ageSeconds)} ago)
      </small>
    );
  }
  if (value.source === "UNAVAILABLE") {
    return <small aria-label="unavailable"> (unavailable)</small>;
  }
  return null;
}
