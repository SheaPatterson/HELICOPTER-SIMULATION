/**
 * Public downloads page `/downloads` (task 17.1; Requirements 10.1, 10.5, 10.7).
 *
 * Static-friendly server component served without authentication. Offers the
 * three required artifacts — Windows installer, macOS installer, and X-Plane Lua
 * script (10.5). Availability is derived by the pure `resolveDownloads` core: an
 * artifact whose URL is not configured is surfaced as an ERROR entry while the
 * available artifacts remain offered (10.7). Nothing is silently hidden.
 *
 * Artifact URLs are read from public build-time config. An unset URL naturally
 * resolves to an unavailable/error entry, which is exactly the 10.7 behavior.
 */
import type { ReactNode } from "react";
import { resolveDownloads, type DownloadArtifactInputs } from "@/lib/downloads";

/**
 * Assemble artifact inputs from public environment config. Missing/empty values
 * resolve to unavailable artifacts (error shown, others still offered).
 */
function readArtifactInputs(): DownloadArtifactInputs {
  return {
    WINDOWS_INSTALLER: {
      url: process.env.NEXT_PUBLIC_DOWNLOAD_WINDOWS_URL ?? null,
      version: process.env.NEXT_PUBLIC_DOWNLOAD_WINDOWS_VERSION,
    },
    MACOS_INSTALLER: {
      url: process.env.NEXT_PUBLIC_DOWNLOAD_MACOS_URL ?? null,
      version: process.env.NEXT_PUBLIC_DOWNLOAD_MACOS_VERSION,
    },
    XPLANE_LUA_SCRIPT: {
      url: process.env.NEXT_PUBLIC_DOWNLOAD_XPLANE_LUA_URL ?? null,
      version: process.env.NEXT_PUBLIC_DOWNLOAD_XPLANE_LUA_VERSION,
    },
  };
}

export const metadata = {
  title: "Downloads | Virtual HEMS",
};

export default function DownloadsPage(): ReactNode {
  const downloads = resolveDownloads(readArtifactInputs());

  return (
    <main aria-label="Downloads">
      <h1>Downloads</h1>
      <p>
        Download the Virtual HEMS desktop bridge and the X-Plane script. The
        bridge reads live simulator telemetry and streams it to the platform.
      </p>

      <ul>
        {downloads.map((artifact) => (
          <li key={artifact.kind} aria-label={artifact.label}>
            <h2>{artifact.label}</h2>
            {artifact.available ? (
              <p>
                <a href={artifact.url ?? undefined} download>
                  Download{artifact.version ? ` (${artifact.version})` : ""}
                </a>
              </p>
            ) : (
              <p role="alert">{artifact.error}</p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
