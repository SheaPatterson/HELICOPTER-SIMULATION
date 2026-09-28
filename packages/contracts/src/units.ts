/**
 * Pure unit-conversion and normalization helpers (design Section 6.1,
 * `normalize_units_and_names`).
 *
 * These functions are the shared reference implementation used by the simulator
 * adapters (which receive simulator-native units) and by ingestion (which
 * validates already-normalized frames). They are intentionally pure and
 * side-effect free so both the bridge and cloud produce identical values.
 *
 * The Rust bridge mirrors the same conversion factors in its adapters; keep the
 * two in sync when factors change.
 */

// --- Conversion factors (exact where the definition is exact) --------------

/** meters per foot (exact by international definition). */
const METERS_PER_FOOT = 0.3048;

/** meters per nautical mile (exact by definition: 1 nm = 1852 m). */
const METERS_PER_NAUTICAL_MILE = 1852;

/** meters per second per knot (1 knot = 1852 m / 3600 s). */
const MPS_PER_KNOT = METERS_PER_NAUTICAL_MILE / 3600;

/** feet per minute per (meter per second): m/s -> ft/min. */
const FPM_PER_MPS = (1 / METERS_PER_FOOT) * 60;

// --- Length ----------------------------------------------------------------

/** Convert meters to feet. */
export function metersToFeet(meters: number): number {
  return meters / METERS_PER_FOOT;
}

/** Convert feet to meters. */
export function feetToMeters(feet: number): number {
  return feet * METERS_PER_FOOT;
}

/** Convert meters to nautical miles. */
export function metersToNauticalMiles(meters: number): number {
  return meters / METERS_PER_NAUTICAL_MILE;
}

/** Convert nautical miles to meters. */
export function nauticalMilesToMeters(nm: number): number {
  return nm * METERS_PER_NAUTICAL_MILE;
}

// --- Speed -----------------------------------------------------------------

/** Convert meters per second to knots. */
export function metersPerSecondToKnots(mps: number): number {
  return mps / MPS_PER_KNOT;
}

/** Convert knots to meters per second. */
export function knotsToMetersPerSecond(kts: number): number {
  return kts * MPS_PER_KNOT;
}

/** Convert meters per second to feet per minute (vertical speed). */
export function metersPerSecondToFeetPerMinute(mps: number): number {
  return mps * FPM_PER_MPS;
}

/** Convert feet per minute to meters per second. */
export function feetPerMinuteToMetersPerSecond(fpm: number): number {
  return fpm / FPM_PER_MPS;
}

// --- Mass ------------------------------------------------------------------

/** pounds per kilogram (avoirdupois pound is exactly 0.45359237 kg). */
const KG_PER_POUND = 0.45359237;

/** Convert kilograms to pounds. */
export function kilogramsToPounds(kg: number): number {
  return kg / KG_PER_POUND;
}

/** Convert pounds to kilograms. */
export function poundsToKilograms(lbs: number): number {
  return lbs * KG_PER_POUND;
}

// --- Angle -----------------------------------------------------------------

/** Convert radians to degrees. */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Convert degrees to radians. */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// --- Temperature -----------------------------------------------------------

/** Convert kelvin to Celsius. */
export function kelvinToCelsius(kelvin: number): number {
  return kelvin - 273.15;
}

/** Convert Fahrenheit to Celsius. */
export function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

// --- Normalization ---------------------------------------------------------

/**
 * Normalize a heading to the shared contract range: degrees in
 * [0, 360). A finite heading of any magnitude (including negative or
 * multi-turn values reported by some simulators) wraps into range; the
 * upper bound 360 maps to 0.
 *
 * Returns the input unchanged when it is non-finite so callers/validators can
 * detect and reject bad values rather than have them silently masked.
 */
export function normalizeHeadingDeg(heading: number): number {
  if (!Number.isFinite(heading)) {
    return heading;
  }
  const wrapped = heading % 360;
  if (wrapped < 0) {
    // Correcting a negative remainder can round up to exactly 360 for tiny
    // magnitudes (e.g. -5e-324 + 360 === 360 in IEEE-754); guard so the result
    // stays in the documented [0, 360) range with 360 mapping to 0.
    const corrected = wrapped + 360;
    return corrected >= 360 ? 0 : corrected;
  }
  return wrapped;
}

/**
 * Normalize a longitude to [-180, 180]. Values wrap around the antimeridian;
 * exactly +180 is preserved as +180. Non-finite inputs are returned unchanged.
 */
export function normalizeLongitudeDeg(longitude: number): number {
  if (!Number.isFinite(longitude)) {
    return longitude;
  }
  if (longitude >= -180 && longitude <= 180) {
    return longitude;
  }
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return wrapped;
}

/**
 * Clamp a numeric value into an inclusive [min, max] range. Non-finite inputs
 * are returned unchanged so validation (not clamping) rejects them.
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
