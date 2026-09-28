/**
 * Property 5 — Recommendation safety (Validates: Requirements 5.1, 5.3, 5.4).
 *
 * The universal safety invariant of the Recommendation_Service: every RANKED
 * (recommended) facility satisfies ALL applicable constraints, an unsafe
 * facility is NEVER silently selected, and when nothing qualifies the outcome is
 * an explicit NO_MATCH requiring authorized human selection — never a silent
 * fallback to the nearest facility.
 *
 * This is a dedicated fast-check PROPERTY test (design Section 6.5). It drives
 * randomized facility sets, patient conditions, weather observations, and route
 * constraints engineered to produce a MIX of eligible and ineligible facilities,
 * derives the EXPECTED eligibility of each facility from the same rules the
 * service uses (capability match, helipad operational under weather, route
 * permissible, and no missing inputs), and asserts:
 *
 *   - Req 5.1: every facility in `ranked` is eligible — CAPABILITY, HELIPAD and
 *     ROUTE all PASS and `missing_inputs` is empty. No FAIL/MISSING_INPUT
 *     facility ever appears in `ranked`.
 *   - Req 5.4: the service never silently selects an unsafe facility — any
 *     facility failing any check (FAIL or MISSING_INPUT) is absent from `ranked`,
 *     so nearness alone never gets a facility recommended.
 *   - Req 5.3: when NO facility is eligible the outcome is exactly NO_MATCH with
 *     `ranked` empty and `requires_human_selection === true`.
 *   - Cross-check: outcome is MATCH iff `ranked` is non-empty, and the ranked set
 *     is EXACTLY the eligible subset of `evaluated`.
 *   - The same invariant holds through {@link recommendWithBriefing}: the
 *     deterministic ranking is unchanged by the (optional) AI briefing boundary.
 *
 * No implementation logic is changed — these are read-only assertions over the
 * pure recommendation core (task 11.1) and the briefing wrapper (task 11.2). The
 * expected-eligibility oracle is derived independently of the service internals
 * from the documented req-5.1/5.8 rules, so the test would catch the service
 * silently ranking an unsafe facility rather than merely re-deriving its logic.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { GeoPoint } from "@virtualhems/contracts";
import {
  InMemoryCandidateProvider,
  recommendFacility,
  recommendWithBriefing,
  UnavailableIronpineBriefing,
  InMemoryIronpineBriefing,
  type EligibilityCheck,
  type FacilityCandidate,
  type HelipadStatus,
  type RecommendFacilityInput,
  type RouteConstraints,
  type WeatherObservation,
} from "./index.js";

// --- Fixtures ----------------------------------------------------------------

const ORIGIN: GeoPoint = { latitude_deg: 41.0, longitude_deg: -80.0 };
const REQUIRED = "TRAUMA_LEVEL_I";
/** A capability that never matches REQUIRED, used to force a CAPABILITY FAIL. */
const WRONG_CAPABILITY = "BURN_CENTER";

/** A GeoPoint offset roughly `dLatDeg` north of the origin. */
function north(dLatDeg: number): GeoPoint {
  return { latitude_deg: 41.0 + dLatDeg, longitude_deg: -80.0 };
}

// --- Independent eligibility oracle (derived from req 5.1 / 5.8 rules) -------
//
// These reproduce the DOCUMENTED eligibility rules WITHOUT calling the service,
// so the property compares the service's ranked set against an independently
// computed expectation rather than tautologically echoing the implementation.

/** capability: matches (case/space-insensitive) the required type, else FAIL;
 *  empty/absent capability is a MISSING_INPUT. */
function expectCapability(
  required: string,
  capability: string | undefined,
): "PASS" | "FAIL" | "MISSING_INPUT" {
  if (capability === undefined || capability.trim().length === 0) {
    return "MISSING_INPUT";
  }
  return capability.trim().toUpperCase() === required.trim().toUpperCase()
    ? "PASS"
    : "FAIL";
}

