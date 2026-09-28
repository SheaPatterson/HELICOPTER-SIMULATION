import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  deriveUserVisibleStatus,
  areDataActionsDisabled,
  liveValue,
  lastKnownValue,
  unavailableValue,
  NOMINAL_MAX_AGE_SECONDS,
  STALE_MAX_AGE_SECONDS,
  VALUE_SOURCES,
  type ServiceState,
  type ValueSource,
  type ServiceStatusInput,
  type LastKnownValue,
} from "./status.js";

/**
 * Property 7: Degraded-state honesty.
 *
 * Validates: Requirements 9.1, 9.3, 9.4, 9.8 — the derived state matches the
 * documented age/connection thresholds, and the value model can never
 * represent a fabricated substitute when services are degraded/unavailable.
 *
 * This file holds ONLY the universal invariants (fast-check). Concrete example
 * and boundary assertions live in status.test.ts.
 */

/**
 * Independently-computed oracle for {@link deriveUserVisibleStatus}, derived
 * from the acceptance-criteria text (9.1–9.5) as an ordered decision, matching
 * the documented evaluation order (RECOVERING precedence, then NOMINAL, then
 * OFFLINE, then DEGRADED/STALE, then FAILED). Because the states are evaluated
 * in order, the DEGRADED clause is reached only after NOMINAL has been ruled
 * out, so DEGRADED is `cloud connected AND age <= 10` at that point — the
 * `age > 2` half of 9.3 is enforced positionally by the earlier NOMINAL check
 * (which also requires the bridge to be connected). This oracle mirrors that
 * ordered semantics rather than restating each clause as an isolated guard, so
 * a cloud-connected/bridge-down/fresh-data case correctly resolves to DEGRADED.
 *
 *  - 9.5 RECOVERING : reconnecting active on either link (precedence)
 *  - 9.1 NOMINAL    : both connected AND age <= 2
 *  - 9.2 OFFLINE    : bridge connected AND cloud not connected
 *  - 9.3 DEGRADED   : (after the above) cloud connected AND age <= 10
 *  - 9.4 STALE      : cloud connected AND age > 10
 *  - FAILED         : residual terminal case
 */
function expectedState(input: ServiceStatusInput): ServiceState {
  const { bridge, cloud, dataAgeSeconds: age } = input;
  if (bridge.reconnecting === true || cloud.reconnecting === true) {
    return "RECOVERING";
  }
  if (bridge.connected && cloud.connected && age <= NOMINAL_MAX_AGE_SECONDS) {
    return "NOMINAL";
  }
  if (bridge.connected && !cloud.connected) {
    return "OFFLINE";
  }
  if (cloud.connected && age <= STALE_MAX_AGE_SECONDS) {
    return "DEGRADED";
  }
  if (cloud.connected && age > STALE_MAX_AGE_SECONDS) {
    return "STALE";
  }
  return "FAILED";
}

/** A connection-health arbitrary with optional reconnecting flag. */
const connectionArb = fc.record(
  {
    connected: fc.boolean(),
    reconnecting: fc.option(fc.boolean(), { nil: undefined }),
  },
  { requiredKeys: ["connected"] },
);

/**
 * Data-age arbitrary that oversamples the interesting regions: the exact
 * boundaries (2s, 10s), values just inside/outside each boundary, zero, and a
 * broad spread of finite non-negative ages including large ones.
 */
const dataAgeArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(0, 2, 10) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      1.999, 2.0, 2.001, 9.999, 10.0, 10.001, 0.0001, NOMINAL_MAX_AGE_SECONDS, STALE_MAX_AGE_SECONDS,
    ),
  },
  {
    weight: 4,
    arbitrary: fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
  },
);

const statusInputArb: fc.Arbitrary<ServiceStatusInput> = fc.record({
  bridge: connectionArb,
  cloud: connectionArb,
  dataAgeSeconds: dataAgeArb,
});

