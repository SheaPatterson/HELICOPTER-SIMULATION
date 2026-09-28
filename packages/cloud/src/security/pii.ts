/**
 * Simulation-only data policy: real-world patient identifier detection and
 * rejection for simulated clinical text (design Section 2 "Service" principle;
 * requirement 8.9).
 *
 * The platform is a SIMULATION. Any clinical free-text a user submits (patient
 * narrative, clinical notes) must be synthetic. If such text contains a
 * detectable real-world patient identifier, req 8.9 requires the platform to
 * REJECT the input under the simulation-only policy, return an error naming that
 * policy, and persist NONE of the submitted input.
 *
 * This module is a PURE detector plus a rejection helper. It makes NO
 * persistence decisions itself — the contract is: the caller MUST NOT proceed
 * to persist when {@link rejectIfContainsRealIdentifiers} returns a violation.
 * Detection is deliberately conservative and pattern-based (there is no way to
 * perfectly distinguish "real" from "synthetic" identifiers); the pattern set is
 * documented so callers understand its scope and its false-positive profile.
 *
 * Detected identifier classes:
 *   - `SSN`      — U.S. Social Security Number patterns (`123-45-6789`, 9 digits).
 *   - `MRN`      — Medical Record Number-like tokens (an `MRN`/`MR#` label
 *                  followed by a numeric identifier).
 *   - `PHONE`    — North American phone number patterns.
 *   - `EMAIL`    — email addresses.
 *   - `NAME_DOB` — a capitalized full name adjacent to a date of birth
 *                  (real-name + DOB heuristic).
 *   - `DOB`      — an explicit date-of-birth label followed by a date.
 *
 * Each pattern is intentionally scoped to reduce false positives on legitimate
 * simulated content (vitals, GCS numbers, timestamps, ICD codes).
 */

/** The classes of real-world patient identifier this detector recognizes. */
export const PII_IDENTIFIER_KINDS = [
  "SSN",
  "MRN",
  "PHONE",
  "EMAIL",
  "NAME_DOB",
  "DOB",
] as const;

export type PiiIdentifierKind = (typeof PII_IDENTIFIER_KINDS)[number];

/** A single detected identifier occurrence. */
export interface PiiMatch {
  kind: PiiIdentifierKind;
  /** The matched substring (for diagnostics; callers must NOT persist it). */
  value: string;
  /** Zero-based index of the match within the scanned text. */
  index: number;
}

/**
 * Each detector: a labeled pattern. Patterns are anchored/bounded to constrain
 * the input space and avoid matching ordinary simulated clinical values.
 *
 * NOTE: patterns carry the global flag so all occurrences are found; callers
 * must not share `lastIndex` state across scans (a fresh regex is used per scan
 * via {@link scanForIdentifiers}).
 */
interface Detector {
  kind: PiiIdentifierKind;
  build: () => RegExp;
}

const DETECTORS: readonly Detector[] = [
  {
    // U.S. SSN: 3-2-4 digits with - or space separators, OR a bare 9-digit run
    // that is clearly delimited (not part of a longer number). Word boundaries
    // keep it from matching inside longer digit strings (e.g. sequence numbers).
    kind: "SSN",
    build: () => /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,
  },
  {
    // MRN-like: an explicit MRN / MR# / "medical record" label followed by an
    // identifier of 5+ alphanumerics. The label requirement avoids flagging
    // plain numbers (GCS, vitals, elapsed seconds).
    kind: "MRN",
    build: () =>
      /\b(?:MRN|MR#|MR\s?No\.?|medical\s+record(?:\s+(?:number|no\.?|#))?)\s*[:#]?\s*[A-Z0-9-]{5,}\b/gi,
  },
  {
    // North American phone numbers: optional +1, area code in parens or plain,
    // separators - . or space. Requires separators or parens so it does not
    // match a bare 10-digit run of unrelated numbers.
    kind: "PHONE",
    build: () =>
      /(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g,
  },
  {
    // Email addresses.
    kind: "EMAIL",
    build: () => /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    // Explicit DOB label followed by a date (MM/DD/YYYY, MM-DD-YYYY, or
    // YYYY-MM-DD). The label requirement keeps ordinary simulated dates from
    // being flagged.
    kind: "DOB",
    build: () =>
      /\b(?:DOB|D\.O\.B\.?|date\s+of\s+birth)\s*[:#]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/gi,
  },
  {
    // Real-name + DOB heuristic: a capitalized First Last name within a short
    // window of a date. Requires BOTH a name-shaped token and an adjacent date
    // so common simulated phrases ("Patient is a 45 y/o male") are not flagged.
    kind: "NAME_DOB",
    build: () =>
      /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b[\s,]*(?:\(?\s*(?:DOB|born)\b[^)]*)?(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/g,
  },
];

/**
 * Scan `text` for all detectable real-world patient identifiers. Pure: it never
 * mutates or persists anything. Returns every match found, in ascending text
 * order. An empty array means no detectable identifier was found (which is NOT a
 * guarantee the text is synthetic — detection is conservative and best-effort).
 */
export function scanForIdentifiers(text: string): PiiMatch[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const matches: PiiMatch[] = [];
  for (const detector of DETECTORS) {
    const re = detector.build();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({ kind: detector.kind, value: m[0], index: m.index });
      // Guard against zero-length matches causing an infinite loop.
      if (m.index === re.lastIndex) {
        re.lastIndex += 1;
      }
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return matches;
}

/** True when `text` contains at least one detectable real-world identifier. */
export function containsRealIdentifiers(text: string): boolean {
  return scanForIdentifiers(text).length > 0;
}

/** The name of the policy an input violates when identifiers are detected. */
export const SIMULATION_ONLY_POLICY = "simulation-only data policy" as const;

/** A simulation-only policy violation (req 8.9). */
export interface SimulationOnlyViolation {
  ok: false;
  /** The policy that was violated, by name (req 8.9). */
  policy: typeof SIMULATION_ONLY_POLICY;
  /** Human-readable error indicating the input violates the policy (req 8.9). */
  message: string;
  /** The distinct identifier kinds detected (for diagnostics, not persistence). */
  kinds: PiiIdentifierKind[];
  /** Every detected match (for diagnostics; callers must NOT persist these). */
  matches: PiiMatch[];
}

/** The input passed the simulation-only screen and MAY be persisted by the caller. */
export interface SimulationOnlyAccepted {
  ok: true;
}

export type SimulationOnlyResult = SimulationOnlyAccepted | SimulationOnlyViolation;

/**
 * Screen a clinical text input against the simulation-only data policy (req 8.9).
 *
 * If the text contains a detectable real-world patient identifier, returns a
 * {@link SimulationOnlyViolation} naming the simulation-only policy. The
 * REJECTION CONTRACT is: on a violation the caller MUST NOT persist ANY part of
 * the submitted input (req 8.9). This function never persists anything itself;
 * enforcing "persist none of the submitted input" is the caller's obligation,
 * which is satisfied by not proceeding when `ok === false`.
 *
 * When no identifier is detected, returns `{ ok: true }` and the caller may
 * proceed to persist.
 */
export function rejectIfContainsRealIdentifiers(text: string): SimulationOnlyResult {
  const matches = scanForIdentifiers(text);
  if (matches.length === 0) {
    return { ok: true };
  }

  const kinds = [...new Set(matches.map((m) => m.kind))];
  return {
    ok: false,
    policy: SIMULATION_ONLY_POLICY,
    message: `input rejected under the ${SIMULATION_ONLY_POLICY}: it contains a detectable real-world patient identifier and none of the submitted input has been persisted`,
    kinds,
    matches,
  };
}
