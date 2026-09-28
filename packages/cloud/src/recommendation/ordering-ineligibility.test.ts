/**
 * Focused tests for facility-recommendation ORDERING DETERMINISM (req 5.5) and
 * MISSING-INPUT INELIGIBILITY WITH PROVENANCE (req 5.8).
 *
 * These complement `recommendation.test.ts` (which covers the happy-path
 * eligibility, no-match, and basic ordering/tie-break cases) with:
 *
 *   - Req 5.5: exhaustive tie-break behavior for `orderEligible` and
 *     `recommendFacility` — score-desc then distance-asc then id-asc — plus
 *     determinism (identical inputs ⇒ identical ordering), input-order
 *     independence (permuting the candidate list yields the same ranked order),
 *     and a fast-check property that the ranking is a total deterministic order
 *     invariant under input permutation.
 *   - Req 5.8: single AND combined missing inputs (helipad status, weather
 *     observation, route-constraint data) each make a facility ineligible, are
 *     recorded in that facility's provenance (`missing_inputs` + the
 *     MISSING_INPUT check status), and such facilities never appear in `ranked`.
 *
 * No implementation logic is changed; these are read-only assertions over the
 * pure recommendation core (task 11.1). Provenance/Ironpine additions from task
 * 11.2 are intentionally NOT depended upon.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { GeoPoint } from "@virtualhems/contracts";
import {
  InMemoryCandidateProvider,
  orderEligible,
  recommendFacility,
  type FacilityCandidate,
  type RankedFacility,
  type RecommendFacilityInput,
  type RouteConstraints,
  type WeatherObservation,
} from "./recommendation.js";

// --- Fixtures ----------------------------------------------------------------

const ORIGIN: GeoPoint = { latitude_deg: 41.0, longitude_deg: -80.0 };
const REQUIRED = "TRAUMA_LEVEL_I";

/** A GeoPoint offset roughly `dLatDeg` north of the origin. */
function north(dLatDeg: number): GeoPoint {
  return { latitude_deg: 41.0 + dLatDeg, longitude_deg: -80.0 };
}

