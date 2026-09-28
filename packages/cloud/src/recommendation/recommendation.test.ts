import { describe, expect, it } from "vitest";
import type { GeoPoint } from "@virtualhems/contracts";
import {
  InMemoryCandidateProvider,
  capabilityMatches,
  helipadIsOperational,
  routeIsPermissible,
  orderEligible,
  recommendFacility,
  type FacilityCandidate,
  type RankedFacility,
  type RecommendFacilityInput,
  type RouteConstraints,
  type WeatherObservation,
} from "./recommendation.js";
import { haversineDistanceNm } from "./distance.js";

// --- Fixtures ----------------------------------------------------------------

const ORIGIN: GeoPoint = { latitude_deg: 41.0, longitude_deg: -80.0 };
const REQUIRED = "TRAUMA_LEVEL_I";

/** A GeoPoint offset roughly `dLatDeg` north of the origin. */
function north(dLatDeg: number): GeoPoint {
  return { latitude_deg: 41.0 + dLatDeg, longitude_deg: -80.0 };
}

function facility(overrides: Partial<FacilityCandidate> = {}): FacilityCandidate {
  return {
    id: "F1",
    capability: REQUIRED,
    coordinates: north(0.1),
    elevation_ft: 1000,
    helipad_status: "OPERATIONAL",
    ...overrides,
  };
}

function goodWeather(
  overrides: Partial<WeatherObservation> = {},
): WeatherObservation {
  return {
    observed_at: "2024-01-01T12:00:00.000Z",
    ceiling_ft: 3000,
    visibility_sm: 6,
    category: "VFR",
    ...overrides,
  };
}

function input(
  facilities: readonly FacilityCandidate[],
  overrides: Partial<RecommendFacilityInput> = {},
): {
  input: RecommendFacilityInput;
  deps: { candidateProvider: InMemoryCandidateProvider };
} {
  return {
    input: {
      condition: { target_facility_type: REQUIRED },
      patientLocation: { coordinates: ORIGIN },
      weather: goodWeather(),
      constraints: {},
      ...overrides,
    },
    deps: { candidateProvider: new InMemoryCandidateProvider(facilities) },
  };
}

// --- Eligibility: all three checks required (req 5.1) -----------------------

describe("recommendFacility eligibility (req 5.1)", () => {
  it("includes a facility only when capability, helipad, and route all pass", () => {
    const { input: i, deps } = input([facility({ id: "F1" })]);
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("MATCH");
    expect(result.ranked.map((r) => r.facility.id)).toEqual(["F1"]);
  });

  it("excludes a facility whose capability does not match the condition", () => {
    const { input: i, deps } = input([
      facility({ id: "F1", capability: "STROKE_CENTER" }),
    ]);
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("NO_MATCH");
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.checks.CAPABILITY.status).toBe("FAIL");
  });

  it("excludes a facility whose helipad is not operational", () => {
    const { input: i, deps } = input([
      facility({ id: "F1", helipad_status: "CLOSED" }),
    ]);
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("NO_MATCH");
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.checks.HELIPAD.status).toBe("FAIL");
  });

  it("excludes an explicitly route-excluded facility (req 5.1 route)", () => {
    const constraints: RouteConstraints = { excluded_facility_ids: ["F1"] };
    const { input: i, deps } = input([facility({ id: "F1" })], { constraints });
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("NO_MATCH");
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.checks.ROUTE.status).toBe("FAIL");
  });

  it("excludes a facility below the route visibility minimum", () => {
    const constraints: RouteConstraints = { min_visibility_sm: 5 };
    const { input: i, deps } = input([facility({ id: "F1" })], {
      constraints,
      weather: goodWeather({ visibility_sm: 2 }),
    });
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("NO_MATCH");
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.checks.ROUTE.status).toBe("FAIL");
  });
});

// --- Missing-input ineligibility + provenance (req 5.8) ---------------------

