/**
 * Ironpine tactical-briefing composition + fallback (design Section 4.6 /
 * Section 6.5, requirements 5.2, 5.7).
 *
 * Task 11.1 built the pure, deterministic recommendation core
 * ({@link recommendFacility}). This module layers the two remaining
 * Recommendation_Service requirements on top of that core WITHOUT changing its
 * eligibility, ordering, or no-match behaviour (req 5.1/5.3/5.4/5.5 stay intact
 * because the core is called unchanged and its result is only ever augmented,
 * never re-ranked):
 *
 *   - Req 5.2: attach a COMPLETE provenance record to each RECOMMENDED (ranked)
 *     facility — the evaluated facility capability, helipad status, the weather
 *     observation, the route-constraint result, and the computed suitability
 *     score. The 11.1 core already produces most of this on
 *     {@link FacilityProvenance}; here we enrich the provenance of the ranked
 *     facilities so the weather OBSERVATION and the route-constraint RESULT are
 *     fully represented (not just the pass/fail check status), producing a
 *     {@link RecommendedFacility} record per ranked facility.
 *
 *   - Req 5.7: the Ironpine briefing boundary MAY be unavailable. It is injected
 *     as {@link IronpineBriefingPort}. When Ironpine is available the service
 *     augments the deterministic result with a {@link TacticalBriefing} (AI
 *     output PRESENT). When Ironpine is UNAVAILABLE — the port is absent, throws,
 *     or reports itself unavailable — the service returns the deterministic
 *     spatial-only ranking and marks the AI recommendation ABSENT
 *     (`ai_recommendation_absent: true`, `briefing: null`). The deterministic
 *     spatial result is IDENTICAL whether or not Ironpine is present; Ironpine
 *     only ever augments.
 */

import type { TacticalBriefing } from "@virtualhems/contracts";

import {
  recommendFacility,
  type FacilityProvenance,
  type RankedFacility,
  type RecommendationResult,
  type RecommendFacilityDependencies,
  type RecommendFacilityInput,
  type RouteConstraints,
  type WeatherObservation,
  type CheckResult,
} from "./recommendation.js";

// --- Complete recommended-facility provenance (req 5.2) ---------------------

/**
 * The complete provenance record required by req 5.2 for a RECOMMENDED facility.
 * It reuses the core {@link FacilityProvenance} from 11.1 (evaluated capability,
 * helipad status, per-check results, missing inputs, score, distance, eligible)
 * and adds the two elements req 5.2 names explicitly that the core only summarised
 * as a check status: the full weather OBSERVATION and the full route-constraint
 * RESULT that the recommendation was evaluated against.
 */
export interface RecommendedFacilityProvenance extends FacilityProvenance {
  /**
   * The full weather observation the recommendation was evaluated against
   * (req 5.2 "weather observation"). `null` when no observation was available at
   * evaluation time — such a facility could never have been ranked (req 5.8), so
   * for a recommended facility this is effectively always populated.
   */
  weather_observation: WeatherObservation | null;
  /**
   * The route constraints applied plus the route check's result (req 5.2
   * "route-constraint result"). Surfaces the concrete constraints and the
   * pass/fail/missing outcome that made the route permissible.
   */
  route_constraint: {
    constraints: RouteConstraints;
    result: CheckResult;
  };
}

/**
 * A recommended facility carried in the augmented result. It is the 11.1
 * {@link RankedFacility} with its provenance widened to the complete req-5.2
 * record.
 */
export interface RecommendedFacility extends Omit<RankedFacility, "provenance"> {
  provenance: RecommendedFacilityProvenance;
}

/**
 * Build the complete req-5.2 provenance for one ranked facility. Pure: it copies
 * the core provenance produced by 11.1 and attaches the full weather observation
 * and the route-constraint result the facility was evaluated under. It never
 * changes the facility's score, distance, eligibility, or ordering.
 */
function completeProvenance(
  ranked: RankedFacility,
  weather: WeatherObservation | undefined,
  constraints: RouteConstraints,
): RecommendedFacilityProvenance {
  return {
    ...ranked.provenance,
    weather_observation: weather ?? null,
    route_constraint: {
      constraints,
      result: ranked.provenance.checks.ROUTE,
    },
  };
}

// --- Ironpine briefing port (design Section 4.6 seam; req 5.7) --------------

