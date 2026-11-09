# 0002 · Tauri 2 shell with a Node single-executable sidecar

- Status: Superseded in part by [0003](0003-bun-runtime-and-toolchain.md) (the sidecar runtime); the Tauri shell stays
- Date: 2026-11-04 (commit "Switch to Tauri v2"); not released on its own, v0.5.0 shipped it together with 0003

## Context

The desktop build relied on `deno desktop` ([0001](0001-deno-packaging.md)), where Node-API addons crashed on Windows
and Linux. Why `deno desktop` was replaced beyond that is not recorded in the repository (to be confirmed); the commit
only states the switch.

## Decision

- The desktop app is a Tauri 2 shell (`src-tauri/`) that shows the window, native menus and dialogs. The page, served
  from 127.0.0.1, reaches Tauri's menu, dialog and opener APIs as a remote page (`src-tauri/capabilities`).
- The server runs as the sidecar `colwerk-server` next to the shell binary: a Node single executable application (SEA)
  with the launcher, the Nitro server and its dependencies in one ESM bundle (esbuild).
- The Node binary is the official build of a pinned version (v26.13.0), downloaded by `scripts/package.ts` and checked
  against its `SHASUMS256.txt`, because a system Node (e.g. Homebrew's) may link libraries other machines lack.
- DuckDB returns to the official Node-API addon `@duckdb/node-bindings` (`core/drivers/duckdb-native.ts`), still
  downloaded on demand into the data directory.
- The sidecar ends when the shell closes its stdin, so it does not outlive the app. It prints `Colwerk: <url>` once it
  listens, and the shell navigates its window there.
- Deno stayed the development toolchain.

## Consequences

- Native menus, dialogs, window state and the installers (`.dmg`, `.msi`, AppImage, `.deb`) come from Tauri. Building
  the desktop app needs Rust and, on Linux, WebKitGTK.
- There are two processes now: crashes and restarts of the sidecar are the shell's job.
- The packaging script had to fetch and verify a Node runtime for each target.
