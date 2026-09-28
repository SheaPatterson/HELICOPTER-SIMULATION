"use client";

/**
 * `useEfbLiveState` — the cockpit EFB realtime hook (task 13.1; Requirements
 * 6.3, 6.4, 6.8).
 *
 * This is the ONLY place in the EFB that owns timing and transport wiring; all
 * derivation is delegated to the pure `resolveLiveState` core so the timing
 * contract stays thin and the logic stays testable.
 *
 * Timing / refresh contract (documented per the task):
 *  - It subscribes to the mission's realtime channel via the injected
 *    {@link EfbRealtimeTransport} (Supabase-backed in production; in-memory in
 *    tests/local). Each asset-state / patient-state message updates the
 *    most-recent data the hook holds (Requirement 6.3 "when data is available").
 *  - A single interval timer ticks every {@link GOLDEN_HOUR_TICK_INTERVAL_MS}
 *    (1s). Because 1s <= 2s, this one timer satisfies BOTH the >= 2s live
 *    refresh (6.3) AND the >= 1s Golden Hour advance (6.4): on every tick the
 *    hook re-derives the view with the current wall-clock, so ages, the HH:MM:SS
 *    timer, and the degraded indicator all advance at least once per second.
 *  - New messages also trigger an immediate re-derive so a fresh value is shown
 *    without waiting for the next tick.
 *
 * The hook never fabricates values: it only stores what the transport delivers
 * and hands it to `resolveLiveState`, which tags provenance (Requirement 6.8).
 */

import { useEffect, useRef, useState } from "react";
import type { PatientState } from "@virtualhems/contracts";
import type { AssetStateUpdate } from "@virtualhems/cloud";
import {
  GOLDEN_HOUR_TICK_INTERVAL_MS,
  resolveLiveState,
  type EfbLiveInput,
  type EfbLiveStateView,
  type EfbRealtimeTransport,
  type EfbTransportConnection,
} from "@/lib/efb";

/** The mutable most-recent-data snapshot the hook maintains across ticks. */
interface LiveSnapshot {
  asset?: AssetStateUpdate;
  assetReceivedAtMs?: number;
  patient?: PatientState;
  patientReceivedAtMs?: number;
  connection: EfbTransportConnection;
}

/** Options for {@link useEfbLiveState}. */
export interface UseEfbLiveStateOptions {
  missionId: string;
  transport: EfbRealtimeTransport;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Tick cadence override for tests; defaults to the 1s Golden Hour cadence. */
  tickIntervalMs?: number;
}

/**
 * Subscribe to live telemetry / patient state for `missionId` and return the
 * render-ready {@link EfbLiveStateView}, re-derived on every message and at
 * least once per second (Requirements 6.3, 6.4, 6.8).
 */
export function useEfbLiveState(
  options: UseEfbLiveStateOptions,
): EfbLiveStateView {
  const { missionId, transport } = options;
  const now = options.now ?? Date.now;
  const tickIntervalMs = options.tickIntervalMs ?? GOLDEN_HOUR_TICK_INTERVAL_MS;

  // The snapshot is held in a ref so message callbacks mutate it without
  // re-subscribing; the interval/message handlers publish a derived view.
  const snapshotRef = useRef<LiveSnapshot>({
    connection: { bridgeConnected: false, cloudConnected: false },
  });

  const [view, setView] = useState<EfbLiveStateView>(() =>
    deriveFrom(snapshotRef.current, now()),
  );

  useEffect(() => {
    const republish = (): void => {
      setView(deriveFrom(snapshotRef.current, now()));
    };

    const unsubscribe = transport.subscribe(
      missionId,
      (message) => {
        const receivedAtMs = now();
        if (message.kind === "ASSET_STATE") {
          snapshotRef.current.asset = message;
          snapshotRef.current.assetReceivedAtMs = receivedAtMs;
        } else if (message.kind === "MISSION_UPDATE" && message.patient_state) {
          snapshotRef.current.patient = message.patient_state;
          snapshotRef.current.patientReceivedAtMs = receivedAtMs;
        }
        republish();
      },
      (connection) => {
        snapshotRef.current.connection = connection;
        republish();
      },
    );

    // One timer at the Golden Hour cadence (1s) satisfies both the >= 1s timer
    // advance (6.4) and the >= 2s live refresh (6.3).
    const timer = setInterval(republish, tickIntervalMs);

    // Immediate first derive after subscribing.
    republish();

    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [missionId, transport, now, tickIntervalMs]);

  return view;
}

/** Map the mutable snapshot to the pure {@link EfbLiveInput} and derive. */
function deriveFrom(snapshot: LiveSnapshot, nowMs: number): EfbLiveStateView {
  const input: EfbLiveInput = {
    asset: snapshot.asset,
    assetReceivedAtMs: snapshot.assetReceivedAtMs,
    patient: snapshot.patient,
    patientReceivedAtMs: snapshot.patientReceivedAtMs,
    bridge: {
      connected: snapshot.connection.bridgeConnected,
      reconnecting: snapshot.connection.bridgeReconnecting,
    },
    cloud: {
      connected: snapshot.connection.cloudConnected,
      reconnecting: snapshot.connection.cloudReconnecting,
    },
  };
  return resolveLiveState(input, nowMs);
}
