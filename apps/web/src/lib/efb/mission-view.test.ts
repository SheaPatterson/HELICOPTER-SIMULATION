import { describe, expect, it } from "vitest";
import type { MissionDispatch } from "@virtualhems/contracts";
import {
  crewSeatFor,
  isAssignedCrew,
  resolveEfbMissionView,
} from "./mission-view";

/**
 * Unit tests for the pure cockpit EFB mission-package authorization/derivation
 * (task 13.1; Requirements 6.1, 6.2). The dedicated gating test task is 13.3;
 * these cover the core authorized vs. withheld decision and the structural
 * withholding of package fields.
 */

const PIC = "pic-0000-0000-0000-000000000001";
const NURSE = "nurse-000-0000-0000-000000000002";
const MEDIC = "medic-000-0000-0000-000000000003";
const STRANGER = "other-000-0000-0000-000000000099";

function buildMission(overrides: Partial<MissionDispatch> = {}): MissionDispatch {
  return {
    mission_id: "mission-0000-0000-0000-000000000001",
    mission_code: "STAT-42",
    details: {
      mission_type: "SCENE_CALL",
      assigned_base_id: "base-1",
      assigned_airframe_id: "airframe-1",
      destination_hospital_id: "hosp-1",
      weather_snapshot: { observed_at: "2024-01-01T00:00:00.000Z" },
    },
    crew: {
      pilot_in_command_id: PIC,
      flight_nurse_id: NURSE,
      flight_paramedic_id: MEDIC,
    },
    patient: {
      simulated_patient_id: "patient-1",
      age_years: 44,
      gender: "M",
      weight_lbs: 190,
      condition_id: "cond-1",
      clinical_summary: "Simulated trauma",
      interventions: "None",
      baseline_gcs: 13,
    },
    risk: {
      pilot_score: 1,
      aircraft_score: 1,
      environment_score: 1,
      external_score: 1,
      total_score: 4,
      disposition: "GO",
      rationale: [],
    },
    flight_plan: {
      route: [],
      direct_distance_nm: 20,
      planned_distance_nm: 22,
      estimated_fuel_burn_lbs: 300,
      reserve_requirement_minutes: 20,
      reserve_at_destination_minutes: 25,
    },
    status: "DISPATCHED",
    authorization_code: "AUTH-XYZ",
    ...overrides,
  };
}

describe("crewSeatFor / isAssignedCrew (6.1/6.2)", () => {
  it("identifies each crew seat", () => {
    const crew = buildMission().crew;
    expect(crewSeatFor(crew, PIC)).toBe("PILOT_IN_COMMAND");
    expect(crewSeatFor(crew, NURSE)).toBe("FLIGHT_NURSE");
    expect(crewSeatFor(crew, MEDIC)).toBe("FLIGHT_PARAMEDIC");
  });

  it("returns null for a non-assigned viewer", () => {
    const crew = buildMission().crew;
    expect(crewSeatFor(crew, STRANGER)).toBeNull();
    expect(isAssignedCrew(crew, STRANGER)).toBe(false);
  });

  it("treats a partial roster (PIC only) correctly", () => {
    const crew = { pilot_in_command_id: PIC };
    expect(isAssignedCrew(crew, PIC)).toBe(true);
    expect(isAssignedCrew(crew, NURSE)).toBe(false);
  });
});

describe("resolveEfbMissionView — authorized (6.1)", () => {
  it("delivers the full package to the PIC", () => {
    const mission = buildMission();
    const view = resolveEfbMissionView(mission, { viewer_id: PIC });
    expect(view.authorized).toBe(true);
    if (!view.authorized) return;
    expect(view.package.viewer_seat).toBe("PILOT_IN_COMMAND");
    expect(view.package.mission_code).toBe("STAT-42");
    expect(view.package.details).toEqual(mission.details);
    expect(view.package.crew).toEqual(mission.crew);
    expect(view.package.patient).toEqual(mission.patient);
    expect(view.package.flight_plan).toEqual(mission.flight_plan);
    expect(view.package.authorization_code).toBe("AUTH-XYZ");
  });

  it("delivers the package to an assigned flight nurse and paramedic", () => {
    const mission = buildMission();
    expect(resolveEfbMissionView(mission, { viewer_id: NURSE }).authorized).toBe(true);
    expect(resolveEfbMissionView(mission, { viewer_id: MEDIC }).authorized).toBe(true);
  });

  it("omits authorization_code when the mission has none", () => {
    const mission = buildMission({ authorization_code: undefined });
    const view = resolveEfbMissionView(mission, { viewer_id: PIC });
    expect(view.authorized).toBe(true);
    if (!view.authorized) return;
    expect(view.package.authorization_code).toBeUndefined();
  });
});

describe("resolveEfbMissionView — unauthorized (6.2)", () => {
  it("withholds the package from a non-assigned authenticated viewer", () => {
    const mission = buildMission();
    const view = resolveEfbMissionView(mission, { viewer_id: STRANGER });
    expect(view.authorized).toBe(false);
  });

  it("structurally exposes no mission data in the unauthorized result", () => {
    const mission = buildMission();
    const view = resolveEfbMissionView(mission, { viewer_id: STRANGER });
    if (view.authorized) throw new Error("expected unauthorized");
    // Only the requested id (for the message) and a reason are present — no
    // details/crew/patient/plan fields leak.
    expect(view.requested_mission_id).toBe(mission.mission_id);
    expect(view.reason.length).toBeGreaterThan(0);
    expect(Object.keys(view).sort()).toEqual(
      ["authorized", "reason", "requested_mission_id"].sort(),
    );
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("STAT-42");
    expect(serialized).not.toContain(mission.patient.clinical_summary);
    expect(serialized).not.toContain("AUTH-XYZ");
  });
});
