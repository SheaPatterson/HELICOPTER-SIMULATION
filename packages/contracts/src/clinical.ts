/**
 * Clinical contracts (design Section 4.5).
 */

import type { Timestamp, Uuid } from "./telemetry.js";

export const MEDICAL_CONDITION_CATEGORIES = [
  "TRAUMA",
  "CARDIAC",
  "STROKE",
  "NEURO",
  "OB",
  "PEDIATRIC",
  "ENVIRONMENTAL",
  "OTHER",
] as const;
export type MedicalConditionCategory =
  (typeof MEDICAL_CONDITION_CATEGORIES)[number];

export const CLINICAL_EVENT_TYPES = [
  "DISPATCHED",
  "ARRIVED_SCENE",
  "DEPARTED_SCENE",
  "INTERVENTION",
  "TOUCHDOWN",
  "ABORTED",
] as const;
export type ClinicalEventType = (typeof CLINICAL_EVENT_TYPES)[number];

export const CLINICAL_EVENT_SOURCES = ["USER", "TELEMETRY", "SYSTEM"] as const;
export type ClinicalEventSource = (typeof CLINICAL_EVENT_SOURCES)[number];

/** Medical condition matrix entry (design Section 4.5). */
export interface MedicalCondition {
  id: Uuid;
  icd_code?: string;
  name: string;
  category: MedicalConditionCategory;
  baseline_gcs_min: number;
  baseline_gcs_max: number;
  requires_rsi: boolean;
  decay_rate_per_minute: number;
  target_facility_type: string;
}

/** Derived patient state (design Section 4.5). */
export interface PatientState {
  mission_id: Uuid;
  baseline_gcs: number;
  current_gcs: number;
  elapsed_golden_hour_seconds: number;
  elapsed_scene_seconds: number;
  physiological_flags: string[];
  deteriorated: boolean;
  updated_at: Timestamp;
}

/** A recorded clinical/lifecycle event (design Section 4.5). */
export interface ClinicalEvent {
  mission_id: Uuid;
  event_type: ClinicalEventType;
  occurred_at: Timestamp;
  source: ClinicalEventSource;
  metadata: Record<string, string>;
}