/**
 * The context handed to the Ironpine boundary: the exact deterministic result
 * the service computed plus the inputs it was computed from. Ironpine may use
 * this to produce an explainable {@link TacticalBriefing}; it MUST NOT influence
 * the deterministic ranking (the service has already computed and frozen it).
 */
export interface IronpineBriefingContext {
  input: RecommendFacilityInput;
  result: RecommendationResult;
}

/**
 * The Ironpine tactical-briefing seam (design Section 4.6). Injected so the AI
 * boundary is decoupled and MAY be unavailable (req 5.7). Implementations return
 * either an available briefing or an explicit unavailable marker; the wrapper
 * ALSO treats a thrown error or an absent port as unavailable, so no single
 * failure mode of the AI boundary can break the deterministic service.
 *
 * `generateBriefing` may be synchronous or asynchronous — a real provider will
 * be async — hence the wrapper is async.
 */
export interface IronpineBriefingPort {
  generateBriefing(
    context: IronpineBriefingContext,
  ):
    | IronpineBriefingOutcome
    | Promise<IronpineBriefingOutcome>;
}

/** What an Ironpine port returns: an available briefing or an unavailable signal. */
export type IronpineBriefingOutcome =
  | { available: true; briefing: TacticalBriefing }
  | { available: false; reason?: string };

// --- Augmented result (req 5.2 + 5.7) ---------------------------------------

/**
 * The Recommendation_Service result once req 5.2 provenance and the req 5.7
 * Ironpine fallback are applied. It carries the SAME deterministic outcome and
 * ordering as the 11.1 core ({@link RecommendationResult}) with the ranked
 * facilities widened to complete provenance, plus the AI-briefing status.
 *
 * When Ironpine is available: `ai_recommendation_absent === false` and
 * `briefing` is the {@link TacticalBriefing}. When Ironpine is unavailable:
 * `ai_recommendation_absent === true`, `briefing === null`, and
 * `ai_absent_reason` explains why — the deterministic ranking is unchanged.
 */
export interface BriefedRecommendationResult {
  outcome: RecommendationResult["outcome"];
  /** Ranked eligible facilities with complete req-5.2 provenance. */
  ranked: RecommendedFacility[];
  /** Provenance for EVERY evaluated candidate (unchanged from the core). */
  evaluated: FacilityProvenance[];
  requires_human_selection: boolean;
  /**
   * The deterministic spatial-only result (req 5.7): exactly what the service
   * returns/ranks independent of the AI boundary. Always present and identical
   * whether or not Ironpine is available.
   */
  deterministic: RecommendationResult;
  /** True exactly when the AI (Ironpine) recommendation is ABSENT (req 5.7). */
  ai_recommendation_absent: boolean;
  /** The Ironpine tactical briefing, or `null` when the AI output is absent (req 5.7). */
  briefing: TacticalBriefing | null;
  /** When the AI output is absent, why (port absent / unavailable / error). */
  ai_absent_reason?: string;
}

/** Dependencies for the briefed recommendation: the 11.1 core deps + Ironpine. */
export interface RecommendWithBriefingDependencies
  extends RecommendFacilityDependencies {
  /**
   * The Ironpine briefing boundary. OPTIONAL: when omitted the AI output is
   * simply absent (req 5.7) and the deterministic result is returned as-is.
   */
  ironpine?: IronpineBriefingPort;
}

/**
 * Recommend receiving facilities and, when the Ironpine boundary is available,
 * augment the deterministic result with a tactical briefing (design Section 4.6,
 * req 5.2 + 5.7).
 *
 * Control flow:
 *   1. Compute the deterministic spatial ranking via the unchanged 11.1 core
 *      ({@link recommendFacility}). This is the authoritative eligibility/order
 *      and is frozen here (req 5.1/5.3/5.4/5.5 preserved).
 *   2. Widen each ranked facility's provenance to the complete req-5.2 record
 *      (weather observation + route-constraint result attached).
 *   3. Attempt the Ironpine boundary. Absent port, thrown error, or an explicit
 *      `available: false` all resolve to AI ABSENT — `briefing` is null and
 *      `ai_recommendation_absent` is true (req 5.7). A successful call attaches
 *      the {@link TacticalBriefing} and marks AI present.
 *
 * The AI boundary can NEVER change the deterministic ranking: it is only read
 * the frozen result and its output is only ever attached alongside.
 */
