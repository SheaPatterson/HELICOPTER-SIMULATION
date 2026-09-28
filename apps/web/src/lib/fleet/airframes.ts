/**
 * Approved fleet registry (design Section 1 operating model; task 17.1;
 * Requirement 10.4).
 *
 * This is the PURE, framework-free typed source of the four approved airframes
 * the public fleet page renders. It is kept separate from the page component so
 * the catalog is directly unit-testable and reusable, and it is deliberately
 * consistent with the seed data
 * (`supabase/migrations/20240101000300_seed_conditions_and_infrastructure.sql`),
 * which assigns bases the `airframe_type` values EC135 / EC145 / H135 / Bell 407.
 *
 * Requirement 10.4: the fleet page SHALL display all four approved airframes
 * (EC135, EC145, H135, and Bell 407) each with its capability information. The
 * catalog below is the single source of that list; the page maps over it, so it
 * cannot silently omit an airframe.
 */

/** The canonical model identifiers of the approved fleet, matching seed data. */
export const APPROVED_AIRFRAME_MODELS = [
  "EC135",
  "EC145",
  "H135",
  "Bell 407",
] as const;

/** One of the four approved airframe model identifiers. */
export type AirframeModel = (typeof APPROVED_AIRFRAME_MODELS)[number];

/**
 * Public-facing capability description of an approved airframe. Every field is
 * informational marketing/spec content — no operational or identifying data —
 * so the record is safe to serve on an unauthenticated route (Requirement 10.7,
 * 8.7). Figures are representative simulation reference values.
 */
export interface AirframeProfile {
  /** Approved model identifier (matches seed `airframe_type`). */
  readonly model: AirframeModel;
  /** Manufacturer / marketing name. */
  readonly manufacturer: string;
  /** One-line role summary. */
  readonly role: string;
  /** Number of engines. */
  readonly engines: number;
  /** Typical HEMS crew capacity (crew + patient). */
  readonly crewCapacity: number;
  /** Representative cruise speed in knots. */
  readonly cruiseSpeedKts: number;
  /** Representative maximum range in nautical miles. */
  readonly rangeNm: number;
  /** Notable capability highlights shown on the fleet page. */
  readonly capabilities: readonly string[];
}

/**
 * The approved fleet catalog. Ordered to match {@link APPROVED_AIRFRAME_MODELS}.
 * Values are representative reference figures for the simulation profile, not
 * certified performance data.
 */
export const FLEET: readonly AirframeProfile[] = [
  {
    model: "EC135",
    manufacturer: "Airbus Helicopters",
    role: "Light twin-engine HEMS",
    engines: 2,
    crewCapacity: 4,
    cruiseSpeedKts: 137,
    rangeNm: 343,
    capabilities: [
      "Twin-engine redundancy for over-city and night operations",
      "Fenestron tail rotor for confined-area landing-zone safety",
      "Single-patient EMS interior with rear clamshell loading",
    ],
  },
  {
    model: "EC145",
    manufacturer: "Airbus Helicopters",
    role: "Medium twin-engine HEMS",
    engines: 2,
    crewCapacity: 5,
    cruiseSpeedKts: 133,
    rangeNm: 351,
    capabilities: [
      "Large flat-floor cabin supporting two-crew critical care",
      "High useful load for extended inter-facility transfers",
      "Rear clamshell doors and wide side doors for rapid loading",
    ],
  },
  {
    model: "H135",
    manufacturer: "Airbus Helicopters",
    role: "Light twin-engine HEMS (H-series EC135)",
    engines: 2,
    crewCapacity: 4,
    cruiseSpeedKts: 140,
    rangeNm: 341,
    capabilities: [
      "Helionix avionics with four-axis autopilot",
      "Low external noise footprint for hospital-helipad operations",
      "Category A performance for elevated rooftop helipads",
    ],
  },
  {
    model: "Bell 407",
    manufacturer: "Bell",
    role: "Single-engine HEMS utility",
    engines: 1,
    crewCapacity: 4,
    cruiseSpeedKts: 133,
    rangeNm: 337,
    capabilities: [
      "Rugged single-engine platform for rural scene calls",
      "Four-blade soft-in-plane rotor for a stable hover",
      "Cost-efficient airframe for high-tempo regional coverage",
    ],
  },
];

/** Look up an approved airframe profile by model, or undefined if not approved. */
export function airframeByModel(
  model: string,
): AirframeProfile | undefined {
  return FLEET.find((a) => a.model === model);
}
