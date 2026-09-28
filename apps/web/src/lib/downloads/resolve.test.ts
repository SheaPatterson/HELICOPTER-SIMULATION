import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_ARTIFACT_KINDS,
  resolveDownloads,
} from "./resolve";

/**
 * Smoke tests for downloads artifact resolution (task 17.1; Requirements 10.5,
 * 10.7). The dedicated suite is task 17.3.
 */
describe("resolveDownloads", () => {
  it("always offers exactly the three required artifact kinds in order (10.5)", () => {
    const resolved = resolveDownloads();
    expect(resolved.map((r) => r.kind)).toEqual([...DOWNLOAD_ARTIFACT_KINDS]);
  });

  it("surfaces an unavailable artifact as an error while offering the rest (10.7)", () => {
    const resolved = resolveDownloads({
      WINDOWS_INSTALLER: { url: "https://example.com/win.exe" },
      MACOS_INSTALLER: { url: "https://example.com/mac.dmg" },
      // XPLANE_LUA_SCRIPT omitted → unavailable
    });

    const win = resolved.find((r) => r.kind === "WINDOWS_INSTALLER");
    const mac = resolved.find((r) => r.kind === "MACOS_INSTALLER");
    const lua = resolved.find((r) => r.kind === "XPLANE_LUA_SCRIPT");

    expect(win?.available).toBe(true);
    expect(win?.url).toBe("https://example.com/win.exe");
    expect(mac?.available).toBe(true);

    expect(lua?.available).toBe(false);
    expect(lua?.url).toBeNull();
    expect(lua?.error).toBeTruthy();
  });

  it("treats empty/whitespace URLs as unavailable", () => {
    const resolved = resolveDownloads({
      WINDOWS_INSTALLER: { url: "   " },
      MACOS_INSTALLER: { url: "" },
      XPLANE_LUA_SCRIPT: { url: null },
    });
    expect(resolved.every((r) => !r.available)).toBe(true);
    expect(resolved.every((r) => r.error !== null)).toBe(true);
  });
});
