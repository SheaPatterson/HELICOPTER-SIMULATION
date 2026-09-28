import { describe, expect, it } from "vitest";
import {
  SIMULATION_ONLY_POLICY,
  containsRealIdentifiers,
  rejectIfContainsRealIdentifiers,
  scanForIdentifiers,
  type PiiIdentifierKind,
} from "./pii.js";

describe("scanForIdentifiers — true positives (req 8.9)", () => {
  const cases: Array<[PiiIdentifierKind, string]> = [
    ["SSN", "Patient SSN 123-45-6789 on file"],
    ["MRN", "MRN: A123456 admitted"],
    ["PHONE", "Call next of kin at (412) 555-0199"],
    ["PHONE", "reach at 412-555-0199 today"],
    ["EMAIL", "notify jane.doe@example.com immediately"],
    ["DOB", "DOB: 04/12/1980 recorded"],
    ["NAME_DOB", "John Smith 04/12/1980 presents with chest pain"],
  ];

  it.each(cases)("detects %s", (kind, text) => {
    const matches = scanForIdentifiers(text);
    expect(matches.some((m) => m.kind === kind)).toBe(true);
    expect(containsRealIdentifiers(text)).toBe(true);
  });

  it("returns a simulation-only violation naming the policy and persisting nothing", () => {
    const result = rejectIfContainsRealIdentifiers("Patient SSN 123-45-6789");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.policy).toBe(SIMULATION_ONLY_POLICY);
      expect(result.message).toMatch(/simulation-only data policy/i);
      expect(result.kinds).toContain("SSN");
      expect(result.matches.length).toBeGreaterThan(0);
    }
  });
});

describe("scanForIdentifiers — false positives avoided (req 8.9)", () => {
  const clean = [
    "45 y/o male, GCS 14, chest pain, onset 20 minutes ago",
    "Vitals: HR 110, BP 90/60, SpO2 92%, RR 22",
    "Golden Hour elapsed 00:23:11, scene time 12 minutes",
    "ICD S06.0 concussion, decay rate 0.5 per minute",
    "Sequence 12345678 received at 2024-06-01T12:00:00.000Z",
    "Administered 250 mL saline and 4 mg morphine",
  ];

  it.each(clean)("does not flag simulated clinical text: %s", (text) => {
    expect(scanForIdentifiers(text)).toEqual([]);
    expect(containsRealIdentifiers(text)).toBe(false);
  });

  it("accepts clean input for persistence", () => {
    const result = rejectIfContainsRealIdentifiers("45 y/o male, GCS 14");
    expect(result.ok).toBe(true);
  });

  it("treats empty / non-string input as clean", () => {
    expect(scanForIdentifiers("")).toEqual([]);
    // @ts-expect-error exercising defensive runtime guard
    expect(scanForIdentifiers(undefined)).toEqual([]);
  });
});

describe("scanForIdentifiers — multiple identifiers", () => {
  it("reports all matches in ascending text order", () => {
    const text = "MRN: A123456; email jane@x.com; SSN 123-45-6789";
    const matches = scanForIdentifiers(text);
    const kinds = new Set(matches.map((m) => m.kind));
    expect(kinds.has("MRN")).toBe(true);
    expect(kinds.has("EMAIL")).toBe(true);
    expect(kinds.has("SSN")).toBe(true);
    const indices = matches.map((m) => m.index);
    expect([...indices]).toEqual([...indices].sort((a, b) => a - b));
  });
});