/** helipad: needs a helipad status AND a weather observation (else MISSING);
 *  non-OPERATIONAL status FAILs. */
function expectHelipad(
  facility: FacilityCandidate,
  weather: WeatherObservation | undefined,
): "PASS" | "FAIL" | "MISSING_INPUT" {
  if (facility.helipad_status === undefined) return "MISSING_INPUT";
  if (weather === undefined) return "MISSING_INPUT";
  return facility.helipad_status === "OPERATIONAL" ? "PASS" : "FAIL";
}

/** route: excluded id FAILs; weather minima need weather (else MISSING) and a
 *  below-minimum value FAILs; require_route_data with no evaluable signal is
 *  MISSING. Mirrors routeIsPermissible. */
function expectRoute(
  facility: FacilityCandidate,
  weather: WeatherObservation | undefined,
  constraints: RouteConstraints,
): "PASS" | "FAIL" | "MISSING_INPUT" {
  if (constraints.excluded_facility_ids?.includes(facility.id)) return "FAIL";

  const requiresRouteData = constraints.require_route_data ?? true;
  const hasVisMin = typeof constraints.min_visibility_sm === "number";
  const hasCeilMin = typeof constraints.min_ceiling_ft === "number";
  const hasMinima = hasVisMin || hasCeilMin;

  if (hasMinima && weather === undefined) return "MISSING_INPUT";

  if (
    hasVisMin &&
    weather !== undefined &&
    typeof weather.visibility_sm === "number" &&
    weather.visibility_sm < (constraints.min_visibility_sm as number)
  ) {
    return "FAIL";
  }
  if (
    hasCeilMin &&
    weather !== undefined &&
    typeof weather.ceiling_ft === "number" &&
    weather.ceiling_ft < (constraints.min_ceiling_ft as number)
  ) {
    return "FAIL";
  }

  if (requiresRouteData && !hasMinima && weather === undefined) {
    return "MISSING_INPUT";
  }
  return "PASS";
}

/** A facility is eligible iff all three checks PASS. */
function expectEligible(
  facility: FacilityCandidate,
  required: string,
  weather: WeatherObservation | undefined,
  constraints: RouteConstraints,
): boolean {
  return (
    expectCapability(required, facility.capability) === "PASS" &&
    expectHelipad(facility, weather) === "PASS" &&
    expectRoute(facility, weather, constraints) === "PASS"
  );
}

// --- Generators (a deliberate mix of eligible + ineligible facilities) -------

const HELIPAD_OR_ABSENT: (HelipadStatus | undefined)[] = [
  "OPERATIONAL",
  "CLOSED",
  "UNKNOWN",
  undefined,
];

/**
 * A single facility whose capability may match or not, whose helipad status
 * spans all classifications plus "absent", at a varied northward offset.
 */
const facilityRowArb = fc.record({
  id: fc
    .string({ minLength: 1, maxLength: 6 })
    .filter((s) => s.trim().length > 0),
  dLat: fc.double({ min: 0.01, max: 3, noNaN: true }),
  // Bias toward the matching capability so eligible facilities appear often,
  // while still generating mismatches and (empty ⇒ MISSING_INPUT) capabilities.
  capability: fc.constantFrom(REQUIRED, REQUIRED, WRONG_CAPABILITY, ""),
  helipad: fc.constantFrom(...HELIPAD_OR_ABSENT),
});

/** A weather observation, or `undefined` (missing weather input, req 5.8). */
const weatherArb: fc.Arbitrary<WeatherObservation | undefined> = fc.option(
  fc.record({
    observed_at: fc.constant("2024-01-01T12:00:00.000Z"),
    ceiling_ft: fc.integer({ min: 0, max: 6000 }),
    visibility_sm: fc.integer({ min: 0, max: 10 }),
    category: fc.constantFrom("VFR", "MVFR", "IFR"),
  }),
  { nil: undefined },
);

