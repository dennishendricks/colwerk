# Colwerk

A lightweight SQL editor and database client for the desktop. Supports PostgreSQL, MySQL/MariaDB, Microsoft SQL Server and DuckDB.

Built with Nuxt 4 (SPA), Nuxt UI 4, CodeMirror 6 and Nitro, packaged with Deno (`deno desktop`, `deno compile`).

## Getting started

Requirements: Deno 2.9+, Docker (optional, for the test databases).

```sh
deno install --allow-scripts   # install dependencies from package.json
docker compose up -d           # test databases: Postgres :55432, MariaDB :53306, MSSQL :51433
deno task dev                  # dev server; prints the URL including the session token
```

| Task | Description |
|---|---|
| `deno task dev` | Nuxt dev server on `127.0.0.1`, random port, fresh token |
| `deno task desktop` | Desktop app for the host system (see [Builds](#builds)) |
| `deno task desktop --all-targets` | Desktop apps for all supported targets |
| `deno task compile` | Self-hosted binary `dist/colwerk` that opens the default browser |
| `deno task test` | Driver contract tests, API end-to-end test, SQL splitter tests |
| `deno task typecheck` | `deno check` for core/launcher/scripts/tests and `nuxt typecheck` |

Tests against Postgres, MariaDB and MSSQL are skipped when the container is not reachable. The API test requires a build in `.output` (e.g. after `deno task compile`).

## Builds

`deno task desktop` writes the packaged app to `dist/`:

| OS | arm64 | x86_64 |
|---|---|---|
| macOS | `Colwerk.dmg` | `Colwerk-x64.dmg` |
| Windows | – | `Colwerk.msi` |
| Linux | `Colwerk.AppImage` | `Colwerk-x64.AppImage` |

Windows and Linux builds are self-extracting, xz-compressed bundles. A `.dmg` can only be built on a macOS host. DuckDB's native package for each target is fetched from the npm registry during the build.

## Architecture

```
core/      runtime-agnostic TypeScript, no Nuxt or Deno dependencies (node: built-ins only)
  types.ts        driver/session interface, capabilities, unified type model
  registry.ts     driver metadata, lazy loading of implementations
  drivers/*.ts    postgres (pg, pg-cursor), mysql (mysql2), mssql (mssql/tedious), duckdb (@duckdb/node-api)
  workbench.ts    sessions per tab, metadata session per connection, introspection cache
  export.ts       CSV and Parquet encoders for streamed results
  dialog.ts       native file dialogs (osascript, PowerShell, zenity/kdialog)
  sql-split.ts    statement splitter, read-only statement detection
  store.ts        connection store, passwords encrypted with AES-256-GCM
  keychain.ts     encryption key in the OS keychain
server/    thin Nitro layer: security middleware, routes under /api/*, MCP tools under mcp/tools, no database logic
app/       Nuxt UI frontend, talks to /api/* only
launcher/  entry point for deno desktop / deno compile (token, port, window/browser), MCP stdio bridge
scripts/   dev server, packaging, DuckDB smoke test
```

**Sessions.** A driver's `connect(config)` returns a `Session` (`execute`, `stream`, `cancel`, `introspect`, `close`) backed by exactly one database connection. Each editor tab gets its own session, so transactions, temp tables and `SET` options persist per tab. Introspection uses a separate metadata session per connection, so a long-running query never blocks the schema tree.

**Capabilities.** Drivers report `supportsCancel`, `supportsSchemas` and `supportsNetwork`. The UI uses them to show the cancel button, the schema level in the tree, and host/port/user fields versus a file path.

**Unified type model.** All drivers return `BIGINT`/`DECIMAL` as strings, timestamps as ISO 8601 strings (with offset only for time-zone-aware types), binary data as `0x`-prefixed hex strings, and everything else as JSON values.

**Row limit.** Drivers read at most `rowLimit + 1` rows and cancel the rest on the server; the result set is marked `truncated: true`.

**Timeout.** Each tab has a timeout (default 60 s). When a statement has not finished by then, the workbench cancels it and returns an error. Closing a tab cancels its running statement and export before the session is closed.

**Scripts.** `execute()` returns every result set, each limited individually. Postgres and DuckDB run scripts statement by statement (split by `core/sql-split.ts`), MySQL sends the script as a whole, MSSQL splits on `GO`.

**Export.** Results can be exported to CSV or Parquet, either the displayed rows or the complete result. The complete result re-runs the statement in the tab's session and streams it with backpressure, so it is only offered for a single read-only statement. The server opens a native save dialog and writes the file itself, because the desktop webview does not handle browser downloads. Files are written to `<target>.part` and renamed on success. Parquet is staged in a temporary DuckDB database and written by DuckDB's Parquet writer.

**Introspection.** Dialect-specific catalog queries, loaded lazily per level (schemas → tables → columns) and cached on the server.

**Formatting.** [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) with 4-space indentation, plus post-processing for leading commas, `!=` instead of `<>`, and `on` on its own line below the join.

## Security

- The server binds to `127.0.0.1` on a random port.
- Each start generates a random 256-bit token. Every `/api/*` request must send it as `x-dbm-token`; the comparison is constant-time. `/mcp` requires the MCP token instead (see [MCP server](#mcp-server)). The dev server and the self-hosted binary pass it in the URL fragment (never logged), the desktop app via a window binding.
- The middleware rejects requests with a foreign `Host` (DNS rebinding) or `Origin` (cross-site requests) with 403.
- File dialogs always open on the local machine; export paths are only accepted with a valid token.

## MCP server

Colwerk serves an MCP endpoint (Streamable HTTP, built with [@nuxtjs/mcp-toolkit](https://mcp-toolkit.nuxt.dev)) at `/mcp` on the app's port. Clients that start a command use the stdio bridge, which finds the running app on its own:

```json
{ "mcpServers": { "colwerk": { "command": "/Applications/Colwerk.app/Contents/MacOS/laufey_webview", "args": ["mcp"] } } }
```

With `dist/colwerk` (self-hosted binary) the command is `colwerk mcp`, in development `deno run -A launcher/main.ts mcp`. The bridge forwards each JSON-RPC message from stdin to `/mcp` and writes the replies to stdout. It reads the port from `instance.json` in the data directory, which the launcher writes on start and removes on exit, and answers with an error while the app is not running.

MCP clients authenticate with their own token, separate from the UI's session token: `Authorization: Bearer <token>`. It is created on first start and kept, stored like the encryption key in the OS keychain (account suffix `-mcp`), otherwise in `mcp-token` (mode 0600) next to the data. `COLWERK_MCP_TOKEN` overrides it. HTTP clients can use the endpoint directly with this token; the port changes on every start.

| Tool | Purpose |
|---|---|
| `list-connections` | Connections with `connectionId`, dialect, databases, reachability, read-only flag. Call first. |
| `list-schemas` | Schemas with the number of tables and views |
| `list-tables` | Tables and views with estimated row count and comment |
| `describe-table` | Columns (type, nullable, PK, FK target, indexes, comment), partitioning, clustering |
| `sample-rows` | Up to 50 rows as JSON objects |
| `run-query` | One `SELECT`/`WITH` statement, up to 1000 rows, 30 s timeout |
| `open-query` | Opens SQL in a new editor tab without running it (via server-sent events at `/api/events`) |

All tools except `open-query` only read. `run-query` and `sample-rows` accept a single `SELECT`/`WITH` statement (text check) and run it in a session of their own inside a transaction that is never committed and is rolled back on close (Postgres and MySQL: `READ ONLY`; SQL Server: implicit transactions; DuckDB: `BEGIN`). A procedure that commits on its own on SQL Server is not covered by this.

## Connections and credentials

Connections are stored in `connections.json` with passwords encrypted using AES-256-GCM. Default location: `~/Library/Application Support/colwerk` (macOS), `%APPDATA%\colwerk` (Windows), `$XDG_CONFIG_HOME/colwerk` (Linux); override with `DBM_DATA_DIR`.

The encryption key lives in the OS keychain (service `colwerk`, one entry per data directory): macOS Keychain, Linux Secret Service (`secret-tool`), Windows Credential Manager. Secrets are always passed via stdin, never as arguments. Without a usable keychain, or with `DBM_KEYCHAIN=off`, the key is stored in `secret.key` (mode 0600) next to the data. This only protects against accidental disclosure (backups, sync folders), not against someone with access to the user account. If the keychain denies access, Colwerk reports an error instead of silently falling back to the file.

TLS supports a custom CA certificate (PEM, replaces the system CAs) or disabling certificate verification.

## Adding a driver

1. Create `core/drivers/<name>.ts` implementing `Driver`:
   - `connect()` opens **exactly one** connection (no pool, or session state is lost).
   - `execute()` returns all result sets with at most `rowLimit` rows each and cancels the remainder without dropping subsequent statements. Normalize values with `normalizeValue()` from `core/values.ts`.
   - `cancel()` must work when called concurrently with a running `execute()`.
   - `introspect()` answers `schemas`, `tables` and `columns` (including primary keys, foreign keys with target table, index names).
   - Throw `DbError`; the server turns it into HTTP 400 with the message.
2. Extend `Dialect` in `core/types.ts` and register the driver with its capabilities in `core/registry.ts`.
3. Add the CodeMirror dialect in `app/components/SqlEditor.vue` (`DIALECTS`) and, if needed, quoting rules in `core/sql-split.ts`.
4. Add an entry to `tests/drivers.test.ts`. The contract test covers the type model, row limit, session state, DML, errors, cancel and introspection. Add a container to `docker-compose.yml` if needed.

## DuckDB in compiled builds

In compiled binaries Deno extracts only the `.node` file of a native addon to `<tmpdir>/deno-native-addons/`, but `duckdb.node` loads `libduckdb.dylib`/`.so` from its own directory. Before the first import of `@duckdb/node-api`, `launcher/native.ts` therefore copies the library from the embedded file system next to the addon. `core/` receives this as a hook (`prepareDuckdb()` in `core/registry.ts`) to stay free of Deno dependencies. Verify with:

```sh
deno compile -A -o /tmp/duck-smoke scripts/duckdb-smoke.ts && /tmp/duck-smoke
deno desktop -A -o /tmp/DuckSmoke scripts/duckdb-smoke.ts   # window shows OK/FAIL
```

Related build details:
- Nitro keeps `@duckdb/node-api` external, so the addon and its library are traced together into `.output/server/node_modules`.
- `scripts/package.ts` embeds only `.output` and resolves npm packages from there (`nodeModulesDir: "manual"`). On macOS it thins the universal `libduckdb.dylib` to the target architecture with `lipo -thin`, which keeps the code signature valid.
- `@duckdb/node-api` is pinned to the LTS release `1.4.5-r.1`.

## Known limitations

- **DuckDB** relies on Deno's internal extraction directory. On Linux `/tmp` is shared, so `TMPDIR` should be user-specific.
- **MSSQL:** tedious returns `DECIMAL`/`NUMERIC`/`MONEY` as JS numbers, losing precision beyond ~15 significant digits; `datetime2` is truncated to milliseconds. The row limit of a batch without `;` also cancels its subsequent statements. `GO n` is not supported, and statements containing blank lines must be selected before running.
- **MySQL:** the result grid shows protocol type names (`LONGLONG`, `NEWDECIMAL`, …). Cancelling after the row limit opens a short extra connection (`KILL QUERY`).
- **Postgres/DuckDB scripts** commit each statement individually; a script without its own `BEGIN` is not atomic.
- **Export:** read-only detection is a text heuristic (side-effecting functions such as `nextval()` are not detected). Postgres `numeric` without precision and binary data are written to Parquet as strings.
- **Formatting:** SQL that sql-formatter cannot parse is left unchanged; lines are not wrapped.
- **Autocomplete** loads columns for tables referenced in the editor or expanded in the tree.
- Tabs and editor contents are not restored after a restart.
- Tested on macOS arm64 only. Windows and Linux builds, including keychain, file dialogs and DuckDB, are untested.
