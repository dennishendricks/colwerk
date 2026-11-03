# Colwerk

A lightweight SQL editor and database client for the desktop. Supports PostgreSQL, MySQL/MariaDB, Microsoft SQL Server,
DuckDB and SQLite.

Built with Nuxt 4 (SPA), Nuxt UI 4, CodeMirror 6 and Nitro, packaged with Deno (`deno desktop`, `deno compile`).

## Getting started

Requirements: Deno 2.9+, Docker (optional, for the test databases).

```sh
deno install --allow-scripts   # install dependencies
deno task hooks                # pre-commit hook: formats staged files with deno fmt
docker compose up -d           # test databases: Postgres :55432, MariaDB :53306, MSSQL :51433
deno task dev                  # dev server; prints the URL including the session token
```

| Task                  | Description                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| `deno task dev`       | Nuxt dev server on `127.0.0.1`, random port, fresh token                      |
| `deno task desktop`   | Desktop app for the host system (`--all-targets` for all), written to `dist/` |
| `deno task compile`   | Self-hosted binary `dist/colwerk` that opens the default browser              |
| `deno task release`   | Version bump and tag; GitHub Actions builds all targets and drafts a release  |
| `deno task test`      | Driver contract tests, API end-to-end test, SQL splitter tests                |
| `deno task typecheck` | `deno check` and `nuxt typecheck`                                             |
| `deno task fmt`       | Formats all files with `deno fmt` (settings in `deno.json`)                   |
| `deno task hooks`     | Enables the pre-commit hook in `.githooks/`                                   |

Tests against Postgres, MariaDB and MSSQL are skipped when the container is not reachable.

## Architecture

```
core/      runtime-agnostic TypeScript: drivers, sessions, export, store, keychain (no Nuxt or Deno dependencies, except DuckDB FFI)
server/    thin Nitro layer: security middleware, /api/* routes, MCP tools; no database logic
app/       Nuxt UI frontend, talks to /api/* only
launcher/  entry point for deno desktop / deno compile, MCP stdio bridge
scripts/   dev server, packaging, release
```

Core decisions:

- **One session per tab.** Each editor tab holds exactly one database connection, so transactions, temp tables and `SET`
  options persist per tab. Open transactions are detected and shown with Commit/Rollback. Introspection uses a separate
  metadata session per connection.
- **Unified type model.** `BIGINT`/`DECIMAL` as strings, timestamps as ISO 8601, binary as `0x` hex, everything else as
  JSON.
- **Bounded results.** Drivers read at most `rowLimit + 1` rows and cancel the rest; each tab has a timeout (default 60
  s).
- **Server-side export.** CSV/Parquet files are written by the server via a native save dialog, because the desktop
  webview does not handle downloads.
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
  "mcpServers": { "colwerk": { "command": "/Applications/Colwerk.app/Contents/MacOS/laufey_webview", "args": ["mcp"] } }
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

Native libraries (currently DuckDB) are loaded via `Deno.dlopen`, not as Node-API addons, which crash `deno desktop`
builds on Windows and Linux ([denoland/deno#36596](https://github.com/denoland/deno/issues/36596)). They are not
embedded in the packages but downloaded from npm on first use, verified by hash and stored in the data directory.

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
