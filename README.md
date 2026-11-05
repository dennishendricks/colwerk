<p align="center">
  <img src="public/icon.svg" alt="Colwerk" width="96" height="96">
</p>

<h1 align="center">Colwerk · A lightweight SQL editor for the desktop</h1>

<p align="center">
  <strong>Write SQL. Watch it come alive.</strong>
</p>

<p align="center">
  <a href="https://github.com/dennishendricks/colwerk/releases/latest"><img src="https://img.shields.io/github/v/release/dennishendricks/colwerk?label=download" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/dennishendricks/colwerk" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://colwerk.app/"><strong>Website</strong></a> ·
  <a href="https://github.com/dennishendricks/colwerk/releases/latest"><strong>Download</strong></a> ·
  <a href="#development">Development</a>
</p>

---

Colwerk connects to **PostgreSQL, MySQL/MariaDB, Microsoft SQL Server, DuckDB and SQLite**. It is open source, free, runs
entirely on your machine and has no telemetry, no analytics and no account.

## Download

| Platform | Architecture         | Package          |
| -------- | -------------------- | ---------------- |
| macOS    | Apple Silicon, Intel | `.dmg`           |
| Windows  | x64                  | `.msi`           |
| Linux    | x64                  | AppImage, `.deb` |
| Linux    | arm64                | `.deb`           |