function facility(
  overrides: Partial<FacilityCandidate> = {},
): FacilityCandidate {
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

/** Build a fully-formed RankedFacility for direct `orderEligible` tests. */
function ranked(
  id: string,
  score: number,
  distanceNm: number,
): RankedFacility {
  const f = facility({ id, coordinates: north(0.1) });
  return {
    facility: f,
    score,
    distance_nm: distanceNm,
    // Provenance shape is irrelevant to `orderEligible`, which sorts only on
    // (score, distance_nm, facility.id); a minimal stand-in keeps these focused.
    provenance: {} as never,
  };
}

// =============================================================================
// Req 5.5 — deterministic ordering: score desc, distance asc, id asc
// =============================================================================

describe("orderEligible ordering keys (req 5.5)", () => {
  it("orders strictly by descending suitability score first", () => {
    const ordered = orderEligible([
      ranked("LOW", 90, 5),
      ranked("HIGH", 120, 50),
      ranked("MID", 100, 1),
    ]);
    expect(ordered.map((r) => r.facility.id)).toEqual(["HIGH", "MID", "LOW"]);
  });

  it("score dominates distance — a nearer but lower-scored facility ranks last", () => {
    // NEAR is far closer but scores lower; score must win (distance is only a
    // tie-breaker, req 5.4/5.5).
    const ordered = orderEligible([
      ranked("NEAR", 100, 0.5),
      ranked("BETTER", 110, 200),
    ]);
    expect(ordered.map((r) => r.facility.id)).toEqual(["BETTER", "NEAR"]);
  });

  it("breaks equal scores by ascending straight-line distance", () => {
    const ordered = orderEligible([
      ranked("FAR", 100, 42.0),
      ranked("NEAR", 100, 7.5),
      ranked("MID", 100, 20.0),
    ]);
    expect(ordered.map((r) => r.facility.id)).toEqual(["NEAR", "MID", "FAR"]);
  });

  it("breaks equal score AND equal distance by ascending facility id", () => {
    const ordered = orderEligible([
      ranked("charlie", 100, 10),
      ranked("alpha", 100, 10),
      ranked("bravo", 100, 10),
    ]);
    expect(ordered.map((r) => r.facility.id)).toEqual([
      "alpha",
      "bravo",
      "charlie",
    ]);
  });

  it("applies all three keys together (score, then distance, then id)", () => {
    const ordered = orderEligible([
      ranked("B", 100, 10),
      ranked("A", 100, 10), // ties with B on score+distance ⇒ id breaks it
      ranked("C", 100, 5), // same score, nearer ⇒ ahead of the id-tie pair
      ranked("D", 130, 999), // top score ⇒ first regardless of distance
    ]);
    expect(ordered.map((r) => r.facility.id)).toEqual(["D", "C", "A", "B"]);
  });

  it("does not mutate the input array", () => {
    const original = [ranked("B", 90, 10), ranked("A", 100, 10)];
    const snapshot = original.map((r) => r.facility.id);
    orderEligible(original);
    expect(original.map((r) => r.facility.id)).toEqual(snapshot);
  });

  it("is idempotent — ordering an already-ordered list is a no-op", () => {
    const list = [ranked("A", 120, 1), ranked("B", 100, 2), ranked("C", 100, 9)];
    const once = orderEligible(list);
    const twice = orderEligible(once);
    expect(twice.map((r) => r.facility.id)).toEqual(
      once.map((r) => r.facility.id),
    );
  });
});

describe("recommendFacility ordering end-to-end (req 5.5)", () => {
  it("ranks eligible facilities in non-increasing score order", () => {
    const { input: i, deps } = input([
      facility({ id: "A", coordinates: north(0.1) }),
      facility({ id: "B", coordinates: north(0.4) }),
      facility({ id: "C", coordinates: north(0.7) }),
    ]);
    const result = recommendFacility(i, deps);
    const scores = result.ranked.map((r) => r.score);
    for (let k = 1; k < scores.length; k++) {
      expect(scores[k - 1]).toBeGreaterThanOrEqual(scores[k]);
    }
  });

  it("falls to distance then id when scores are all equal (co-located, distinct ids)", () => {
    // Same coordinates ⇒ identical distance and (with identical weather)
    // identical score, so ordering must fall through to ascending id.
    const coords = north(0.2);
    const { input: i, deps } = input([
      facility({ id: "F3", coordinates: coords }),
      facility({ id: "F1", coordinates: coords }),
      facility({ id: "F2", coordinates: coords }),
    ]);
    const result = recommendFacility(i, deps);
    expect(result.ranked.map((r) => r.facility.id)).toEqual([
      "F1",
      "F2",
      "F3",
    ]);
    // Confirm the premise: all scores and distances really are equal.
    const scores = new Set(result.ranked.map((r) => r.score));
    const distances = new Set(result.ranked.map((r) => r.distance_nm));
    expect(scores.size).toBe(1);
    expect(distances.size).toBe(1);
  });

  it("is independent of candidate input order (permutation invariance)", () => {
    const base = [
      facility({ id: "F1", coordinates: north(0.1) }),
      facility({ id: "F2", coordinates: north(0.25) }),
      facility({ id: "F3", coordinates: north(0.4) }),
      facility({ id: "F4", coordinates: north(0.55) }),
    ];
    // Reversed and rotated permutations of the SAME candidates.
    const reversed = [...base].reverse();
    const rotated = [base[2], base[0], base[3], base[1]];

    const rankIds = (facilities: readonly FacilityCandidate[]): string[] => {
      const { input: i, deps } = input(facilities);
      return recommendFacility(i, deps).ranked.map((r) => r.facility.id);
    };

    const forwardIds = rankIds(base);
    expect(rankIds(reversed)).toEqual(forwardIds);
    expect(rankIds(rotated)).toEqual(forwardIds);
  });

  it("produces byte-identical ranked output across repeated identical runs (determinism)", () => {
    const facilities = [
      facility({ id: "F3", coordinates: north(0.3) }),
      facility({ id: "F1", coordinates: north(0.1) }),
      facility({ id: "F2", coordinates: north(0.2) }),
    ];
    const runs = Array.from({ length: 5 }, () => {
      const { input: i, deps } = input(facilities);
      const r = recommendFacility(i, deps);
      return r.ranked.map((x) => ({
        id: x.facility.id,
        score: x.score,
        distance_nm: x.distance_nm,
      }));
    });
    for (let k = 1; k < runs.length; k++) {
      expect(runs[k]).toEqual(runs[0]);
    }
  });
});

// =============================================================================
// Req 5.5 — property: ranking is a total deterministic order, invariant under
// input permutation.
// =============================================================================

describe("recommendFacility ordering property (req 5.5)", () => {
  // A generator producing a small set of DISTINCT-id eligible facilities at
  // varied northward offsets so distances differ; identical good weather keeps
  // eligibility guaranteed and lets score/distance/id all participate.
  const facilitiesArb = fc
    .uniqueArray(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 6 }).filter((s) => s.trim().length > 0),
        dLat: fc.double({ min: 0.01, max: 3, noNaN: true }),
      }),
      { minLength: 1, maxLength: 8, selector: (r) => r.id },
    )
    .map((rows) =>
      rows.map((r) =>
        facility({ id: r.id, coordinates: north(r.dLat) }),
      ),
    );

  /** The comparator req 5.5 mandates, applied to the ranked output pairs. */
  function respectsTotalOrder(
    rankedList: readonly {
      score: number;
      distance_nm: number;
      id: string;
    }[],
  ): boolean {
    for (let k = 1; k < rankedList.length; k++) {
      const prev = rankedList[k - 1];
      const cur = rankedList[k];
      if (prev.score !== cur.score) {
        if (!(prev.score > cur.score)) return false; // must be descending
        continue;
      }
      if (prev.distance_nm !== cur.distance_nm) {
        if (!(prev.distance_nm < cur.distance_nm)) return false; // ascending
        continue;
      }
      if (!(prev.id < cur.id)) return false; // ascending id
    }
    return true;
  }

  it("ranked output always respects (score desc, distance asc, id asc)", () => {
    fc.assert(
      fc.property(facilitiesArb, (facilities) => {
        const { input: i, deps } = input(facilities);
        const result = recommendFacility(i, deps);
        const rows = result.ranked.map((r) => ({
          score: r.score,
          distance_nm: r.distance_nm,
          id: r.facility.id,
        }));
        return respectsTotalOrder(rows);
      }),
      { numRuns: 200 },
    );
  });

  it("ranked order is invariant under any permutation of the candidate list", () => {
    fc.assert(
      fc.property(
        facilitiesArb.chain((facilities) =>
          fc.tuple(
            fc.constant(facilities),
            // A permutation of the same facilities via an index shuffle.
            fc.shuffledSubarray(facilities, {
              minLength: facilities.length,
              maxLength: facilities.length,
            }),
          ),
        ),
        ([original, permuted]) => {
          const a = input(original);
          const b = input(permuted);
          const idsA = recommendFacility(a.input, a.deps).ranked.map(
            (r) => r.facility.id,
          );
          const idsB = recommendFacility(b.input, b.deps).ranked.map(
            (r) => r.facility.id,
          );
          expect(idsB).toEqual(idsA);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("every eligible facility id appears exactly once in the ranking (total order over the set)", () => {
    fc.assert(
      fc.property(facilitiesArb, (facilities) => {
        const { input: i, deps } = input(facilities);
        const result = recommendFacility(i, deps);
        const rankedIds = result.ranked.map((r) => r.facility.id).sort();
        const eligibleIds = result.evaluated
          .filter((e) => e.eligible)
          .map((e) => e.facility_id)
          .sort();
        expect(rankedIds).toEqual(eligibleIds);
        // No duplicates in the ranking.
        expect(new Set(rankedIds).size).toBe(rankedIds.length);
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// Req 5.8 — missing-input ineligibility with provenance (single + combined)
// =============================================================================

describe("recommendFacility missing-input ineligibility + provenance (req 5.8)", () => {
  it("missing helipad status ⇒ ineligible, HELIPAD MISSING_INPUT recorded, absent from ranked", () => {
    const { input: i, deps } = input([
      facility({ id: "F1", helipad_status: undefined }),
    ]);
    const result = recommendFacility(i, deps);
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.eligible).toBe(false);
    expect(prov?.checks.HELIPAD.status).toBe("MISSING_INPUT");
    expect(prov?.missing_inputs).toContain("HELIPAD");
    expect(prov?.helipad_status).toBe("UNAVAILABLE");
    expect(result.ranked.some((r) => r.facility.id === "F1")).toBe(false);
  });

  it("missing weather observation ⇒ ineligible with HELIPAD + ROUTE-relevant missing inputs, absent from ranked", () => {
    // With weather-derived route minima in force, missing weather also makes
    // the ROUTE check a MISSING_INPUT.
    const constraints: RouteConstraints = { min_visibility_sm: 3 };
    const { input: i, deps } = input([facility({ id: "F1" })], {
      weather: undefined,
      constraints,
    });
    const result = recommendFacility(i, deps);
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.eligible).toBe(false);
    expect(prov?.checks.HELIPAD.status).toBe("MISSING_INPUT");
    expect(prov?.checks.ROUTE.status).toBe("MISSING_INPUT");
    expect(prov?.missing_inputs).toEqual(
      expect.arrayContaining(["HELIPAD", "ROUTE"]),
    );
    expect(result.ranked.some((r) => r.facility.id === "F1")).toBe(false);
  });

  it("missing/unavailable route-constraint data ⇒ ineligible, ROUTE MISSING_INPUT recorded", () => {
    // require_route_data defaults to true; with no weather and no minima the
    // route input is unavailable (a MISSING route input per req 5.8).
    const { input: i, deps } = input([facility({ id: "F1" })], {
      weather: undefined,
      constraints: { require_route_data: true },
    });
    const result = recommendFacility(i, deps);
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.eligible).toBe(false);
    expect(prov?.checks.ROUTE.status).toBe("MISSING_INPUT");
    expect(prov?.missing_inputs).toContain("ROUTE");
    expect(result.ranked.some((r) => r.facility.id === "F1")).toBe(false);
  });

  it("missing capability ⇒ ineligible, CAPABILITY MISSING_INPUT recorded", () => {
    const { input: i, deps } = input([facility({ id: "F1", capability: "" })]);
    const result = recommendFacility(i, deps);
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.eligible).toBe(false);
    expect(prov?.checks.CAPABILITY.status).toBe("MISSING_INPUT");
    expect(prov?.missing_inputs).toContain("CAPABILITY");
    expect(result.ranked.some((r) => r.facility.id === "F1")).toBe(false);
  });

  it("combined missing inputs are ALL recorded (missing helipad + missing weather + weather-dependent route)", () => {
    const constraints: RouteConstraints = { min_ceiling_ft: 1000 };
    const { input: i, deps } = input(
      [facility({ id: "F1", helipad_status: undefined })],
      { weather: undefined, constraints },
    );
    const result = recommendFacility(i, deps);
    const prov = result.evaluated.find((e) => e.facility_id === "F1");
    expect(prov?.eligible).toBe(false);
    expect(prov?.checks.HELIPAD.status).toBe("MISSING_INPUT");
    expect(prov?.checks.ROUTE.status).toBe("MISSING_INPUT");
    // Both distinct missing inputs are surfaced in provenance.
    expect(prov?.missing_inputs).toEqual(
      expect.arrayContaining(["HELIPAD", "ROUTE"]),
    );
    expect(result.ranked.some((r) => r.facility.id === "F1")).toBe(false);
  });

  it("a facility missing any input never appears in ranked even alongside eligible ones", () => {
    const eligible = facility({ id: "OK", coordinates: north(0.2) });
    const missingHelipad = facility({
      id: "NO_PAD",
      coordinates: north(0.1),
      helipad_status: undefined,
    });
    const { input: i, deps } = input([missingHelipad, eligible]);
    const result = recommendFacility(i, deps);
    expect(result.outcome).toBe("MATCH");
    expect(result.ranked.map((r) => r.facility.id)).toEqual(["OK"]);
    const missingProv = result.evaluated.find(
      (e) => e.facility_id === "NO_PAD",
    );
    expect(missingProv?.eligible).toBe(false);
    expect(missingProv?.missing_inputs).toContain("HELIPAD");
    // The ineligible facility is still fully evaluated for the audit trail.
    expect(result.evaluated.map((e) => e.facility_id).sort()).toEqual([
      "NO_PAD",
      "OK",
    ]);
  });

  it("property: any facility with a non-empty missing_inputs list is ineligible and unranked (req 5.8)", () => {
    // Randomly drop the helipad status and/or the weather observation and assert
    // the missing-input ⇒ ineligible ⇒ unranked invariant always holds.
    const facilityArb = fc.record({
      id: fc
        .string({ minLength: 1, maxLength: 5 })
        .filter((s) => s.trim().length > 0),
      dLat: fc.double({ min: 0.01, max: 2, noNaN: true }),
      dropHelipad: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(facilityArb, {
          minLength: 1,
          maxLength: 6,
          selector: (r) => r.id,
        }),
        fc.boolean(),
        (rows, dropWeather) => {
          const facilities = rows.map((r) =>
            facility({
              id: r.id,
              coordinates: north(r.dLat),
              helipad_status: r.dropHelipad ? undefined : "OPERATIONAL",
            }),
          );
          const { input: i, deps } = input(facilities, {
            weather: dropWeather ? undefined : goodWeather(),
            // Weather minima so a dropped weather observation is a missing route
            // input too, exercising combined missing inputs.
            constraints: { min_visibility_sm: 3 },
          });
          const result = recommendFacility(i, deps);
          const rankedIds = new Set(result.ranked.map((r) => r.facility.id));
          for (const prov of result.evaluated) {
            if (prov.missing_inputs.length > 0) {
              // Missing input ⇒ ineligible ⇒ not ranked.
              expect(prov.eligible).toBe(false);
              expect(rankedIds.has(prov.facility_id)).toBe(false);
              // Every recorded missing input has a MISSING_INPUT check status.
              for (const check of prov.missing_inputs) {
                expect(prov.checks[check].status).toBe("MISSING_INPUT");
              }
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