/**
 * Route constraints varying weather minima, an excluded-id subset (drawn from
 * the generated facility ids so exclusions actually bite), and require_route_data.
 */
function constraintsArb(
  ids: readonly string[],
): fc.Arbitrary<RouteConstraints> {
  return fc.record({
    min_visibility_sm: fc.option(fc.integer({ min: 0, max: 8 }), {
      nil: undefined,
    }),
    min_ceiling_ft: fc.option(fc.integer({ min: 0, max: 5000 }), {
      nil: undefined,
    }),
    excluded_facility_ids:
      ids.length === 0
        ? fc.constant<readonly string[]>([])
        : fc.subarray([...ids]),
    require_route_data: fc.boolean(),
  });
}

/** The full scenario: a facility set + weather + route constraints over its ids. */
const scenarioArb = fc
  .uniqueArray(facilityRowArb, {
    minLength: 1,
    maxLength: 8,
    selector: (r) => r.id,
  })
  .chain((rows) => {
    const facilities: FacilityCandidate[] = rows.map((r) => ({
      id: r.id,
      capability: r.capability,
      coordinates: north(r.dLat),
      elevation_ft: 1000,
      helipad_status: r.helipad,
    }));
    return fc.tuple(
      fc.constant(facilities),
      weatherArb,
      constraintsArb(facilities.map((f) => f.id)),
    );
  });

function buildInput(
  facilities: readonly FacilityCandidate[],
  weather: WeatherObservation | undefined,
  constraints: RouteConstraints,
): {
  input: RecommendFacilityInput;
  deps: { candidateProvider: InMemoryCandidateProvider };
} {
  return {
    input: {
      condition: { target_facility_type: REQUIRED },
      patientLocation: { coordinates: ORIGIN },
      weather,
      constraints,
    },
    deps: { candidateProvider: new InMemoryCandidateProvider(facilities) },
  };
}

// =============================================================================
// Property 5 — Recommendation safety (req 5.1, 5.3, 5.4)
// =============================================================================

