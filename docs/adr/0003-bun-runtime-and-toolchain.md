# 0003 · Bun as sidecar runtime and toolchain

- Status: Accepted
- Date: 2026-11-04 (commit "Switch deno to bun"), released in v0.5.0 (pull request #17, "Refactor/plattform switch")
- Supersedes: [0001](0001-deno-packaging.md), and the sidecar runtime of [0002](0002-tauri-shell-node-sidecar.md)

## Context

After [0002](0002-tauri-shell-node-sidecar.md) the project used two JavaScript runtimes: Deno for development and a
downloaded Node build, bundled separately with esbuild, for the shipped sidecar. Other reasons for the switch are not
recorded in the repository (to be confirmed).

## Decision

- `colwerk-server` is a Bun single-file executable (`Bun.build` with `compile`, see `scripts/package.ts`): the launcher,
  the Nitro build (preset `node-listener`) and its dependencies in one binary, both as the desktop sidecar and for
  `bun run compile`.
- Bun is also the toolchain: `bun install` (`bun.lock`), `bun run` scripts, `bun test` and `bun fmt`.
- `core/` keeps to `node:` APIs, so the drivers do not depend on Bun-specific APIs. DuckDB's native addon is still
  downloaded on demand (`launcher/native.ts`), checked against the npm package's integrity hash fixed at build time.

## Consequences

- One runtime for development, tests and the shipped server, with no separate Node download or esbuild step.
- The Bun executable must not be stripped, and linuxdeploy's patchelf breaks it on Linux arm64, so only a `.deb` is
  built there (`scripts/package.ts`, `.github/workflows/release.yml`).
- Documentation and comments written for Deno or Node had to be updated; any stale reference left is a bug.
