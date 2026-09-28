import { describe, expect, it } from "vitest";
import type { GeoPoint, TacticalBriefing } from "@virtualhems/contracts";
import {
  recommendWithBriefing,
  InMemoryIronpineBriefing,
  UnavailableIronpineBriefing,
  ThrowingIronpineBriefing,
  type IronpineBriefingContext,
  type IronpineBriefingOutcome,
  type IronpineBriefingPort,
  type RecommendWithBriefingDependencies,
} from "./briefing.js";
import {
  InMemoryCandidateProvider,
  recommendFacility,
  type FacilityCandidate,
  type RecommendFacilityInput,
  type RouteConstraints,
  type WeatherObservation,
} from "./recommendation.js";

// --- Fixtures ----------------------------------------------------------------

const ORIGIN: GeoPoint = { latitude_deg: 41.0, longitude_deg: -80.0 };
const REQUIRED = "TRAUMA_LEVEL_I";

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

function makeInput(
  facilities: readonly FacilityCandidate[],
  overrides: Partial<RecommendFacilityInput> = {},
): {
  input: RecommendFacilityInput;
  provider: InMemoryCandidateProvider;
} {
  return {
    input: {
      condition: { target_facility_type: REQUIRED },
      patientLocation: { coordinates: ORIGIN },
      weather: goodWeather(),
      constraints: {},
      ...overrides,
    },
    provider: new InMemoryCandidateProvider(facilities),
  };
}

// --- Req 5.2: complete provenance on recommended facilities -----------------

describe("recommendWithBriefing provenance (req 5.2)", () => {
  it("attaches evaluated capability, helipad status, weather observation, route-constraint result, and score to each recommended facility", async () => {
    const constraints: RouteConstraints = {
      min_visibility_sm: 3,
      min_ceiling_ft: 1000,
    };
    const weather = goodWeather();
    const { input, provider } = makeInput([facility({ id: "F1" })], {
      constraints,
      weather,
    });

    const result = await recommendWithBriefing(input, {
      candidateProvider: provider,
      ironpine: new InMemoryIronpineBriefing(),
    });

    expect(result.outcome).toBe("MATCH");
    expect(result.ranked).toHaveLength(1);
    const prov = result.ranked[0].provenance;

    // req 5.2: evaluated capability
    expect(prov.evaluated_capability).toBe(REQUIRED);
    // req 5.2: helipad status
    expect(prov.helipad_status).toBe("OPERATIONAL");
    // req 5.2: weather observation (full observation, not just check status)
    expect(prov.weather_observation).toEqual(weather);
    expect(prov.weather_observed_at).toBe(weather.observed_at);
    // req 5.2: route-constraint result (constraints + concrete result)
    expect(prov.route_constraint.constraints).toEqual(constraints);
    expect(prov.route_constraint.result.status).toBe("PASS");
    // req 5.2: computed suitability score
    expect(typeof prov.score).toBe("number");
    expect(prov.score).toBe(result.ranked[0].score);
  });

  it("preserves the core per-check provenance shape on ranked facilities", async () => {
    const { input, provider } = makeInput([facility({ id: "F1" })]);
    const result = await recommendWithBriefing(input, {
      candidateProvider: provider,
      ironpine: new InMemoryIronpineBriefing(),
    });
    const prov = result.ranked[0].provenance;
    expect(prov.checks.CAPABILITY.status).toBe("PASS");
    expect(prov.checks.HELIPAD.status).toBe("PASS");
    expect(prov.checks.ROUTE.status).toBe("PASS");
    expect(prov.missing_inputs).toEqual([]);
    expect(prov.eligible).toBe(true);
  });
});

// --- Req 5.7: Ironpine available augments; unavailable ⇒ AI absent ----------

