/**
 * Public Operations Manual table of contents (task 17.1; Requirement 10.3).
 *
 * PURE typed list of the top-level modules/sections of the Virtual HEMS
 * Operations Manual, published as a public summary/TOC. Mirrors the documented
 * module structure under `.kilo/docs` (Operations Manual + Modules 1–4). No
 * operational, patient, or identifying data — safe for an unauthenticated route
 * (10.7 / 8.7).
 */

/** One top-level module/section entry in the Operations Manual TOC. */
export interface OperationsManualSection {
  /** Module/section number label (e.g. "Module 1"). */
  readonly id: string;
  /** Top-level title. */
  readonly title: string;
  /** One-line summary of the section's scope. */
  readonly summary: string;
}

/**
 * The Operations Manual top-level table of contents. Each entry is a top-level
 * module/section title as required by 10.3.
 */
export const OPERATIONS_MANUAL_TOC: readonly OperationsManualSection[] = [
  {
    id: "Module 1",
    title: "Operations Manual",
    summary:
      "Organizational overview, operating model, and standard operating procedures.",
  },
  {
    id: "Module 2",
    title: "Aircraft Systems & Systems Operations",
    summary:
      "Airframe systems, powerplant, avionics, and normal/abnormal systems procedures.",
  },
  {
    id: "Module 3",
    title: "Fundamentals of Helicopter Flight Dynamics",
    summary:
      "Rotorcraft aerodynamics, performance, and handling for procedural flight training.",
  },
  {
    id: "Module 4",
    title: "Clinical Logistics & Mission Execution",
    summary:
      "Dispatch, clinical simulation, scene operations, and mission execution.",
  },
];
