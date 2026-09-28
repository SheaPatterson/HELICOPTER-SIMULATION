# Virtual HEMS Monorepo

Flight-following, mission-dispatch, clinical-simulation, and safety-management
platform for helicopter simulation. This repository is a Turborepo + npm
workspaces monorepo.

## Layout

```
apps/
  web/                     # @virtualhems/web — Next.js 14 App Router command terminal + EFB
  bridge-desktop/          # @virtualhems/bridge-desktop — Tauri v2 / Rust desktop bridge
    src-tauri/             # virtualhems-bridge Rust crate (adapters, offline queue, TLS uplink)
packages/
  contracts/               # @virtualhems/contracts — shared, versioned telemetry/dispatch/clinical/AAR types
  cloud/                   # @virtualhems/cloud — cloud/API boundary (ingestion, mission, clinical, recommendation, AAR)
  eslint-config/           # @virtualhems/eslint-config — shared ESLint flat config
```

## Toolchains

- **TypeScript** for the web app, cloud/API, and shared contracts.
  Property-based tests use [fast-check](https://fast-check.dev) with
  [Vitest](https://vitest.dev).
- **Rust** (edition 2021, toolchain 1.78+, Tauri v2) for the desktop bridge.
  Property-based tests use [proptest](https://proptest-rs.github.io/proptest/).
  The bridge targets Windows 10/11 `x86_64` and macOS `x86_64` / `aarch64`.

## Scripts (run from the repo root)

| Command             | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `npm run build`     | Build every package via Turborepo                      |
| `npm run lint`      | Lint every package                                     |
| `npm run typecheck` | Type-check every package                               |
| `npm run test`      | Run every package's test suite                         |
| `npm run check`     | Run lint + typecheck + build + test across the graph   |
| `npm run clean`     | Remove build outputs and caches                        |

The Rust bridge participates in the pipeline through a small wrapper
(`apps/bridge-desktop/scripts/cargo.mjs`) that runs `cargo` when a Rust
toolchain is installed and skips gracefully otherwise. Install the toolchain via
[rustup](https://rustup.rs) to build and test the bridge crate locally; CI
installs it automatically.