describe("recommendFacility missing inputs (req 5.8)", () => {
  it("treats a missing helipad status as ineligible and records it in provenance", () => {
    const { input: i, deps } = input([
      facility({ id: "F1", helipad_status: undefined }),
    ]);
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("NO_MATCH");
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.eligible).toBe(false);
    expect(prov?.checks.HELIPAD.status).toBe("MISSING_INPUT");
    expect(prov?.missing_inputs).toContain("HELIPAD");
    expect(prov?.helipad_status).toBe("UNAVAILABLE");
  });

  it("treats a missing weather observation as ineligible and records it in provenance", () => {
    const { input: i, deps } = input([facility({ id: "F1" })], {
      weather: undefined,
    });
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("NO_MATCH");
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.eligible).toBe(false);
    expect(prov?.checks.HELIPAD.status).toBe("MISSING_INPUT");
    expect(prov?.missing_inputs).toContain("HELIPAD");
  });

  it("treats missing route-constraint data as ineligible and records it in provenance", () => {
    // require_route_data defaults to true; with no weather and no minima, the
    // route input is unavailable.
    const { input: i, deps } = input([facility({ id: "F1" })], {
      weather: undefined,
    });
    const result = recommendFacility(i, deps);
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.checks.ROUTE.status).toBe("MISSING_INPUT");
    expect(prov?.missing_inputs).toContain("ROUTE");
  });

  it("treats a missing capability as ineligible and records it in provenance", () => {
    const { input: i, deps } = input([facility({ id: "F1", capability: "" })]);
    const result = recommendFacility(i, deps);
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.checks.CAPABILITY.status).toBe("MISSING_INPUT");
    expect(prov?.missing_inputs).toContain("CAPABILITY");
  });
});

// --- No-match requires human selection (req 5.3) ----------------------------

describe("recommendFacility no-match (req 5.3)", () => {
  it("returns an explicit no-match requiring human selection when nothing qualifies", () => {
    const { input: i, deps } = input([
      facility({ id: "F1", capability: "STROKE_CENTER" }),
      facility({ id: "F2", helipad_status: "CLOSED" }),
    ]);
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("NO_MATCH");
    expect(result.ranked).toEqual([]);
    expect(result.requires_human_selection).toBe(true);
    // Provenance still recorded for every evaluated candidate.
    expect(result.evaluated.map((e) => e.facility_id).sort()).toEqual([
      "F1",
      "F2",
    ]);
  });

  it("returns no-match with an empty candidate set", () => {
    const { input: i, deps } = input([]);
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("NO_MATCH");
    expect(result.requires_human_selection).toBe(true);
  });
});

// --- Deterministic ordering (req 5.5) ---------------------------------------

