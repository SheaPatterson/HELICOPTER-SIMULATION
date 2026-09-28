import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  metersToFeet,
  feetToMeters,
  metersToNauticalMiles,
  nauticalMilesToMeters,
  metersPerSecondToKnots,
  knotsToMetersPerSecond,
  metersPerSecondToFeetPerMinute,
  feetPerMinuteToMetersPerSecond,
  kilogramsToPounds,
  poundsToKilograms,
  radiansToDegrees,
  degreesToRadians,
  kelvinToCelsius,
  fahrenheitToCelsius,
  normalizeHeadingDeg,
  normalizeLongitudeDeg,
  clamp,
} from "./units.js";
import { SIMULATOR_ENGINES, isSimulatorEngine } from "./telemetry.js";

/**
 * Unit tests for the contract normalization helpers (design Section 6.1,
 * task 1.3, Requirement 1.4). Covers unit conversions (known values and
 * round-trips), the SimulatorEngine enumeration guard, and heading/longitude
 * normalization including edge cases.
 */

/** Finite, "reasonable magnitude" doubles for round-trip properties. */
const finiteValue = fc.double({
  min: -1e9,
  max: 1e9,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Relative tolerance comparison that also handles values near zero. */
function expectClose(actual: number, expected: number, epsilon = 1e-9): void {
  const scale = Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon * scale);
}

describe("length conversions", () => {
  it("converts known meter/foot values", () => {
    expect(metersToFeet(0.3048)).toBeCloseTo(1, 10);
    expect(feetToMeters(1)).toBeCloseTo(0.3048, 10);
    expect(metersToFeet(0)).toBe(0);
  });

  it("converts known meter/nautical-mile values", () => {
    expect(metersToNauticalMiles(1852)).toBeCloseTo(1, 10);
    expect(nauticalMilesToMeters(1)).toBeCloseTo(1852, 10);
  });

  it("round-trips meters -> feet -> meters", () => {
    fc.assert(
      fc.property(finiteValue, (m) => {
        expectClose(feetToMeters(metersToFeet(m)), m);
      }),
    );
  });

  it("round-trips meters -> nautical miles -> meters", () => {
    fc.assert(
      fc.property(finiteValue, (m) => {
        expectClose(nauticalMilesToMeters(metersToNauticalMiles(m)), m);
      }),
    );
  });
});

describe("speed conversions", () => {
  it("converts known m/s <-> knots values (1 kt = 1852 m / 3600 s)", () => {
    expect(knotsToMetersPerSecond(1)).toBeCloseTo(1852 / 3600, 12);
    expect(metersPerSecondToKnots(1852 / 3600)).toBeCloseTo(1, 10);
  });

  it("converts known m/s <-> ft/min values (1 m/s = 196.850... ft/min)", () => {
    expect(metersPerSecondToFeetPerMinute(1)).toBeCloseTo(60 / 0.3048, 8);
    expect(feetPerMinuteToMetersPerSecond(60 / 0.3048)).toBeCloseTo(1, 10);
  });

  it("round-trips m/s -> knots -> m/s", () => {
    fc.assert(
      fc.property(finiteValue, (mps) => {
        expectClose(knotsToMetersPerSecond(metersPerSecondToKnots(mps)), mps);
      }),
    );
  });

  it("round-trips m/s -> ft/min -> m/s", () => {
    fc.assert(
      fc.property(finiteValue, (mps) => {
        expectClose(
          feetPerMinuteToMetersPerSecond(metersPerSecondToFeetPerMinute(mps)),
          mps,
        );
      }),
    );
  });
});

describe("mass conversions", () => {
  it("converts known kilogram/pound values", () => {
    expect(poundsToKilograms(1)).toBeCloseTo(0.45359237, 12);
    expect(kilogramsToPounds(0.45359237)).toBeCloseTo(1, 10);
  });

  it("round-trips kg -> lbs -> kg", () => {
    fc.assert(
      fc.property(finiteValue, (kg) => {
        expectClose(poundsToKilograms(kilogramsToPounds(kg)), kg);
      }),
    );
  });
});

describe("angle conversions", () => {
  it("converts known radian/degree values", () => {
    expect(radiansToDegrees(Math.PI)).toBeCloseTo(180, 10);
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI, 12);
    expect(radiansToDegrees(0)).toBe(0);
  });

  it("round-trips radians -> degrees -> radians", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (rad) => {
          expectClose(degreesToRadians(radiansToDegrees(rad)), rad);
        },
      ),
    );
  });
});

