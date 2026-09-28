import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SCHEMA_VERSION } from "./index.js";

describe("@virtualhems/contracts tooling smoke test", () => {
  it("exposes a non-empty schema version string of at most 32 characters", () => {
    expect(typeof SCHEMA_VERSION).toBe("string");
    expect(SCHEMA_VERSION.length).toBeGreaterThan(0);
    expect(SCHEMA_VERSION.length).toBeLessThanOrEqual(32);
  });

  it("fast-check is wired up (property runner executes)", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
    );
  });
});