describe("recommendFacility ordering (req 5.5)", () => {
  it("orders by descending suitability score first", () => {
    // F_FAR has better weather margin baked into the score via the origin
    // weather; make scores differ by giving one a nearer distance and clearly
    // higher score through weather. We assert score-desc directly on ranking.
    const { input: i, deps } = input([
      facility({ id: "B", coordinates: north(0.5) }),
      facility({ id: "A", coordinates: north(0.1) }),
    ]);
    const result = recommendFacility(i, deps);
    const scores = result.ranked.map((r) => r.score);
    // Ranking is non-increasing in score.
    for (let k = 1; k < scores.length; k++) {
      expect(scores[k - 1]).toBeGreaterThanOrEqual(scores[k]);
    }
  });

  it("breaks score ties by ascending straight-line distance", () => {
    const near = facility({ id: "NEAR", coordinates: north(0.1) });
    const far = facility({ id: "FAR", coordinates: north(0.3) });
    const ranked: RankedFacility[] = [
      {
        facility: far,
        score: 100,
        distance_nm: haversineDistanceNm(ORIGIN, far.coordinates),
        provenance: {} as never,
      },
      {
        facility: near,
        score: 100,
        distance_nm: haversineDistanceNm(ORIGIN, near.coordinates),
        provenance: {} as never,
      },
    ];
    const ordered = orderEligible(ranked);
    expect(ordered.map((r) => r.facility.id)).toEqual(["NEAR", "FAR"]);
  });

  it("breaks remaining ties by ascending facility identifier", () => {
    const b = facility({ id: "B", coordinates: north(0.1) });
    const a = facility({ id: "A", coordinates: north(0.1) });
    const dist = haversineDistanceNm(ORIGIN, a.coordinates);
    const ranked: RankedFacility[] = [
      { facility: b, score: 100, distance_nm: dist, provenance: {} as never },
      { facility: a, score: 100, distance_nm: dist, provenance: {} as never },
    ];
    const ordered = orderEligible(ranked);
    expect(ordered.map((r) => r.facility.id)).toEqual(["A", "B"]);
  });

  it("produces identical ordering for identical inputs (determinism)", () => {
    const facilities = [
      facility({ id: "F3", coordinates: north(0.3) }),
      facility({ id: "F1", coordinates: north(0.1) }),
      facility({ id: "F2", coordinates: north(0.2) }),
    ];
    const a = input(facilities);
    const b = input(facilities);
    const run1 = recommendFacility(a.input, a.deps);
    const run2 = recommendFacility(b.input, b.deps);
    expect(run1.ranked.map((r) => r.facility.id)).toEqual(
      run2.ranked.map((r) => r.facility.id),
    );
  });
});

// --- Never select solely by nearest (req 5.4) -------------------------------

describe("recommendFacility never selects solely by nearest (req 5.4)", () => {
  it("does not recommend the nearest facility when it fails a constraint", () => {
    // NEAR is closest but has the wrong capability; FAR is eligible.
    const near = facility({
      id: "NEAR",
      capability: "STROKE_CENTER",
      coordinates: north(0.05),
    });
    const far = facility({ id: "FAR", coordinates: north(0.5) });
    const { input: i, deps } = input([near, far]);
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("MATCH");
    expect(result.ranked.map((r) => r.facility.id)).toEqual(["FAR"]);
    // The nearer facility was evaluated but excluded.
    const nearProv = result.evaluated.find((e) => e.facility_id === "NEAR");
    expect(nearProv?.eligible).toBe(false);
  });
});

// --- Provider radius filtering ----------------------------------------------

describe("InMemoryCandidateProvider", () => {
  it("filters candidates outside the max radius", () => {
    const provider = new InMemoryCandidateProvider([
      facility({ id: "IN", coordinates: north(0.1) }),
      facility({ id: "OUT", coordinates: north(5.0) }),
    ]);
    const within = provider.candidatesWithinRegion(
      { coordinates: ORIGIN },
      30,
    );
    expect(within.map((f) => f.id)).toEqual(["IN"]);
  });

  it("returns all candidates when no radius is given", () => {
    const provider = new InMemoryCandidateProvider([
      facility({ id: "A" }),
      facility({ id: "B", coordinates: north(9.0) }),
    ]);
    expect(
      provider
        .candidatesWithinRegion({ coordinates: ORIGIN }, undefined)
        .map((f) => f.id),
    ).toEqual(["A", "B"]);
  });
});

// --- Direct check-function unit tests ---------------------------------------

describe("eligibility check helpers", () => {
  it("capabilityMatches is case/whitespace insensitive", () => {
    expect(capabilityMatches("trauma_level_i", "  TRAUMA_LEVEL_I  ").status).toBe(
      "PASS",
    );
  });

  it("helipadIsOperational reports MISSING_INPUT when weather is absent", () => {
    expect(helipadIsOperational(facility(), undefined).status).toBe(
      "MISSING_INPUT",
    );
  });

  it("routeIsPermissible passes when minima are met", () => {
    const result = routeIsPermissible(facility(), goodWeather(), {
      min_visibility_sm: 3,
      min_ceiling_ft: 1000,
    });
    expect(result.status).toBe("PASS");
  });
});