describe("temperature conversions", () => {
  it("converts known kelvin values", () => {
    expect(kelvinToCelsius(273.15)).toBeCloseTo(0, 10);
    expect(kelvinToCelsius(373.15)).toBeCloseTo(100, 10);
  });

  it("converts known Fahrenheit values", () => {
    expect(fahrenheitToCelsius(32)).toBeCloseTo(0, 10);
    expect(fahrenheitToCelsius(212)).toBeCloseTo(100, 10);
    expect(fahrenheitToCelsius(-40)).toBeCloseTo(-40, 10);
  });
});

describe("isSimulatorEngine / SIMULATOR_ENGINES", () => {
  it("enumerates exactly the four supported engines", () => {
    expect([...SIMULATOR_ENGINES]).toEqual([
      "MSFS2020",
      "MSFS2024",
      "XPLANE11",
      "XPLANE12",
    ]);
  });

  it("accepts every supported engine", () => {
    for (const engine of SIMULATOR_ENGINES) {
      expect(isSimulatorEngine(engine)).toBe(true);
    }
  });

  it("rejects unknown strings (case-sensitive)", () => {
    expect(isSimulatorEngine("msfs2020")).toBe(false);
    expect(isSimulatorEngine("MSFS")).toBe(false);
    expect(isSimulatorEngine("XPLANE")).toBe(false);
    expect(isSimulatorEngine("")).toBe(false);
    expect(isSimulatorEngine("PREPAR3D")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isSimulatorEngine(undefined)).toBe(false);
    expect(isSimulatorEngine(null)).toBe(false);
    expect(isSimulatorEngine(0)).toBe(false);
    expect(isSimulatorEngine(123)).toBe(false);
    expect(isSimulatorEngine({})).toBe(false);
    expect(isSimulatorEngine(["MSFS2020"])).toBe(false);
    expect(isSimulatorEngine(true)).toBe(false);
  });

  it("rejects any string not in the enumeration (property)", () => {
    const supported = new Set<string>(SIMULATOR_ENGINES);
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(isSimulatorEngine(s)).toBe(supported.has(s));
      }),
    );
  });
});

