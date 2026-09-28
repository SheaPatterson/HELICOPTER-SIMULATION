import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SCHEMA_VERSION } from "@virtualhems/contracts";

describe("@virtualhems/web tooling smoke test", () => {
  it("consumes the shared contract schema version", () => {
    expect(typeof SCHEMA_VERSION).toBe("string");
    expect(SCHEMA_VERSION.length).toBeGreaterThan(0);
  });

  it("fast-check is wired up (property runner executes)", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        return [...s].length >= 0;
      }),
    );
  });
});
