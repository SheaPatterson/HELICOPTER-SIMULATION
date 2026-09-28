/**
 * EFB realtime transport seam (task 13.1; Requirement 6.3).
 *
 * The cockpit EFB subscribes to live telemetry (asset state) and patient-state
 * updates over a realtime channel. The live Supabase Realtime wiring lands in a
 * later task; this module defines the transport-agnostic INTERFACE the React
 * hook depends on, plus an in-memory implementation used for local rendering
 * and tests. Keeping the transport behind an interface lets the EFB render and
 * be exercised without a live backend, and lets the production adapter be swapped
 * in without touching the UI.
 *
 * The payload shapes reuse the cloud fanout contracts (`AssetStateUpdate`,
 * `MissionUpdate`) from task 7.2 so the client and the fanout agree on one shape.
 */

import type { AssetStateUpdate, MissionUpdate } from "@virtualhems/cloud";

/** A realtime message the EFB consumes: an asset-state or a mission update. */
export type EfbRealtimeMessage = AssetStateUpdate | MissionUpdate;

/** Callback invoked for each realtime message delivered to a subscriber. */
export type EfbRealtimeListener = (message: EfbRealtimeMessage) => void;

/** Connection state the transport reports to the client. */
export interface EfbTransportConnection {
  bridgeConnected: boolean;
  cloudConnected: boolean;
  bridgeReconnecting?: boolean;
  cloudReconnecting?: boolean;
}

/** Callback invoked when the transport connection state changes. */
export type EfbConnectionListener = (connection: EfbTransportConnection) => void;

/**
 * Transport-agnostic realtime subscription for the cockpit EFB (Requirement
 * 6.3). Production backs this with Supabase Realtime scoped to the mission
 * channel; tests/local wiring use {@link InMemoryEfbRealtimeTransport}. The EFB
 * hook never constructs a Supabase client directly, so it stays swappable.
 */
export interface EfbRealtimeTransport {
  /**
   * Subscribe to the mission's realtime channel. Returns an unsubscribe
   * function the client calls on teardown. `onMessage` receives each asset/
   * mission update; `onConnection` receives connection-state changes.
   */
  subscribe(
    missionId: string,
    onMessage: EfbRealtimeListener,
    onConnection: EfbConnectionListener,
  ): () => void;
}

/**
 * In-memory realtime transport for local rendering and unit tests. Lets a test
 * or a local harness push asset/mission updates and connection changes to
 * subscribers deterministically, with no network. The production Supabase-backed
 * transport implements the same {@link EfbRealtimeTransport} interface.
 */
export class InMemoryEfbRealtimeTransport implements EfbRealtimeTransport {
  private messageListeners = new Map<string, Set<EfbRealtimeListener>>();
  private connectionListeners = new Map<string, Set<EfbConnectionListener>>();

  subscribe(
    missionId: string,
    onMessage: EfbRealtimeListener,
    onConnection: EfbConnectionListener,
  ): () => void {
    if (!this.messageListeners.has(missionId)) {
      this.messageListeners.set(missionId, new Set());
      this.connectionListeners.set(missionId, new Set());
    }
    this.messageListeners.get(missionId)!.add(onMessage);
    this.connectionListeners.get(missionId)!.add(onConnection);

    return () => {
      this.messageListeners.get(missionId)?.delete(onMessage);
      this.connectionListeners.get(missionId)?.delete(onConnection);
    };
  }

  /** Push a realtime message to all subscribers of `missionId` (test/local use). */
  emitMessage(missionId: string, message: EfbRealtimeMessage): void {
    for (const listener of this.messageListeners.get(missionId) ?? []) {
      listener(message);
    }
  }

  /** Push a connection-state change to all subscribers of `missionId`. */
  emitConnection(missionId: string, connection: EfbTransportConnection): void {
    for (const listener of this.connectionListeners.get(missionId) ?? []) {
      listener(connection);
    }
  }
}