describe("recommendWithBriefing Ironpine fallback (req 5.7)", () => {
  it("attaches a tactical briefing and marks AI present when Ironpine is available", async () => {
    const { input, provider } = makeInput([facility({ id: "F1" })]);
    const result = await recommendWithBriefing(input, {
      candidateProvider: provider,
      ironpine: new InMemoryIronpineBriefing(),
    });

    expect(result.ai_recommendation_absent).toBe(false);
    expect(result.briefing).not.toBeNull();
    expect(result.briefing?.recommended_facility_id).toBe("F1");
  });

  it("marks the AI recommendation absent with a null briefing when Ironpine is not configured", async () => {
    const { input, provider } = makeInput([facility({ id: "F1" })]);
    const result = await recommendWithBriefing(input, {
      candidateProvider: provider,
    });

    expect(result.ai_recommendation_absent).toBe(true);
    expect(result.briefing).toBeNull();
    expect(result.ai_absent_reason).toBeDefined();
    // Deterministic ranking still present.
    expect(result.outcome).toBe("MATCH");
    expect(result.ranked.map((r) => r.facility.id)).toEqual(["F1"]);
  });

  it("marks the AI recommendation absent when Ironpine reports unavailable", async () => {
    const { input, provider } = makeInput([facility({ id: "F1" })]);
    const result = await recommendWithBriefing(input, {
      candidateProvider: provider,
      ironpine: new UnavailableIronpineBriefing("METAR feed down"),
    });

    expect(result.ai_recommendation_absent).toBe(true);
    expect(result.briefing).toBeNull();
    expect(result.ai_absent_reason).toContain("METAR feed down");
  });

  it("degrades to AI absent when the Ironpine boundary throws", async () => {
    const { input, provider } = makeInput([facility({ id: "F1" })]);
    const result = await recommendWithBriefing(input, {
      candidateProvider: provider,
      ironpine: new ThrowingIronpineBriefing("boom"),
    });

    expect(result.ai_recommendation_absent).toBe(true);
    expect(result.briefing).toBeNull();
    expect(result.ai_absent_reason).toContain("boom");
    // Deterministic result unaffected by the AI failure.
    expect(result.outcome).toBe("MATCH");
  });

  it("degrades to AI absent when an async Ironpine boundary rejects", async () => {
    const rejecting: IronpineBriefingPort = {
      generateBriefing(): Promise<IronpineBriefingOutcome> {
        return Promise.reject(new Error("async failure"));
      },
    };
    const { input, provider } = makeInput([facility({ id: "F1" })]);
    const result = await recommendWithBriefing(input, {
      candidateProvider: provider,
      ironpine: rejecting,
    });
    expect(result.ai_recommendation_absent).toBe(true);
    expect(result.briefing).toBeNull();
    expect(result.ai_absent_reason).toContain("async failure");
  });
});

// --- Req 5.7: deterministic result identical with/without Ironpine ----------

describe("recommendWithBriefing determinism (req 5.7 / req 5.1,5.3,5.4,5.5 intact)", () => {
  const facilities = [
    facility({ id: "F3", coordinates: north(0.3) }),
    facility({ id: "F1", coordinates: north(0.1) }),
    facility({ id: "F2", coordinates: north(0.2) }),
    facility({ id: "BAD", capability: "STROKE_CENTER", coordinates: north(0.05) }),
  ];

  function det(input: RecommendFacilityInput, provider: InMemoryCandidateProvider) {
    return recommendFacility(input, { candidateProvider: provider });
  }

  it("returns the same outcome, ordering, and evaluated set whether or not Ironpine is present", async () => {
    const withAi = makeInput(facilities);
    const withoutAi = makeInput(facilities);
    const bare = makeInput(facilities);

    const present = await recommendWithBriefing(withAi.input, {
      candidateProvider: withAi.provider,
      ironpine: new InMemoryIronpineBriefing(),
    });
    const absent = await recommendWithBriefing(withoutAi.input, {
      candidateProvider: withoutAi.provider,
    });
    const core = det(bare.input, bare.provider);

    // AI presence does not change the deterministic ranking.
    const order = (r: { ranked: { facility: { id: string } }[] }) =>
      r.ranked.map((x) => x.facility.id);
    expect(order(present)).toEqual(order(absent));
    expect(order(present)).toEqual(order(core));

    // The frozen deterministic result equals the bare core result.
    expect(present.deterministic).toEqual(core);
    expect(absent.deterministic).toEqual(core);

    // Same outcome and evaluated coverage regardless of AI.
    expect(present.outcome).toBe(core.outcome);
    expect(absent.outcome).toBe(core.outcome);
    expect(present.evaluated).toEqual(core.evaluated);
    // The ineligible nearest facility is never recommended (req 5.4).
    expect(order(present)).not.toContain("BAD");
  });

  it("returns the deterministic no-match (req 5.3) with AI absent when nothing qualifies", async () => {
    const { input, provider } = makeInput([
      facility({ id: "F1", capability: "STROKE_CENTER" }),
      facility({ id: "F2", helipad_status: "CLOSED" }),
    ]);
    const result = await recommendWithBriefing(input, {
      candidateProvider: provider,
      ironpine: new UnavailableIronpineBriefing(),
    });
    expect(result.outcome).toBe("NO_MATCH");
    expect(result.ranked).toEqual([]);
    expect(result.requires_human_selection).toBe(true);
    expect(result.ai_recommendation_absent).toBe(true);
  });

  it("passes the frozen deterministic result to the Ironpine boundary", async () => {
    let seen: IronpineBriefingContext | undefined;
    const spy: IronpineBriefingPort = {
      generateBriefing(context): IronpineBriefingOutcome {
        seen = context;
        const briefing: TacticalBriefing = {
          warnings: [],
          assumptions: [],
          input_snapshot_hash: "h",
          generated_at: "1970-01-01T00:00:00.000Z",
          provenance: "spy",
        };
        return { available: true, briefing };
      },
    };
    const deps: RecommendWithBriefingDependencies = {
      candidateProvider: makeInput(facilities).provider,
      ironpine: spy,
    };
    const { input } = makeInput(facilities);
    const result = await recommendWithBriefing(input, deps);
    expect(seen).toBeDefined();
    expect(seen?.result).toEqual(result.deterministic);
  });
});
