import { describe, expect, it } from "vitest";
import type { Helipad } from "@virtualhems/contracts";
import {
  checklistProgress,
  defaultMissionChecklists,
  resolveHelipadBriefing,
  toggleChecklistItem,
} from "./checklist-briefing";

/**
 * Unit tests for the pure EFB checklist + helipad/LZ briefing core (task 13.2;
 * Requirement 6.7): interactive toggle/completion logic and attribute-driven,
 * non-fabricated briefing derivation.
 */

function helipad(overrides: Partial<Helipad> = {}): Helipad {
  return {
    id: "pad-1",
    name: "Allegheny General Rooftop",
    faa_id: "0PA5",
    city: "Pittsburgh",
    state: "PA",
    elevation_ft: 1223,
    coordinates: { latitude_deg: 40.4577, longitude_deg: -80.0122 },
    surface: "CONCRETE",
    placement: "ROOFTOP",
    dimensions_ft: "60x60",
    capability: "LEVEL_I_TRAUMA",
    ...overrides,
  };
}

describe("defaultMissionChecklists (6.7)", () => {
  it("provides named checklists whose items all start unchecked", () => {
    const lists = defaultMissionChecklists();
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      expect(list.items.length).toBeGreaterThan(0);
      expect(list.items.every((it) => it.checked === false)).toBe(true);
    }
  });
});

describe("toggleChecklistItem (6.7 interactive)", () => {
  it("toggles only the targeted item and does not mutate the input", () => {
    const before = defaultMissionChecklists();
    const targetList = before[0]!;
    const targetItem = targetList.items[0]!;

    const after = toggleChecklistItem(before, targetList.id, targetItem.id);

    // Input untouched (pure).
    expect(before[0]!.items[0]!.checked).toBe(false);
    // Targeted item flipped.
    const flipped = after[0]!.items[0]!;
    expect(flipped.checked).toBe(true);
    // Sibling item unchanged.
    expect(after[0]!.items[1]!.checked).toBe(false);
    // Other checklists unchanged by reference.
    expect(after[1]).toBe(before[1]);
  });

  it("toggles back off on a second toggle", () => {
    const lists = defaultMissionChecklists();
    const id = lists[0]!.id;
    const itemId = lists[0]!.items[0]!.id;
    const once = toggleChecklistItem(lists, id, itemId);
    const twice = toggleChecklistItem(once, id, itemId);
    expect(twice[0]!.items[0]!.checked).toBe(false);
  });
});

describe("checklistProgress (6.7)", () => {
  it("counts checked items and reports completion", () => {
    let lists = defaultMissionChecklists();
    const list = lists[0]!;
    expect(checklistProgress(list).complete).toBe(false);

    for (const it of list.items) {
      lists = toggleChecklistItem(lists, list.id, it.id);
    }
    const progress = checklistProgress(lists[0]!);
    expect(progress.checked).toBe(progress.total);
    expect(progress.complete).toBe(true);
  });
});

describe("resolveHelipadBriefing (6.7)", () => {
  it("derives navigation/LZ content from the destination helipad, not fabricated", () => {
    const briefing = resolveHelipadBriefing(helipad());
    expect(briefing.available).toBe(true);
    if (!briefing.available) return;
    expect(briefing.facilityName).toBe("Allegheny General Rooftop");
    expect(briefing.faaId).toBe("0PA5");
    expect(briefing.coordinates).toEqual({ lat: 40.4577, lon: -80.0122 });
    expect(briefing.elevationFt).toBe(1223);
    expect(briefing.placement).toBe("ROOFTOP");
    // Rooftop-specific LZ note is present.
    expect(briefing.briefingNotes.some((n) => /rooftop/i.test(n))).toBe(true);
  });

  it("gives a ground-level note for a ground pad", () => {
    const briefing = resolveHelipadBriefing(
      helipad({ placement: "GROUND", surface: "ASPHALT" }),
    );
    if (!briefing.available) throw new Error("expected available");
    expect(briefing.briefingNotes.some((n) => /ground-level/i.test(n))).toBe(
      true,
    );
  });

  it("returns an explicit unavailable result when no helipad is known", () => {
    const briefing = resolveHelipadBriefing(null);
    expect(briefing.available).toBe(false);
    if (briefing.available) return;
    expect(briefing.reason.length).toBeGreaterThan(0);
  });
});
