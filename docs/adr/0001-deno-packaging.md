# 0001 · Package the app with Deno

- Status: Superseded by [0002](0002-tauri-shell-node-sidecar.md) and [0003](0003-bun-runtime-and-toolchain.md)
- Date: 2026-10-26 (initial commit), in use up to v0.4.0

## Context

Colwerk is a Nuxt 4 SPA with a Nitro server that holds the database sessions. It needs a desktop window, a self-hosted
binary that opens the default browser, and a toolchain for tasks, tests and formatting.

## Decision

Deno was the runtime and the toolchain:

- `deno desktop` built the desktop app (a webview around the server), `deno compile` the self-hosted binary.
  `launcher/` was the entry point for both.
- `deno task` ran development, packaging, tests and type checks; `deno fmt` formatted the code (from v0.4.0).
- From v0.2.0 on, DuckDB was loaded through its C API with `Deno.dlopen` (`core/drivers/duckdb-ffi.ts`), not as a
  Node-API addon: Node-API addons crashed `deno desktop` builds on Windows and Linux
  ([denoland/deno#36596](https://github.com/denoland/deno/issues/36596)). The library was downloaded from npm on first
  use and verified by hash.

## Consequences

- One tool covered everything, but the desktop build depended on `deno desktop`: its webview binary (`laufey_webview`,
  which MCP clients also had to call) and its packaging (self-extracting bundles on Windows and Linux).
- DuckDB needed an FFI binding of its own instead of the official `@duckdb/node-bindings`.
- Superseded on 2026-11-04: the desktop shell moved to Tauri ([0002](0002-tauri-shell-node-sidecar.md)), and Bun
  replaced Deno as runtime and toolchain ([0003](0003-bun-runtime-and-toolchain.md)).