describe("normalizeHeadingDeg", () => {
  it("leaves in-range headings unchanged", () => {
    expect(normalizeHeadingDeg(0)).toBe(0);
    expect(normalizeHeadingDeg(90)).toBe(90);
    expect(normalizeHeadingDeg(359.9)).toBeCloseTo(359.9, 10);
  });

  it("maps 360 (upper bound) to 0", () => {
    expect(normalizeHeadingDeg(360)).toBe(0);
  });

  it("wraps negative headings into [0, 360)", () => {
    expect(normalizeHeadingDeg(-1)).toBeCloseTo(359, 10);
    expect(normalizeHeadingDeg(-90)).toBeCloseTo(270, 10);
    // -360 wraps to 0 (may be -0, which is equal to 0 for our purposes).
    expect(normalizeHeadingDeg(-360)).toBeCloseTo(0, 10);
  });

  it("wraps multi-turn headings", () => {
    expect(normalizeHeadingDeg(720)).toBe(0);
    expect(normalizeHeadingDeg(450)).toBeCloseTo(90, 10);
    expect(normalizeHeadingDeg(-450)).toBeCloseTo(270, 10);
    expect(normalizeHeadingDeg(1080 + 45)).toBeCloseTo(45, 10);
  });

  it("keeps result strictly below 360 for tiny negative inputs (regression)", () => {
    // -5e-324 % 360 is a tiny negative whose +360 correction rounds to exactly
    // 360 in IEEE-754; the contract requires 360 to map to 0.
    expect(normalizeHeadingDeg(-5e-324)).toBeLessThan(360);
    expect(normalizeHeadingDeg(-5e-324)).toBe(0);
    expect(normalizeHeadingDeg(-Number.MIN_VALUE)).toBeLessThan(360);
  });

  it("passes non-finite values through unchanged", () => {
    expect(normalizeHeadingDeg(Number.NaN)).toBeNaN();
    expect(normalizeHeadingDeg(Number.POSITIVE_INFINITY)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(normalizeHeadingDeg(Number.NEGATIVE_INFINITY)).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it("always produces a value in [0, 360) for finite input (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e7, max: 1e7, noNaN: true, noDefaultInfinity: true }),
        (h) => {
          const n = normalizeHeadingDeg(h);
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThan(360);
        },
      ),
    );
  });

  it("is idempotent for finite input (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e7, max: 1e7, noNaN: true, noDefaultInfinity: true }),
        (h) => {
          const once = normalizeHeadingDeg(h);
          expectClose(normalizeHeadingDeg(once), once);
        },
      ),
    );
  });
});

describe("normalizeLongitudeDeg", () => {
  it("leaves in-range longitudes unchanged", () => {
    expect(normalizeLongitudeDeg(0)).toBe(0);
    expect(normalizeLongitudeDeg(-73.5)).toBe(-73.5);
    expect(normalizeLongitudeDeg(179.9)).toBe(179.9);
  });

  it("preserves the antimeridian bounds", () => {
    expect(normalizeLongitudeDeg(180)).toBe(180);
    expect(normalizeLongitudeDeg(-180)).toBe(-180);
  });

  it("wraps values past the antimeridian", () => {
    expect(normalizeLongitudeDeg(181)).toBeCloseTo(-179, 10);
    expect(normalizeLongitudeDeg(-181)).toBeCloseTo(179, 10);
    expect(normalizeLongitudeDeg(540)).toBeCloseTo(-180, 10);
    expect(normalizeLongitudeDeg(360)).toBeCloseTo(0, 10);
  });

  it("passes non-finite values through unchanged", () => {
    expect(normalizeLongitudeDeg(Number.NaN)).toBeNaN();
    expect(normalizeLongitudeDeg(Number.POSITIVE_INFINITY)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(normalizeLongitudeDeg(Number.NEGATIVE_INFINITY)).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it("always produces a value in [-180, 180] for finite input (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e7, max: 1e7, noNaN: true, noDefaultInfinity: true }),
        (lon) => {
          const n = normalizeLongitudeDeg(lon);
          expect(n).toBeGreaterThanOrEqual(-180);
          expect(n).toBeLessThanOrEqual(180);
        },
      ),
    );
  });
});

describe("clamp", () => {
  it("returns the value when inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("clamps to the bounds when out of range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("passes non-finite values through unchanged", () => {
    expect(clamp(Number.NaN, 0, 10)).toBeNaN();
    expect(clamp(Number.POSITIVE_INFINITY, 0, 10)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(clamp(Number.NEGATIVE_INFINITY, 0, 10)).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it("always returns a value within [min, max] for finite input (property)", () => {
    fc.assert(
      fc.property(
        finiteValue,
        finiteValue,
        finiteValue,
        (value, a, b) => {
          const min = Math.min(a, b);
          const max = Math.max(a, b);
          const c = clamp(value, min, max);
          expect(c).toBeGreaterThanOrEqual(min);
          expect(c).toBeLessThanOrEqual(max);
        },
      ),
    );
  });
});
