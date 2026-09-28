/**
 * Mission and dispatch contracts (design Section 4.4).
 */

import type { GeoPoint, Timestamp, Uuid } from "./telemetry.js";

export const MISSION_TYPES = ["SCENE_CALL", "INTER_FACILITY_TRANSFER"] as const;
export type MissionType = (typeof MISSION_TYPES)[number];

export const MISSION_STATUSES = [
  "DISPATCHED",
  "EN_ROUTE_SCENE",
  "ON_SCENE",
  "EN_ROUTE_HOSPITAL",
  "COMPLETED",
  "ABORTED",
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const PATIENT_PRIORITIES = [
  "PRIORITY_1",
  "PRIORITY_2",
  "PRIORITY_3",
] as const;
export type PatientPriority = (typeof PATIENT_PRIORITIES)[number];

export const PAVE_DISPOSITIONS = ["GO", "CONDITIONAL", "NO_GO"] as const;
export type PaveDisposition = (typeof PAVE_DISPOSITIONS)[number];

/**
 * Operational weather observation attached to a dispatch. The design references
 * `WeatherSnapshot` without fixing its full shape (design leaves detailed
 * weather modeling to later requirements); this captures the observation time
 * needed for the Stage 1 freshness gate plus commonly referenced fields.
 */
export interface WeatherSnapshot {
  observed_at: Timestamp;
  visibility_sm?: number;
  ceiling_ft?: number;
  wind_direction_deg?: number;
  wind_speed_kts?: number;
  temperature_c?: number;
  source?: string;
}

/** Crew roster (design Section 4.4). */
export interface CrewRoster {
  pilot_in_command_id: Uuid;
  flight_nurse_id?: Uuid;
  flight_paramedic_id?: Uuid;
}

/** Stage 1 dispatch details (design Section 4.4). */
export interface DispatchDetails {
  mission_type: MissionType;
  assigned_base_id: Uuid;
  assigned_airframe_id: Uuid;
  origin_hospital_id?: Uuid;
  scene_coordinates?: GeoPoint;
  destination_hospital_id: Uuid;
  weather_snapshot: WeatherSnapshot;
}

/** Stage 3 simulated patient input (design Section 4.4). */
export interface PatientInput {
  simulated_patient_id: Uuid;
  age_years: number;
  gender: string;
  weight_lbs: number;
  condition_id: Uuid;
  clinical_summary: string;
  interventions: string;
  baseline_gcs: number;
}

/** PAVE risk assessment (design Section 4.4). */
export interface PAVERisk {
  pilot_score: number;
  aircraft_score: number;
  environment_score: number;
  external_score: number;
  total_score: number;
  disposition: PaveDisposition;
  rationale: string[];
}

/** Stage 4 flight plan (design Section 4.4). */
export interface FlightPlan {
  route: GeoPoint[];
  direct_distance_nm: number;
  planned_distance_nm: number;
  estimated_fuel_burn_lbs: number;
  reserve_requirement_minutes: number;
  reserve_at_destination_minutes: number;
}

/** Fully assembled mission dispatch package (design Section 4.4). */
export interface MissionDispatch {
  mission_id: Uuid;
  mission_code: string;
  details: DispatchDetails;
  crew: CrewRoster;
  patient: PatientInput;
  risk: PAVERisk;
  flight_plan: FlightPlan;
  status: MissionStatus;
  authorization_code?: string;
}
