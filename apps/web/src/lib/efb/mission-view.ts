/**
 * Cockpit EFB mission-package view resolution (design Section 3.2 "Cockpit EFB",
 * Section 4.4; task 13.1; Requirements 6.1, 6.2).
 *
 * This module is the PURE, transport-free, framework-free core of the cockpit
 * EFB. It owns the authorization decision — "may this authenticated viewer see
 * this mission package?" — and the shape of the view the React layer renders.
 * It never touches React, the network, timers, or the DOM, so the whole
 * authorization/derivation contract is directly unit-testable (task 13.3 is the
 * dedicated gating test task; this file carries the logic under test).
 *
 * Requirement mapping:
 *  - 6.1: an ASSIGNED crew member (PIC / flight nurse / flight paramedic) sees
 *         the authorized package — mission details, assigned crew, simulated
 *         patient info, and flight plan. The realtime/latency budget (within 3s
 *         of receipt) is a client-transport concern; this pure resolver decides
 *         WHAT is shown once the package is in hand.
 *  - 6.2: an authenticated viewer who is NOT assigned to the mission gets an
 *         explicit unauthorized-indication result and NONE of the package
 *         fields. The package is withheld structurally: an unauthorized result
 *         carries no mission data at all, so a caller cannot accidentally render
 *         withheld fields.
 */

import type {
  MissionDispatch,
  CrewRoster,
  DispatchDetails,
  PatientInput,
  FlightPlan,
  PAVERisk,
  MissionStatus,
  Uuid,
} from "@virtualhems/contracts";

/**
 * The authenticated viewer requesting the EFB mission package. Authorization is
 * decided purely from the viewer's identity against the mission crew roster;
 * operational roles (instructor/admin broad visibility) are intentionally NOT
 * granted package access here — the EFB package is the assigned crew's cockpit
 * view (Requirement 6.1/6.2). Broader operational visibility is a separate
 * command-terminal concern (realtime fanout, design Section 5.3).
 */
export interface EfbViewer {
  /** The authenticated viewer's profile id. */
  viewer_id: Uuid;
}

/** The crew seat a viewer occupies on a mission, when assigned. */
export const CREW_SEATS = [
  "PILOT_IN_COMMAND",
  "FLIGHT_NURSE",
  "FLIGHT_PARAMEDIC",
] as const;
export type CrewSeat = (typeof CREW_SEATS)[number];

/**
 * The authorized mission package a viewer sees when assigned (Requirement 6.1).
 * Reuses the shared contract sub-structures verbatim rather than re-modeling
 * them, so the EFB and dispatcher agree on one shape.
 */
export interface AuthorizedMissionPackage {
  mission_id: Uuid;
  mission_code: string;
  status: MissionStatus;
  authorization_code?: string;
  details: DispatchDetails;
  crew: CrewRoster;
  patient: PatientInput;
  risk: PAVERisk;
  flight_plan: FlightPlan;
  /** The seat the viewer occupies (they are, by construction, assigned). */
  viewer_seat: CrewSeat;
}

/** Authorized result: the viewer is assigned and the package is delivered. */
export interface AuthorizedEfbView {
  authorized: true;
  package: AuthorizedMissionPackage;
}

/**
 * Unauthorized result: the viewer is authenticated but NOT assigned to the
 * mission (Requirement 6.2). It deliberately carries NO mission fields, so the
 * package is withheld structurally. `mission_id` is echoed only so the UI can
 * name what was requested; no details/crew/patient/plan are exposed.
 */
export interface UnauthorizedEfbView {
  authorized: false;
  /** The mission that was requested (for the UI message only). */
  requested_mission_id: Uuid;
  /** Human-readable, non-sensitive reason for the withholding. */
  reason: string;
}

export type EfbMissionView = AuthorizedEfbView | UnauthorizedEfbView;

/**
 * Determine which crew seat (if any) `viewerId` occupies on `crew`. Returns the
 * seat when the viewer is the PIC, flight nurse, or flight paramedic; otherwise
 * `null`. This is the single definition of "assigned to the mission" the EFB
 * authorization uses (Requirement 6.1/6.2).
 */
export function crewSeatFor(crew: CrewRoster, viewerId: Uuid): CrewSeat | null {
  if (crew.pilot_in_command_id === viewerId) {
    return "PILOT_IN_COMMAND";
  }
  if (crew.flight_nurse_id === viewerId) {
    return "FLIGHT_NURSE";
  }
  if (crew.flight_paramedic_id === viewerId) {
    return "FLIGHT_PARAMEDIC";
  }
  return null;
}

/** Whether `viewerId` is assigned to the mission's crew (Requirement 6.1/6.2). */
export function isAssignedCrew(crew: CrewRoster, viewerId: Uuid): boolean {
  return crewSeatFor(crew, viewerId) !== null;
}

/**
 * Resolve the cockpit EFB mission view for an authenticated viewer against an
 * authorized mission package (design Section 6.3 `publish_mission_to_efb`; task
 * 13.1; Requirements 6.1, 6.2).
 *
 * - If the viewer occupies a crew seat on the mission, return the authorized
 *   package view containing details, crew, patient, risk, and flight plan
 *   (Requirement 6.1).
 * - Otherwise return an unauthorized-indication result that withholds every
 *   package field (Requirement 6.2).
 *
 * Pure and total: given the same mission and viewer it always returns the same
 * result and never throws. It does not decide freshness/degradation (that is
 * {@link resolveLiveState}) nor timing (a client concern).
 */
export function resolveEfbMissionView(
  mission: MissionDispatch,
  viewer: EfbViewer,
): EfbMissionView {
  const seat = crewSeatFor(mission.crew, viewer.viewer_id);

  if (seat === null) {
    return {
      authorized: false,
      requested_mission_id: mission.mission_id,
      reason:
        "You are not assigned to this mission. The mission package is available only to assigned crew.",
    };
  }

  const authorizedPackage: AuthorizedMissionPackage = {
    mission_id: mission.mission_id,
    mission_code: mission.mission_code,
    status: mission.status,
    details: mission.details,
    crew: mission.crew,
    patient: mission.patient,
    risk: mission.risk,
    flight_plan: mission.flight_plan,
    viewer_seat: seat,
  };
  if (mission.authorization_code !== undefined) {
    authorizedPackage.authorization_code = mission.authorization_code;
  }

  return { authorized: true, package: authorizedPackage };
}
