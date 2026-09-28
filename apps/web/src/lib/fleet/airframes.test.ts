import { describe, expect, it } from "vitest";
import { APPROVED_AIRFRAME_MODELS, FLEET, airframeByModel } from "./airframes";

/**
 * Smoke tests for the approved fleet catalog (task 17.1; Requirement 10.4).
 */
describe("fleet catalog", () => {
  it("includes all four approved airframes (10.4)", () => {
    expect(FLEET.map((a) => a.model)).toEqual([
      "EC135",
      "EC145",
      "H135",
      "Bell 407",
    ]);
    expect(FLEET).toHaveLength(APPROVED_AIRFRAME_MODELS.length);
  });

  it("gives every airframe non-empty capability information (10.4)", () => {
    for (const airframe of FLEET) {
      expect(airframe.manufacturer.length).toBeGreaterThan(0);
      expect(airframe.role.length).toBeGreaterThan(0);
      expect(airframe.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("looks up an approved airframe and rejects an unknown one", () => {
    expect(airframeByModel("H135")?.model).toBe("H135");
    expect(airframeByModel("AW139")).toBeUndefined();
  });
});