describe("Property 5: Recommendation safety (req 5.1, 5.3, 5.4)", () => {
  const ALL_CHECKS: EligibilityCheck[] = ["CAPABILITY", "HELIPAD", "ROUTE"];

  it("every ranked facility satisfies ALL constraints; unsafe facilities are never ranked; empty ⇒ explicit NO_MATCH", () => {
    fc.assert(
      fc.property(scenarioArb, ([facilities, weather, constraints]) => {
        const { input, deps } = buildInput(facilities, weather, constraints);
        const result = recommendFacility(input, deps);

        const rankedIds = new Set(result.ranked.map((r) => r.facility.id));

        // --- Req 5.1: every RANKED facility passes every check, no missing input.
        for (const r of result.ranked) {
          const prov = r.provenance;
          expect(prov.eligible).toBe(true);
          for (const check of ALL_CHECKS) {
            expect(prov.checks[check].status).toBe("PASS");
          }
          expect(prov.missing_inputs).toHaveLength(0);
        }

        // --- Req 5.4: any facility failing ANY check (FAIL or MISSING_INPUT) is
        // never in `ranked` — an unsafe facility is never silently selected.
        for (const prov of result.evaluated) {
          const anyNotPass = ALL_CHECKS.some(
            (c) => prov.checks[c].status !== "PASS",
          );
          if (anyNotPass) {
            expect(prov.eligible).toBe(false);
            expect(rankedIds.has(prov.facility_id)).toBe(false);
          }
        }

        // --- Independent oracle: ranked set === expected eligible set.
        const expectedEligible = facilities
          .filter((f) => expectEligible(f, REQUIRED, weather, constraints))
          .map((f) => f.id)
          .sort();
        const actualRanked = [...rankedIds].sort();
        expect(actualRanked).toEqual(expectedEligible);

        // --- Cross-check: MATCH iff ranked non-empty; ranked === eligible subset.
        const eligibleFromEvaluated = result.evaluated
          .filter((e) => e.eligible)
          .map((e) => e.facility_id)
          .sort();
        expect(actualRanked).toEqual(eligibleFromEvaluated);

        if (result.ranked.length === 0) {
          // --- Req 5.3: no eligible facility ⇒ explicit NO_MATCH, human selection.
          expect(result.outcome).toBe("NO_MATCH");
          expect(result.requires_human_selection).toBe(true);
          expect(expectedEligible).toHaveLength(0);
        } else {
          expect(result.outcome).toBe("MATCH");
          expect(result.requires_human_selection).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("when NO facility can be eligible the outcome is exactly NO_MATCH (req 5.3) — never a nearest-facility fallback (req 5.4)", () => {
    // Force universal ineligibility: every facility carries the wrong capability,
    // so no facility can ever be recommended regardless of proximity or weather.
    const wrongCapFacilityArb = fc.record({
      id: fc
        .string({ minLength: 1, maxLength: 6 })
        .filter((s) => s.trim().length > 0),
      dLat: fc.double({ min: 0.01, max: 3, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(wrongCapFacilityArb, {
          minLength: 1,
          maxLength: 6,
          selector: (r) => r.id,
        }),
        weatherArb,
        (rows, weather) => {
          const facilities: FacilityCandidate[] = rows.map((r) => ({
            id: r.id,
            capability: WRONG_CAPABILITY,
            coordinates: north(r.dLat),
            helipad_status: "OPERATIONAL",
          }));
          const { input, deps } = buildInput(facilities, weather, {});
          const result = recommendFacility(input, deps);

          expect(result.outcome).toBe("NO_MATCH");
          expect(result.ranked).toHaveLength(0);
          expect(result.requires_human_selection).toBe(true);
          // Every candidate was still evaluated for the audit trail.
          expect(result.evaluated).toHaveLength(facilities.length);
          expect(result.evaluated.every((e) => e.eligible === false)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("the safety invariant holds THROUGH recommendWithBriefing — AI never changes the deterministic ranked/eligible set", async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.boolean(),
        async ([facilities, weather, constraints], ironpineAvailable) => {
          const { input, deps } = buildInput(facilities, weather, constraints);
          const deterministic = recommendFacility(input, deps);

          const briefed = await recommendWithBriefing(input, {
            candidateProvider: deps.candidateProvider,
            ironpine: ironpineAvailable
              ? new InMemoryIronpineBriefing()
              : new UnavailableIronpineBriefing("test: AI down"),
          });

          // Same outcome, same requires_human_selection, same ranked set/order.
          expect(briefed.outcome).toBe(deterministic.outcome);
          expect(briefed.requires_human_selection).toBe(
            deterministic.requires_human_selection,
          );
          expect(briefed.ranked.map((r) => r.facility.id)).toEqual(
            deterministic.ranked.map((r) => r.facility.id),
          );

          // Safety invariant still holds on the briefed ranked list.
          const rankedIds = new Set(briefed.ranked.map((r) => r.facility.id));
          for (const r of briefed.ranked) {
            expect(r.provenance.eligible).toBe(true);
            for (const check of ALL_CHECKS) {
              expect(r.provenance.checks[check].status).toBe("PASS");
            }
            expect(r.provenance.missing_inputs).toHaveLength(0);
          }

          // No ineligible facility leaks into the briefed ranking.
          for (const prov of briefed.evaluated) {
            if (!prov.eligible) {
              expect(rankedIds.has(prov.facility_id)).toBe(false);
            }
          }

          // NO_MATCH stays an explicit, empty, human-selection-required result.
          if (briefed.ranked.length === 0) {
            expect(briefed.outcome).toBe("NO_MATCH");
            expect(briefed.requires_human_selection).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
