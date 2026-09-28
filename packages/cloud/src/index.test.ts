import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CLOUD_CONTRACT_SCHEMA_VERSION } from "./index.js";

describe("@virtualhems/cloud tooling smoke test", () => {
  it("re-exports the shared contract schema version across the package boundary", () => {
    expect(typeof CLOUD_CONTRACT_SCHEMA_VERSION).toBe("string");
    expect(CLOUD_CONTRACT_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });

  it("fast-check is wired up (property runner executes)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (xs) => {
        return [...xs].reverse().reverse().length === xs.length;
      }),
    );
  });
});
