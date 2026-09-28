/**
 * Realtime asset-state fanout boundary (design Section 3.4; requirement 6.3).
 *
 * Re-exports the pure fanout core, its channel-naming/authorization-scoping
 * functions, the injectable broadcaster port, and the in-memory reference
 * broadcaster used for tests and local wiring.
 */

export {
  OPERATIONAL_ROLES,
  isOperationalRole,
  RealtimeFanout,
  regionAssetsChannel,
  missionChannel,
  channelsForAssetState,
  channelsForMissionUpdate,
  canSubscribe,
  deriveAssetStateUpdate,
  deriveMissionUpdate,
  type OperationalRole,
  type AssetStateUpdate,
  type MissionUpdate,
  type RealtimeUpdate,
  type AcceptedFrameView,
  type MissionUpdateInput,
  type RealtimeBroadcaster,
  type FanoutResult,
  type SubscriberContext,
} from "./fanout.js";

export {
  InMemoryRealtimeBroadcaster,
  type PublishedMessage,
} from "./in-memory-broadcaster.js";

export {
  toAcceptedFrameView,
  publishAcceptedFrame,
  type AcceptedFrameContext,
} from "./ingestion-bridge.js";
