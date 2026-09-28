/**
 * Cockpit EFB interactive checklists + helipad navigation / LZ briefing content
 * (design Section 3.2 "EFB components: ... checklist, navigation/briefing";
 * task 13.2; Requirement 6.7).
 *
 * PURE, framework-free data model + derivation for the two crew-facing content
 * surfaces Requirement 6.7 names:
 *  - interactive checklists for the assigned mission, and
 *  - hospital helipad navigation + landing-zone briefing content.
 *
 * "Interactive" is delivered by the React layer holding per-item checked state;
 * this module owns the immutable content model + the pure state transitions
 * (toggle an item, compute completion) so the toggle/completion logic is
 * unit-testable without React. The LZ briefing is DERIVED from the assigned
 * mission's destination {@link Helipad} record (helipad attributes already exist
 * in the infrastructure contract / hospitals seed) rather than fabricated, so
 * the EFB shows the facility's real navigation/LZ attributes.
 */

import type { Helipad } from "@virtualhems/contracts";

/** A single checklist item (Requirement 6.7). */
export interface ChecklistItem {
  /** Stable id, unique within its checklist. */
  id: string;
  /** The crew-facing instruction / challenge text. */
  label: string;
  /** Whether the crew has checked this item off. */
  checked: boolean;
}

/** A named checklist (e.g. "Before Landing") for the assigned mission (6.7). */
export interface Checklist {
  id: string;
  title: string;
  items: ChecklistItem[];
}

/**
 * The standard cockpit-EFB checklists for a mission (Requirement 6.7). Content
 * is intentionally a small, deterministic default set; a later task can source
 * mission-type-specific checklists from policy. All items start unchecked.
 */
export function defaultMissionChecklists(): Checklist[] {
  return [
    {
      id: "before-takeoff",
      title: "Before Takeoff",
      items: [
        item("btf-crew-brief", "Crew brief complete"),
        item("btf-weight-balance", "Weight and balance confirmed"),
        item("btf-fuel", "Fuel state and reserve verified"),
        item("btf-pave", "PAVE risk disposition reviewed"),
      ],
    },
    {
      id: "before-scene-landing",
      title: "Before Scene Landing",
      items: [
        item("bsl-lz-recon", "LZ reconnaissance complete"),
        item("bsl-obstacles", "Obstacles and wires identified"),
        item("bsl-wind", "Wind and approach path confirmed"),
        item("bsl-power", "Power / OGE check complete"),
      ],
    },
    {
      id: "before-hospital-approach",
      title: "Before Hospital Helipad Approach",
      items: [
        item("bha-helipad-status", "Helipad operational status confirmed"),
        item("bha-approach-brief", "Approach and go-around briefed"),
        item("bha-surface", "Surface and dimensions reviewed"),
        item("bha-patient-secure", "Patient secured for landing"),
      ],
    },
  ];
}

/** Build a fresh, unchecked checklist item. */
function item(id: string, label: string): ChecklistItem {
  return { id, label, checked: false };
}

/**
 * Toggle a checklist item's checked state, returning a NEW checklist array
 * (pure — the input is not mutated). Only the matching item in the matching
 * checklist changes; every other checklist/item is preserved by reference.
 * Drives the "interactive" behaviour (Requirement 6.7).
 */
export function toggleChecklistItem(
  checklists: readonly Checklist[],
  checklistId: string,
  itemId: string,
): Checklist[] {
  return checklists.map((checklist) => {
    if (checklist.id !== checklistId) {
      return checklist;
    }
    return {
      ...checklist,
      items: checklist.items.map((it) =>
        it.id === itemId ? { ...it, checked: !it.checked } : it,
      ),
    };
  });
}

/** Completion counts for a single checklist. */
export interface ChecklistProgress {
  checklistId: string;
  checked: number;
  total: number;
  complete: boolean;
}

/** Compute per-checklist completion (pure) for progress rendering (6.7). */
export function checklistProgress(checklist: Checklist): ChecklistProgress {
  const total = checklist.items.length;
  const checked = checklist.items.filter((it) => it.checked).length;
  return {
    checklistId: checklist.id,
    checked,
    total,
    complete: total > 0 && checked === total,
  };
}

/**
 * The render-ready helipad navigation + landing-zone briefing content for the
 * assigned mission's destination facility (Requirement 6.7). Every field is
 * DERIVED from the destination {@link Helipad} record — never fabricated. When
 * no destination helipad is known, {@link resolveHelipadBriefing} returns an
 * explicit `available: false` result so the UI states the briefing is
 * unavailable rather than inventing one.
 */
export type HelipadBriefing =
  | {
      available: true;
      /** Facility / helipad display name. */
      facilityName: string;
      /** FAA identifier for navigation. */
      faaId: string;
      city: string;
      state: string;
      /** Helipad coordinates for navigation. */
      coordinates: { lat: number; lon: number };
      elevationFt: number;
      /** Rooftop vs. ground — drives approach considerations. */
      placement: Helipad["placement"];
      surface: Helipad["surface"];
      /** Human-readable pad dimensions (e.g. "60x60"). */
      dimensionsFt: string;
      /** Facility capability text (e.g. "LEVEL_I_TRAUMA"). */
      capability: string;
      /** Short LZ briefing lines derived from the pad attributes. */
      briefingNotes: string[];
    }
  | {
      available: false;
      reason: string;
    };

/**
 * Derive the helipad navigation / LZ briefing for the assigned mission from its
 * destination {@link Helipad} (Requirement 6.7).
 *
 * Pure and total: given the same helipad it always returns the same briefing
 * and never throws. `briefingNotes` are deterministic, attribute-driven LZ
 * considerations (e.g. rooftop confined-area caution) — derived from the real
 * pad record, not invented. A missing/`undefined` helipad yields an explicit
 * unavailable result so the EFB never fabricates navigation content.
 */
export function resolveHelipadBriefing(
  helipad: Helipad | null | undefined,
): HelipadBriefing {
  if (!helipad) {
    return {
      available: false,
      reason:
        "No destination helipad is associated with this mission; navigation and LZ briefing are unavailable.",
    };
  }

  const briefingNotes: string[] = [];
  if (helipad.placement === "ROOFTOP") {
    briefingNotes.push(
      "Rooftop pad: expect confined-area approach and consider go-around / OGE power margins.",
    );
  } else {
    briefingNotes.push(
      "Ground-level pad: scan for perimeter obstacles, vehicles, and personnel on approach.",
    );
  }
  briefingNotes.push(
    `Pad elevation ${helipad.elevation_ft} ft MSL; adjust performance and approach profile accordingly.`,
  );
  briefingNotes.push(
    `Surface ${helipad.surface.toLowerCase()}, dimensions ${helipad.dimensions_ft} ft.`,
  );

  return {
    available: true,
    facilityName: helipad.name,
    faaId: helipad.faa_id,
    city: helipad.city,
    state: helipad.state,
    coordinates: {
      lat: helipad.coordinates.latitude_deg,
      lon: helipad.coordinates.longitude_deg,
    },
    elevationFt: helipad.elevation_ft,
    placement: helipad.placement,
    surface: helipad.surface,
    dimensionsFt: helipad.dimensions_ft,
    capability: helipad.capability,
    briefingNotes,
  };
}
