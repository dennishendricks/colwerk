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
| `deno task release` | Version bump, build of all targets, tag and draft GitHub release (see [Releases](#releases)) |
| `deno task test` | Driver contract tests, API end-to-end test, SQL splitter tests |
| `deno task typecheck` | `deno check` for core/launcher/scripts/tests and `nuxt typecheck` |

Tests against Postgres, MariaDB and MSSQL are skipped when the container is not reachable. The API test requires a build in `.output` (e.g. after `deno task compile`).

## Builds

`deno task desktop` writes the packaged app to `dist/`:

| OS | arm64 | x86_64 |
|---|---|---|
| macOS | `Colwerk-<version>-macos-arm64.dmg` | `Colwerk-<version>-macos-x64.dmg` |
| Windows | – | `Colwerk-<version>-windows-x64.msi` |
| Linux | `Colwerk-<version>-linux-arm64.AppImage` | `Colwerk-<version>-linux-x64.AppImage` |

Next to each package, the unpacked app is written as `.zip` with the same name.

Windows and Linux builds are self-extracting, xz-compressed bundles. A `.dmg` can only be built on a macOS host. DuckDB's native library is not part of the packages; the app downloads it on first use (see [Native libraries](#native-libraries)).

`LICENSE` and `THIRD_PARTY_LICENSES.txt` are embedded in every build and also written to `dist/` for the release. The third-party list covers the Deno runtime and the npm packages that end up in the client and server bundles (recorded during `nuxt build` by a plugin in `nuxt.config.ts`) plus those Nitro copies to `.output/server/node_modules` (`scripts/licenses.ts`).

## Releases

`deno task release` asks for the release type (major, minor, patch) and bumps the version in `package.json`. It then empties `dist/`, builds all targets and writes `SHA256SUMS.txt`. After that it commits `package.json`, pushes it with the tag `v<version>` and creates a draft release on GitHub with all files from `dist/`. The update check in the app only sees the release once the draft is published. The script requires a clean `main` in sync with `origin/main` and a logged-in GitHub CLI (`gh`).

## Architecture

```
core/      runtime-agnostic TypeScript, no Nuxt or Deno dependencies (node: built-ins only; except the DuckDB FFI layer)
  types.ts        driver/session interface, capabilities, unified type model
  registry.ts     driver metadata, lazy loading of implementations
  drivers/*.ts    postgres (pg, pg-cursor), mysql (mysql2), mssql (mssql/tedious), duckdb (DuckDB C API via Deno FFI, duckdb-ffi.ts)
  workbench.ts    sessions per tab, metadata session per connection, introspection cache
  export.ts       CSV and Parquet encoders for streamed results
  dialog.ts       native file dialogs (osascript, PowerShell, zenity/kdialog)
  sql-split.ts    statement splitter, read-only statement detection
  store.ts        connection store, passwords encrypted with AES-256-GCM
  keychain.ts     encryption key in the OS keychain
server/    thin Nitro layer: security middleware, routes under /api/*, MCP tools under mcp/tools, no database logic
app/       Nuxt UI frontend, talks to /api/* only
launcher/  entry point for deno desktop / deno compile (token, port, window/browser), MCP stdio bridge
scripts/   dev server, packaging
```

**Sessions.** A driver's `connect(config)` returns a `Session` (`execute`, `stream`, `cancel`, `introspect`, `close`) backed by exactly one database connection. Each editor tab gets its own session, so transactions, temp tables and `SET` options persist per tab. Introspection uses a separate metadata session per connection, so a long-running query never blocks the schema tree.

**Capabilities.** Drivers report `supportsCancel`, `supportsSchemas` and `supportsNetwork`. The UI uses them to show the cancel button, the schema level in the tree, and host/port/user fields versus a file path.

**Unified type model.** All drivers return `BIGINT`/`DECIMAL` as strings, timestamps as ISO 8601 strings (with offset only for time-zone-aware types), binary data as `0x`-prefixed hex strings, and everything else as JSON values.

**Row limit.** Drivers read at most `rowLimit + 1` rows and cancel the rest on the server; the result set is marked `truncated: true`.

**Timeout.** Each tab has a timeout (default 60 s). When a statement has not finished by then, the workbench cancels it and returns an error. Closing a tab cancels its running statement and export before the session is closed.

**Scripts.** `execute()` returns every result set, each limited individually. Postgres and DuckDB run scripts statement by statement (split by `core/sql-split.ts`), MySQL sends the script as a whole, MSSQL splits on `GO`.

**Export.** Results can be exported to CSV or Parquet, either the displayed rows or the complete result. The complete result re-runs the statement in the tab's session and streams it with backpressure, so it is only offered for a single read-only statement. The server opens a native save dialog and writes the file itself, because the desktop webview does not handle browser downloads. Files are written to `<target>.part` and renamed on success. Parquet is written by [hyparquet-writer](https://github.com/hyparam/hyparquet-writer) and does not need DuckDB: rows are staged as JSON lines in a temporary file and encoded in row groups of 100,000. A column gets the Parquet type of its database type only if every value converts; otherwise it is written as a string.

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

Connections are stored in `connections.json` with passwords encrypted using AES-256-GCM. Default location: `~/Library/Application Support/colwerk` (macOS), `%APPDATA%\colwerk` (Windows), `$XDG_CONFIG_HOME/colwerk` (Linux); override with `DBM_DATA_DIR`. The open editor tabs (SQL text, limit, timeout, no results) are kept in `workspace.json` in the same directory.

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
5. If the driver needs a native binary, follow [Native libraries](#native-libraries).

## Native libraries

Drivers that need a native binary (currently DuckDB, see `core/drivers/duckdb-ffi.ts`) follow these rules.

**No Node-API addons.** `.node` addons do not work in `deno desktop` builds: the executable does not export the N-API symbols, so on Windows and Linux the app exits without an error message as soon as the addon is loaded ([denoland/deno#36596](https://github.com/denoland/deno/issues/36596)). macOS and `deno run` hide the problem. Load the library's C API with `Deno.dlopen` instead (`--allow-ffi` is part of every build):
- Mark calls that can run long as `nonblocking: true`. They run on their own thread, so the event loop stays responsive and cancel/timeout can interrupt them.
- Never free a native handle while a nonblocking call still uses it. `Session.close()` may be called during a running statement, so it has to interrupt and wait for the statement first.
- `nuxt typecheck` also checks `core/` and does not know Deno's types: type the FFI API used locally (as in `duckdb-ffi.ts`).
- Nitro's Deno preset adds `import process from 'node:process'` to every chunk; use named imports from `node:process` in driver modules.

**Not embedded, downloaded on demand.** Native libraries are large (`libduckdb` is about 55 MB per architecture) and platform-specific, so packages do not contain them:
- `scripts/package.ts` writes a manifest per build target into `.output/launcher/` (npm package, tarball URL, SHA-512 integrity from the registry). Keep the library's npm package out of `.output`: the driver must not import it, so Nitro does not trace it.
- `launcher/native.ts` downloads the tarball on request, checks the hash, unpacks only the library into `<data dir>/drivers/<name>-<version>-<platform>/` (atomically via a temp directory) and removes other versions. It passes the library path and an `installed()`/`install()` hook to the server through globalThis.
- `core/registry.ts` reports `installed: false` until the library is in place. The connection dialog then offers "Datenbanktreiber laden" instead of "Testen"/"Speichern", and connecting fails with `ENODRIVER`.
- Running from source, the driver loads the library from the host's platform package in `node_modules`, resolved from the working directory (Nitro bundles do not keep `import.meta.url`).

The download path, hook and status are currently written for DuckDB only (`duckdbGlobals()`, `dbmDuckdb`, `installDriver()`); a second native driver has to generalize them.

**Versions and tests.** Pin the package version exactly; updating it changes the download, and the C API functions used must exist in that version. Unit tests and `deno task dev` do not cover packaged builds: test the driver in a `deno desktop` build on every target, at least once on Windows and Linux.

DuckDB uses `@duckdb/node-bindings` (LTS `1.4.5-r.1`) only as the source of `libduckdb.{dylib,so}` / `duckdb.dll`.

## Known limitations

- **DuckDB** needs `registry.npmjs.org` once per version (proxies via `HTTPS_PROXY`). Without access, DuckDB connections cannot be used.
- **MSSQL:** tedious returns `DECIMAL`/`NUMERIC`/`MONEY` as JS numbers, losing precision beyond ~15 significant digits; `datetime2` is truncated to milliseconds. The row limit of a batch without `;` also cancels its subsequent statements. `GO n` is not supported, and statements containing blank lines must be selected before running.
- **MySQL:** the result grid shows protocol type names (`LONGLONG`, `NEWDECIMAL`, …). Cancelling after the row limit opens a short extra connection (`KILL QUERY`).
- **Postgres/DuckDB scripts** commit each statement individually; a script without its own `BEGIN` is not atomic.
- **Export:** read-only detection is a text heuristic (side-effecting functions such as `nextval()` are not detected). Postgres `numeric` without precision and binary data are written to Parquet as strings.
- **Formatting:** SQL that sql-formatter cannot parse is left unchanged; lines are not wrapped.
- **Autocomplete** loads columns for tables referenced in the editor or expanded in the tree.
- Tabs and editor contents are not restored after a restart.
- Tested on macOS arm64 only. Windows and Linux builds, including keychain, file dialogs and DuckDB, are untested.

## License

MIT, see [LICENSE](LICENSE). Third-party licenses: see [Builds](#builds).
