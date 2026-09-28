#!/usr/bin/env node
/**
 * Thin wrapper that runs a cargo subcommand against the bridge crate so the
 * Rust crate participates in the Turborepo pipeline (build / lint / typecheck /
 * test / clean).
 *
 * If cargo is not installed in the current environment, the wrapper prints a
 * clear notice and exits 0 so the JS/TS side of the pipeline is not blocked.
 * CI installs the Rust toolchain, so the Rust steps run for real there.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const manifestDir = resolve(here, "..", "src-tauri");
const args = process.argv.slice(2);

const probe = spawnSync("cargo", ["--version"], { stdio: "ignore" });
if (probe.error) {
  console.warn(
    `[bridge-desktop] cargo not found; skipping "cargo ${args.join(" ")}". ` +
      "Install the Rust toolchain (https://rustup.rs) to build/test the bridge crate.",
  );
  process.exit(0);
}

const result = spawnSync("cargo", args, {
  cwd: manifestDir,
  stdio: "inherit",
});

if (result.error) {
  console.error(`[bridge-desktop] failed to run cargo: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