export async function recommendWithBriefing(
  input: RecommendFacilityInput,
  deps: RecommendWithBriefingDependencies,
): Promise<BriefedRecommendationResult> {
  const constraints: RouteConstraints = input.constraints ?? {};

  // 1. Deterministic spatial-only result — the authoritative ranking (req 5.7).
  const deterministic = recommendFacility(input, deps);

  // 2. Complete req-5.2 provenance for each RECOMMENDED (ranked) facility.
  const ranked: RecommendedFacility[] = deterministic.ranked.map((r) => ({
    facility: r.facility,
    score: r.score,
    distance_nm: r.distance_nm,
    provenance: completeProvenance(r, input.weather, constraints),
  }));

  const base = {
    outcome: deterministic.outcome,
    ranked,
    evaluated: deterministic.evaluated,
    requires_human_selection: deterministic.requires_human_selection,
    deterministic,
  } satisfies Omit<
    BriefedRecommendationResult,
    "ai_recommendation_absent" | "briefing" | "ai_absent_reason"
  >;

  // 3. Ironpine augmentation (req 5.7). Any failure mode ⇒ AI absent.
  if (deps.ironpine === undefined) {
    return {
      ...base,
      ai_recommendation_absent: true,
      briefing: null,
      ai_absent_reason: "Ironpine briefing boundary is not configured",
    };
  }

  try {
    const outcome = await deps.ironpine.generateBriefing({ input, result: deterministic });
    if (outcome.available) {
      return {
        ...base,
        ai_recommendation_absent: false,
        briefing: outcome.briefing,
      };
    }
    return {
      ...base,
      ai_recommendation_absent: true,
      briefing: null,
      ai_absent_reason:
        outcome.reason ?? "Ironpine briefing boundary reported unavailable",
    };
  } catch (error) {
    return {
      ...base,
      ai_recommendation_absent: true,
      briefing: null,
      ai_absent_reason: `Ironpine briefing boundary error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

// --- Test / deterministic Ironpine stubs (req 5.7 seam) ---------------------

/**
 * An {@link IronpineBriefingPort} that is always UNAVAILABLE (req 5.7 fallback
 * path). Use it to exercise the deterministic spatial-only behaviour with the AI
 * boundary explicitly down.
 */
export class UnavailableIronpineBriefing implements IronpineBriefingPort {
  constructor(private readonly reason?: string) {}

  generateBriefing(): IronpineBriefingOutcome {
    return { available: false, reason: this.reason };
  }
}

/**
 * An {@link IronpineBriefingPort} that always throws — models an AI boundary
 * whose failure surfaces as an error rather than a clean unavailable signal. The
 * wrapper must still degrade to AI ABSENT (req 5.7).
 */
export class ThrowingIronpineBriefing implements IronpineBriefingPort {
  constructor(private readonly message = "Ironpine boundary failed") {}

  generateBriefing(): IronpineBriefingOutcome {
    throw new Error(this.message);
  }
}

/**
 * An in-memory {@link IronpineBriefingPort} that returns a fixed
 * {@link TacticalBriefing} for tests and deterministic use. It derives the
 * recommended facility from the frozen deterministic result (top ranked, if any)
 * unless a briefing override is supplied, so the stub reflects the same ranking
 * the service already computed.
 */
export class InMemoryIronpineBriefing implements IronpineBriefingPort {
  constructor(private readonly briefing?: Partial<TacticalBriefing>) {}

  generateBriefing(context: IronpineBriefingContext): IronpineBriefingOutcome {
    const top = context.result.ranked[0];
    const briefing: TacticalBriefing = {
      recommended_facility_id: undefined,
      recommended_lz: undefined,
      warnings: [],
      assumptions: [],
      input_snapshot_hash: "in-memory-ironpine",
      generated_at: "1970-01-01T00:00:00.000Z",
      provenance: "in-memory Ironpine stub",
      ...this.briefing,
    };
    // Only default the facility id from the ranking when not overridden.
    if (this.briefing?.recommended_facility_id === undefined && top !== undefined) {
      briefing.recommended_facility_id = top.facility.id;
    }
    return { available: true, briefing };
  }
}
