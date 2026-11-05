# Colwerk

A lightweight SQL editor and database client for the desktop. Supports PostgreSQL, MySQL/MariaDB, Microsoft SQL Server,
DuckDB and SQLite.

Built with Nuxt 4 (SPA), Nuxt UI 4, CodeMirror 6 and Nitro. The server runs on Bun as a single-file executable; the
desktop app is a Tauri 2 shell around it. Bun is also the development toolchain (scripts, tests, formatting).

## Getting started

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
| `bun test`          | Driver contract tests, API end-to-end test, SQL splitter tests                             |
| `bun run typecheck` | `nuxt typecheck`, including core, launcher, scripts and tests (`tsconfig.bun.json`)        |
| `bun fmt`           | Formats all files (settings in `bunfig.toml`)                                              |
| `bun run hooks`     | Enables the pre-commit hook in `.githooks/`                                                |

Tests against Postgres, MariaDB and MSSQL are skipped when the container is not reachable.

## Architecture

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

## Security

- The server binds to `127.0.0.1` on a random port.
- Every `/api/*` request needs a random per-start token (`x-colwerk-token`, constant-time comparison).
- Requests with a foreign `Host` or `Origin` are rejected (DNS rebinding, cross-site).

## MCP server

Colwerk serves an MCP endpoint at `/mcp`. Clients that start a command use the stdio bridge, which finds the running app
on its own:

```json
{
  "mcpServers": { "colwerk": { "command": "/Applications/Colwerk.app/Contents/MacOS/colwerk-server", "args": ["mcp"] } }
}
```

MCP clients authenticate with their own persistent token (`Authorization: Bearer <token>`, stored in the OS keychain,
overridable via `COLWERK_MCP_TOKEN`). The tools list connections, schemas and tables, run read-only queries and open SQL
in a new editor tab. Queries run in a separate session inside a transaction that is always rolled back.

## Connections and credentials

Connections, open tabs and query history are stored as JSON in the data directory
(`~/Library/Application Support/colwerk`, `%APPDATA%\colwerk`, `$XDG_CONFIG_HOME/colwerk`; override with
`COLWERK_DATA_DIR`). Passwords are encrypted with AES-256-GCM; the key lives in the OS keychain, or in `secret.key`
(mode 0600) if none is available or `COLWERK_KEYCHAIN=off`.

## Drivers and native libraries

A driver implements `Driver` in `core/drivers/<name>.ts`, is registered in `core/registry.ts` and added to the contract
test in `tests/drivers.test.ts`. `connect()` must open exactly one connection (no pool), and `cancel()` must work
concurrently with `execute()`.

Native addons (currently DuckDB, `@duckdb/node-bindings`) are not embedded in the packages but downloaded from npm on
first use, verified by hash and stored in the data directory.

## Known limitations

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