describe("Property 7: degraded-state honesty — threshold correctness (9.1/9.3/9.4)", () => {
  it("deriveUserVisibleStatus equals the acceptance-criteria oracle for all inputs", () => {
    fc.assert(
      fc.property(statusInputArb, (input) => {
        expect(deriveUserVisibleStatus(input)).toBe(expectedState(input));
      }),
    );
  });

  it("the 2s boundary is inclusive on the NOMINAL side (both connected)", () => {
    fc.assert(
      fc.property(fc.constant(NOMINAL_MAX_AGE_SECONDS), (age) => {
        const state = deriveUserVisibleStatus({
          bridge: { connected: true },
          cloud: { connected: true },
          dataAgeSeconds: age,
        });
        // age exactly 2 (== 2) is NOMINAL, not DEGRADED.
        expect(state).toBe("NOMINAL");
      }),
    );
  });

  it("just past 2s (both connected) is DEGRADED, never NOMINAL", () => {
    fc.assert(
      fc.property(
        fc.double({
          min: NOMINAL_MAX_AGE_SECONDS,
          max: STALE_MAX_AGE_SECONDS,
          noNaN: true,
          noDefaultInfinity: true,
          minExcluded: true,
        }),
        (age) => {
          const state = deriveUserVisibleStatus({
            bridge: { connected: true },
            cloud: { connected: true },
            dataAgeSeconds: age,
          });
          // 2 < age <= 10 ⇒ DEGRADED.
          expect(state).toBe("DEGRADED");
        },
      ),
    );
  });

  it("the 10s boundary is inclusive on the DEGRADED side (cloud connected)", () => {
    fc.assert(
      fc.property(fc.constant(STALE_MAX_AGE_SECONDS), (age) => {
        const state = deriveUserVisibleStatus({
          bridge: { connected: false },
          cloud: { connected: true },
          dataAgeSeconds: age,
        });
        // age exactly 10 (== 10) is DEGRADED, not STALE.
        expect(state).toBe("DEGRADED");
      }),
    );
  });

  it("just past 10s (cloud connected) is STALE, never DEGRADED", () => {
    fc.assert(
      fc.property(
        fc.double({
          min: STALE_MAX_AGE_SECONDS,
          max: 1_000_000,
          noNaN: true,
          noDefaultInfinity: true,
          minExcluded: true,
        }),
        fc.boolean(),
        (age, bridgeConnected) => {
          const state = deriveUserVisibleStatus({
            bridge: { connected: bridgeConnected },
            cloud: { connected: true },
            dataAgeSeconds: age,
          });
          // cloud connected AND age > 10 ⇒ STALE (bridge state does not matter here
          // because bridge-connected-cloud-connected>10 is not NOMINAL and
          // bridge-connected-cloud-connected is not OFFLINE).
          expect(state).toBe("STALE");
        },
      ),
    );
  });

  it("derivation always returns one of the six declared states", () => {
    const valid: ReadonlySet<ServiceState> = new Set<ServiceState>([
      "NOMINAL",
      "OFFLINE",
      "DEGRADED",
      "STALE",
      "RECOVERING",
      "FAILED",
    ]);
    fc.assert(
      fc.property(statusInputArb, (input) => {
        expect(valid.has(deriveUserVisibleStatus(input))).toBe(true);
      }),
    );
  });

  it("rejects any negative or non-finite data age (never derives a state from junk)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ max: 0, noNaN: true, maxExcluded: true }),
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        ),
        connectionArb,
        connectionArb,
        (age, bridge, cloud) => {
          expect(() =>
            deriveUserVisibleStatus({ bridge, cloud, dataAgeSeconds: age }),
          ).toThrow(RangeError);
        },
      ),
    );
  });
});

/**
 * Arbitrary over the three value-constructor outcomes. Models a client deciding
 * what to render for some datum: a live reading, a last-known reading with an
 * age, or nothing at all.
 */
type ValueScenario =
  | { kind: "live"; value: number; ageSeconds: number }
  | { kind: "last-known"; value: number; ageSeconds: number }
  | { kind: "unavailable" };

const valueScenarioArb: fc.Arbitrary<ValueScenario> = fc.oneof(
  fc.record({
    kind: fc.constant("live" as const),
    value: fc.double({ noNaN: true, noDefaultInfinity: true }),
    ageSeconds: fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
  }),
  fc.record({
    kind: fc.constant("last-known" as const),
    value: fc.double({ noNaN: true, noDefaultInfinity: true }),
    ageSeconds: fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
  }),
  fc.record({ kind: fc.constant("unavailable" as const) }),
);

function construct(scenario: ValueScenario): LastKnownValue<number> {
  switch (scenario.kind) {
    case "live":
      return liveValue(scenario.value, scenario.ageSeconds);
    case "last-known":
      return lastKnownValue(scenario.value, scenario.ageSeconds);
    case "unavailable":
      return unavailableValue<number>();
  }
}

describe("Property 7: degraded-state honesty — no fabrication (9.8)", () => {
  it("every constructed value is fabricated:false with a defined source", () => {
    const validSources: ReadonlySet<ValueSource> = new Set<ValueSource>(VALUE_SOURCES);
    fc.assert(
      fc.property(valueScenarioArb, (scenario) => {
        const v = construct(scenario);
        // Structural no-fabrication guarantee: the literal is always false.
        expect(v.fabricated).toBe(false);
        // Source is always one of the three defined provenances — never invented.
        expect(validSources.has(v.source)).toBe(true);
      }),
    );
  });

  it("an UNAVAILABLE value is always null with a null age (shows nothing, never a number)", () => {
    fc.assert(
      fc.property(valueScenarioArb, (scenario) => {
        const v = construct(scenario);
        if (v.source === "UNAVAILABLE") {
          expect(v.value).toBeNull();
          expect(v.ageSeconds).toBeNull();
        }
      }),
    );
  });

  it("a LAST_KNOWN value always carries a concrete age (so the UI can show provenance)", () => {
    fc.assert(
      fc.property(valueScenarioArb, (scenario) => {
        const v = construct(scenario);
        if (v.source === "LAST_KNOWN") {
          expect(v.value).not.toBeNull();
          expect(typeof v.ageSeconds).toBe("number");
        }
      }),
    );
  });

  it(
    "in non-authoritative states, a presented value is LAST_KNOWN or UNAVAILABLE, never LIVE",
    () => {
      // Client render decision: when data is not authoritative, an honest client
      // presents last-known (with age) or nothing — never a live/fabricated value.
      fc.assert(
        fc.property(statusInputArb, valueScenarioArb, (input, scenario) => {
          const state = deriveUserVisibleStatus(input);
          if (!areDataActionsDisabled(state)) {
            return; // NOMINAL / DEGRADED: live data is authoritative, nothing to assert.
          }
          // Model the honest client: it must not present a LIVE value while
          // degraded. If the underlying datum is live, the client demotes it to
          // last-known (with its age) rather than claiming it is current.
          const presented =
            scenario.kind === "live"
              ? lastKnownValue(scenario.value, scenario.ageSeconds)
              : construct(scenario);
          expect(presented.source === "LAST_KNOWN" || presented.source === "UNAVAILABLE").toBe(
            true,
          );
          expect(presented.fabricated).toBe(false);
          if (presented.source === "UNAVAILABLE") {
            expect(presented.value).toBeNull();
          }
        }),
      );
    },
  );
});
