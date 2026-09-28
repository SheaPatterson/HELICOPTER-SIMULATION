/**
 * Optional bridge from telemetry ingestion to realtime fanout (requirement
 * 6.3, design Section 3.4).
 *
 * The ingestion core stays free of any realtime concern; this thin, optional
 * adapter maps a persisted/accepted frame onto the {@link AcceptedFrameView}
 * the fanout consumes and publishes the current asset state. The server
 * boundary calls this after `ingestTelemetry` returns an `accepted` ack — a
 * `duplicate` ack is an idempotent replay and does not re-broadcast.
 *
 * Kept separate so neither module imports the other's implementation: the
 * ingestion module knows nothing about realtime, and the fanout core knows
 * nothing about ingestion. Only this adapter (and the production wiring)
 * depends on both.
 */

import type { PersistedTelemetryFrame } from "../telemetry/ingestion.js";
import type {
  FlightVector,
  PositionVector,
  SystemsVector,
  Uuid,
} from "@virtualhems/contracts";
import type { AcceptedFrameView, FanoutResult, RealtimeFanout } from "./fanout.js";

/**
 * The operational payload the ingestion path holds after acceptance that is not
 * carried on {@link PersistedTelemetryFrame} (which is a persistence-key view).
 * The server boundary already has these values from the validated request, so
 * it supplies them here rather than the fanout re-reading the database.
 */
export interface AcceptedFrameContext {
  region: string;
  mission_id?: Uuid;
  position: PositionVector;
  flight: FlightVector;
  systems: SystemsVector;
}

/**
 * Map an accepted persisted frame plus its operational context onto the
 * fanout's {@link AcceptedFrameView}.
 */
export function toAcceptedFrameView(
  frame: PersistedTelemetryFrame,
  context: AcceptedFrameContext,
): AcceptedFrameView {
  const view: AcceptedFrameView = {
    pilot_id: frame.pilot_id,
    region: context.region,
    position: context.position,
    flight: context.flight,
    systems: context.systems,
    observed_at: frame.source_observed_at,
    received_at: frame.received_at,
    sequence_number: frame.sequence_number,
  };
  if (context.mission_id !== undefined) {
    view.mission_id = context.mission_id;
  }
  return view;
}

/**
 * Publish current asset state for an accepted frame via the given fanout. This
 * is the natural integration point on the ingestion path. Callers should invoke
 * it only for `accepted` frames, not idempotent `duplicate` replays.
 */
export async function publishAcceptedFrame(
  fanout: RealtimeFanout,
  frame: PersistedTelemetryFrame,
  context: AcceptedFrameContext,
): Promise<FanoutResult> {
  return fanout.broadcastAssetState(toAcceptedFrameView(frame, context));
}
