/**
 * Downloads-page artifact resolution (design Section 3.5 public route surface;
 * task 17.1; Requirements 10.5, 10.7).
 *
 * PURE, framework-free derivation of the downloads page's artifact list. The
 * page owns rendering; this module owns the availability/derivation logic so it
 * is directly unit-testable (task 17.3 is the dedicated suite; this file carries
 * the logic under test with a few smoke tests).
 *
 * Requirement mapping:
 *  - 10.5: the downloads page offers exactly three artifacts — the Windows
 *          bridge installer, the macOS bridge installer, and the X-Plane Lua
 *          script. `resolveDownloads` always returns one entry per
 *          {@link DOWNLOAD_ARTIFACT_KINDS} kind, so a kind can never be dropped.
 *  - 10.7 (Req 10.7): an UNAVAILABLE artifact is surfaced as an error entry
 *          while the AVAILABLE artifacts are still offered. Availability is
 *          derived structurally: an artifact with no resolvable URL becomes an
 *          `available: false` entry carrying an error message, and the
 *          available ones are unaffected. Nothing is silently hidden.
 */

/** The three artifact kinds the downloads page must offer (10.5). */
export const DOWNLOAD_ARTIFACT_KINDS = [
  "WINDOWS_INSTALLER",
  "MACOS_INSTALLER",
  "XPLANE_LUA_SCRIPT",
] as const;

/** One of the three required download artifact kinds. */
export type DownloadArtifactKind = (typeof DOWNLOAD_ARTIFACT_KINDS)[number];

/**
 * Raw availability input for a single artifact kind — the shape a caller
 * (config, build manifest, or CMS) supplies. A `url` that is a non-empty string
 * means the artifact is available; `null`, `undefined`, or empty means it is
 * unavailable and must be surfaced as an error (10.7).
 */
export interface DownloadArtifactInput {
  /** Resolvable download URL, or null/undefined when the artifact is missing. */
  readonly url?: string | null;
  /** Optional version/build label shown next to an available artifact. */
  readonly version?: string;
}

/** Partial map of artifact inputs keyed by kind. Missing keys are unavailable. */
export type DownloadArtifactInputs = Partial<
  Record<DownloadArtifactKind, DownloadArtifactInput>
>;

/** Human-readable label for each artifact kind, shown on the page. */
export const DOWNLOAD_ARTIFACT_LABELS: Record<DownloadArtifactKind, string> = {
  WINDOWS_INSTALLER: "Windows desktop bridge installer",
  MACOS_INSTALLER: "macOS desktop bridge installer",
  XPLANE_LUA_SCRIPT: "X-Plane FlyWithLua script",
};

/**
 * A resolved download entry the page renders. Exactly one is produced per
 * artifact kind. When `available` is true, `url` is a non-empty string and
 * `error` is null. When `available` is false, `url` is null and `error` carries
 * the message to display for that artifact (10.7).
 */
export interface ResolvedDownload {
  readonly kind: DownloadArtifactKind;
  readonly label: string;
  readonly available: boolean;
  readonly url: string | null;
  readonly version: string | null;
  readonly error: string | null;
}

function resolveOne(
  kind: DownloadArtifactKind,
  input: DownloadArtifactInput | undefined,
): ResolvedDownload {
  const label = DOWNLOAD_ARTIFACT_LABELS[kind];
  const url = typeof input?.url === "string" ? input.url.trim() : "";

  if (url.length === 0) {
    return {
      kind,
      label,
      available: false,
      url: null,
      version: null,
      error: `${label} is currently unavailable. Please check back later.`,
    };
  }

  return {
    kind,
    label,
    available: true,
    url,
    version:
      typeof input?.version === "string" && input.version.trim().length > 0
        ? input.version.trim()
        : null,
    error: null,
  };
}

/**
 * Resolve the full downloads list. Always returns one entry per required
 * artifact kind, in {@link DOWNLOAD_ARTIFACT_KINDS} order, so the available
 * artifacts are always offered and any unavailable artifact is surfaced as an
 * error rather than omitted (10.5 / 10.7).
 */
export function resolveDownloads(
  inputs: DownloadArtifactInputs = {},
): ResolvedDownload[] {
  return DOWNLOAD_ARTIFACT_KINDS.map((kind) => resolveOne(kind, inputs[kind]));
}