**[→ Get the latest release](https://github.com/dennishendricks/colwerk/releases/latest)** — all files and checksums
are listed there. Install, start Colwerk, add a connection and run your first query.

## Features

- **One session per tab** – transactions, temp tables and `SET` options persist per tab; open transactions can be
  committed or rolled back.
- **Gentle on the database** – reads only up to the row limit, loads the schema tree on demand and takes table sizes from
  statistics instead of `COUNT(*)`.
- **Production guard rails** – color-coded connections and optional confirmation before statements that change data or
  structure.
- **Result grid** – sort, filter, pin, hide and resize columns; copy rows as JSON or CSV.
- **CSV and Parquet export** – the visible rows or the full, unlimited result, written straight to disk.
- **Editor comforts** – autocomplete for tables and columns, SQL formatting, execution plans, SQL templates, multiple
  cursors and a searchable query history.
- **Built-in MCP server** – let your own AI assistant browse schemas and run read-only queries (see below).
- **Local by design** – the server only listens on `127.0.0.1`, passwords are encrypted, the key lives in the OS
  keychain.

More details, screenshots and the privacy notes: **[colwerk.app](https://colwerk.app/)**

---

## Development

Built with Nuxt 4 (SPA), Nuxt UI 4, CodeMirror 6 and Nitro. The server runs on Bun as a single-file executable; the
desktop app is a Tauri 2 shell around it. Bun is also the development toolchain (scripts, tests, formatting).

### Getting started

Requirements: Bun 1.4+, Docker (optional, for the test databases). For the desktop app also Rust (stable) and, on
Linux, Tauri's system packages (`libwebkit2gtk-4.1-dev libxdo-dev libssl-dev librsvg2-dev`).

```sh
bun install            # install dependencies
bun run hooks          # pre-commit hook: formats staged files with bun fmt
docker compose up -d   # test databases: Postgres :55432, MariaDB :53306, MSSQL :51433
bun run dev            # dev server; prints the URL including the session token
```

| Command             | Description                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `bun run dev`       | Nuxt dev server on `127.0.0.1`, random port, fresh token (`--desktop`: in the Tauri shell) |
| `bun run desktop`   | Desktop app for the host system: installer and .zip in `dist/`                             |
| `bun run compile`   | Self-hosted binary `dist/colwerk` that opens the default browser                           |
| `bun run release`   | Version bump and tag; GitHub Actions builds all targets and drafts a release               |
| `bun run test`      | Driver contract tests, API end-to-end test, SQL splitter tests                             |
| `bun run typecheck` | `nuxt typecheck`, including core, launcher, scripts and tests (`tsconfig.bun.json`)        |
| `bun fmt`           | Formats all files (settings in `bunfig.toml`)                                              |
| `bun run hooks`     | Enables the pre-commit hook in `.githooks/`                                                |

Tests against Postgres, MariaDB and MSSQL are skipped when the container is not reachable.

### Architecture

```
core/       runtime-agnostic TypeScript on node: APIs: drivers, sessions, export, store, keychain (no Nuxt dependencies)
server/     thin Nitro layer: security middleware, /api/* routes, MCP tools; no database logic
app/        Nuxt UI frontend, talks to /api/* only; native menus and dialogs through Tauri (app/utils/desktop.ts)
launcher/   entry point of the server binary (colwerk-server), MCP stdio bridge
src-tauri/  desktop shell: starts the server binary as sidecar and shows it in its window
scripts/    dev server, packaging, release
```

Core decisions:

- **One session per tab.** Each editor tab holds exactly one database connection, so transactions, temp tables and `SET`
  options persist per tab. Open transactions are detected and shown with Commit/Rollback. Introspection uses a separate
  metadata session per connection.
- **Unified type model.** `BIGINT`/`DECIMAL` as strings, timestamps as ISO 8601, binary as `0x` hex, everything else as
  JSON.
- **Bounded results.** Drivers read at most `rowLimit + 1` rows and cancel the rest; each tab has a timeout (default 60
  s).
- **Server-side export.** CSV/Parquet files are written by the server to the path chosen in a native save dialog,
  because the desktop webview does not handle downloads.
- **Sidecar.** The desktop app starts `colwerk-server` (next to its binary) and opens the URL it prints once it listens.
  The server ends when the app closes its stdin, so it does not outlive the app. The page reaches Tauri's menu, dialog
  and opener APIs as a remote page on `127.0.0.1` (`src-tauri/capabilities`).
- **Capabilities.** Drivers report `supportsCancel`, `supportsSchemas` and `supportsNetwork`; the UI adapts to them.

### Security

- The server binds to `127.0.0.1` on a random port.
- Every `/api/*` request needs a random per-start token (`x-colwerk-token`, constant-time comparison).
- Requests with a foreign `Host` or `Origin` are rejected (DNS rebinding, cross-site).

### Connections and credentials

Connections, open tabs and query history are stored as JSON in the data directory
(`~/Library/Application Support/colwerk`, `%APPDATA%\colwerk`, `$XDG_CONFIG_HOME/colwerk`; override with
`COLWERK_DATA_DIR`). Passwords are encrypted with AES-256-GCM; the key lives in the OS keychain, or in `secret.key`
(mode 0600) if none is available or `COLWERK_KEYCHAIN=off`.

### Drivers and native libraries

A driver implements `Driver` in `core/drivers/<name>.ts`, is registered in `core/registry.ts` and added to the contract
test in `tests/drivers.test.ts`. `connect()` must open exactly one connection (no pool), and `cancel()` must work
concurrently with `execute()`.

Native addons (currently DuckDB, `@duckdb/node-bindings`) are not embedded in the packages but downloaded from npm on
first use, verified by hash and stored in the data directory.

### Known limitations

- MSSQL `DECIMAL`/`MONEY` lose precision beyond ~15 digits (tedious returns JS numbers).
- Postgres/DuckDB/SQLite scripts commit each statement individually unless they contain their own `BEGIN`.
- SQLite cannot interrupt a statement: cancelling ends the session's worker, which rolls back an open transaction and
  drops temporary tables. A long step that returns no rows (an aggregate, a large `UPDATE`) still runs to its end in the
  background; outside a transaction its changes are committed.
- SQLite has no decimal or timestamp types: such values come back as stored (text or REAL).
- Geometries of SQL Server (`geometry`, `geography`) and SpatiaLite use their own binary formats and are shown as hex;
  DuckDB, PostGIS and MySQL/MariaDB geometries are shown as WKT.

## License

MIT, see [LICENSE](LICENSE). Third-party licenses are embedded in every build (`THIRD_PARTY_LICENSES.txt`).
