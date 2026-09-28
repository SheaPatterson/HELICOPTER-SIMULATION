/**
 * Infrastructure and AAR contracts (design Section 4.6).
 */

import type { GeoPoint, Timestamp, Uuid } from "./telemetry.js";

export const HELIPAD_SURFACES = [
  "CONCRETE",
  "ASPHALT",
  "MAT",
  "OTHER",
] as const;
export type HelipadSurface = (typeof HELIPAD_SURFACES)[number];

export const HELIPAD_PLACEMENTS = ["ROOFTOP", "GROUND"] as const;
export type HelipadPlacement = (typeof HELIPAD_PLACEMENTS)[number];

/** Helipad / landing-zone infrastructure record (design Section 4.6). */
export interface Helipad {
  id: Uuid;
  name: string;
  faa_id: string;
  city: string;
  state: string;
  elevation_ft: number;
  coordinates: GeoPoint;
  surface: HelipadSurface;
  placement: HelipadPlacement;
  dimensions_ft: string;
  capability: string;
}

/** Ironpine tactical briefing output (design Section 4.6). */
export interface TacticalBriefing {
  recommended_facility_id?: Uuid;
  recommended_lz?: GeoPoint;
  warnings: string[];
  assumptions: string[];
  input_snapshot_hash: string;
  generated_at: Timestamp;
  provenance: string;
}

/** Immutable after-action report (design Section 4.6). */
export interface AARReport {
  mission_id: Uuid;
  telemetry_coverage: number;
  route_efficiency_percent: number;
  max_pitch_deg: number;
  max_roll_deg: number;
  touchdown_g_force?: number;
  reserve_fuel_minutes: number;
  scene_time_minutes: number;
  clinical_outcome_summary: string;
  compliance_findings: string[];
  score: number;
  generated_at: Timestamp;
}
