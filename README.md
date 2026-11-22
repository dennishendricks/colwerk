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

Colwerk connects to **PostgreSQL, MySQL/MariaDB, Microsoft SQL Server, ClickHouse, DuckDB and SQLite**, and reads
lakehouses through DuckDB: **Apache Iceberg** (REST catalog), **Delta Lake** (local folder), **Databricks Unity Catalog**
and **Microsoft Fabric OneLake**. It also queries CSV, Parquet, JSON and Excel files. It is open source, free, runs entirely on your machine and has no telemetry, no
analytics and no account.

## Download

| Platform | Architecture  | Package      |
| -------- | ------------- | ------------ |
| macOS    | Apple Silicon | `.dmg`       |
| Windows  | x64           | `-setup.exe` |
| Linux    | x64, arm64    | `.deb`       |

**[→ Get the latest release](https://github.com/dennishendricks/colwerk/releases/latest)** — all files and checksums
are listed there, along with a software bill of materials of the npm packages and Rust crates
(`Colwerk-<version>.cdx.json`, CycloneDX). Install, start Colwerk, add a connection and run your first query.

## Features

- **One session per tab** – transactions, temp tables and `SET` options persist per tab; open transactions can be
  committed or rolled back.
- **Gentle on the database** – reads only up to the row limit, loads the schema tree on demand and takes table sizes from
  statistics instead of `COUNT(*)`.
- **Import and copy data** – load CSV, TSV, JSON/NDJSON, Excel and Parquet files or the table of another connection into
  a new or existing table, with column mapping, a reviewable `CREATE TABLE`, append, truncate + reload or upsert, in
  batches inside transactions.
- **Production guard rails** – color-coded connections, read-only connections (enforced by the database where it can),
  optional confirmation before statements that change data or structure, and a stop for UPDATE/DELETE without WHERE.
- **Session monitor** – running queries and blocking chains (PostgreSQL, MySQL/MariaDB, SQL Server, ClickHouse); cancel
  a query or terminate a session after confirmation.
- **Result grid** – sort, filter, pin, hide and resize columns; copy rows as JSON or CSV; edit, add, clone and delete rows of a single table with a key, reviewed as SQL and saved in one transaction.
- **CSV and Parquet export** – the visible rows or the full, unlimited result, written straight to disk.
- **Schema and data compare** – compare two schemas, or one table across two connections of the same engine; deploy
  and sync scripts can be copied or opened in a tab, nothing runs automatically.
- **Editor comforts** – autocomplete for tables, columns, aliases (also of CTEs and subqueries) and the engine's
  functions, JOINs along foreign keys with their `ON` clause, optional checks for unknown or ambiguous names and for
  `UPDATE`/`DELETE` without `WHERE`, SQL formatting, execution plans (graphical for SQL Server, estimated and
  actual), SQL templates, multiple cursors, searchable
  history.
- **ER diagrams** – read-only, from the foreign keys of a schema or of a table and its neighbors; export as Mermaid or
  DBML.
- **Result grid** – sort, filter, pin, hide and resize columns; copy rows or the whole result as JSON, CSV, Markdown or INSERT statements.
- **Export** – CSV, Parquet, Excel (XLSX), JSON/NDJSON, Markdown and SQL INSERT statements in the connection's dialect;
  the visible rows or the full, unlimited result, written straight to disk.
- **Editor comforts** – autocomplete for tables and columns, SQL formatting, execution plans, SQL templates, multiple
  cursors and a searchable query history.
- **Pre-flight checks** – a dry run reports how many rows an INSERT, UPDATE, DELETE or MERGE would change and rolls it
  back; on protected connections an EXPLAIN warns before full scans of large tables.
- **Connection import** – from DBeaver, Beekeeper Studio, Azure Data Studio, `.pgpass` and dbt `profiles.yml`, with
  preview and duplicate check.
- **Opens your files** – double-click a `.sql` file to open it in a tab, a SQL Server execution plan (`.sqlplan`) to
  show it as a plan, a DuckDB or SQLite file (`.duckdb`, `.sqlite`, `.sqlite3`) to open it as a connection.
- **Query files** – drop CSV, TSV, Parquet, JSON/NDJSON or Excel (`.xlsx`) files onto the window, or query `s3://`,
  `gs://` and `https://` URLs: each becomes a view of an in-memory DuckDB scratch connection, ready to query and join.
- **Built-in MCP server** – let your own AI assistant browse schemas and run read-only queries (see below).
- **Local by design** – the server only listens on `127.0.0.1`, passwords are encrypted, the key lives in the OS
  keychain.

More details, screenshots and the privacy notes: **[colwerk.app](https://colwerk.app/)**

---

## Development

Built with Nuxt 4 (SPA), Nuxt UI 4, CodeMirror 6 and Nitro. The server runs on Bun as a single-file executable; the
desktop app is a Tauri 2 shell around it. Bun is also the development toolchain (scripts, tests, formatting).

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

### Getting started

Requirements: Bun 1.4+, Docker (optional, for the test databases). For the desktop app also Rust (stable) and, on
Linux, Tauri's system packages (`libwebkit2gtk-4.1-dev libxdo-dev libssl-dev librsvg2-dev`).

```sh
bun install            # install dependencies
bun run hooks          # pre-commit hook: formats staged files with bun fmt
docker compose up -d   # test databases: Postgres :55432, MariaDB :53306, MSSQL :51433, ClickHouse :58123, Iceberg REST :58181
bun run dev            # dev server; prints the URL including the session token
```

| Command             | Description                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `bun run dev`       | Nuxt dev server on `127.0.0.1`, random port, fresh token (`--desktop`: in the Tauri shell) |
| `bun run desktop`   | Desktop app for the host system: installer in `dist/`                                      |
| `bun run compile`   | Self-hosted binary `dist/colwerk` that opens the default browser                           |
| `bun run release`   | Version bump and tag; GitHub Actions builds all targets and drafts a release               |
| `bun run test`      | Driver contract tests, API end-to-end test, SQL splitter tests                             |
| `bun run typecheck` | `nuxt typecheck`, including core, launcher, scripts and tests (`tsconfig.bun.json`)        |
| `bun fmt`           | Formats all files (settings in `bunfig.toml`)                                              |
| `bun run hooks`     | Enables the pre-commit hook in `.githooks/`                                                |

Tests against Postgres, MariaDB, MSSQL, ClickHouse and the Iceberg REST catalog are skipped when the container is not
reachable. Unity Catalog and OneLake need cloud accounts and have no automated tests.

`COLWERK_E2E=1 bun test ./tests/duckdb-download.test.ts` downloads DuckDB's native library from npm like a packaged
build; CI runs it on every system (`.github/workflows/e2e.yml`), and weekly.

### Architecture

```
core/       runtime-agnostic TypeScript on node: APIs: drivers, sessions, export, store, keychain, secret references (no Nuxt dependencies)
server/     thin Nitro layer: security middleware, /api/* routes, MCP tools; no database logic
app/        Nuxt UI frontend, talks to /api/* only; native menus and dialogs through Tauri (app/utils/desktop.ts)
launcher/   entry point of the server binary (colwerk-server), MCP stdio bridge
src-tauri/  desktop shell: starts the server binary as sidecar and shows it in its window
scripts/    dev server, packaging, release
```

Core decisions:

- **One session per tab.** Each editor tab holds exactly one database connection, so transactions, temp tables and `SET`
  options persist per tab. Open transactions are detected and shown with Commit/Rollback. Introspection uses a separate
  metadata session per connection. Foreign keys are loaded on demand too, per table for the editor and per schema for ER
  diagrams.
- **Unified type model.** `BIGINT`/`DECIMAL` as strings, timestamps as ISO 8601, binary as `0x` hex, everything else as
  JSON.
- **Bounded results.** Drivers read at most `rowLimit + 1` rows and cancel the rest; each tab has a timeout (default 60
  s).
- **Compare from catalog queries and merged streams.** Schema snapshots come from catalog queries on the metadata
  session; data compare streams both tables ordered by key under a binary collation and merges them, holding at most
  one batch per side.
- **Server-side export.** CSV/Parquet files are written by the server to the path chosen in a native save dialog,
- **Server-side export.** Export files are written by the server to the path chosen in a native save dialog,
  because the desktop webview does not handle downloads.
- **Imports on the server.** The source is streamed through one session (files through a private in-memory DuckDB),
  batches are written through another, each in its own transaction (ClickHouse: one insert per batch);
  `GET /api/imports/<id>` reports the progress.
- **Sidecar.** The desktop app starts `colwerk-server` (next to its binary) and opens the URL it prints once it listens.
  The server ends when the app closes its stdin, so it does not outlive the app. The page reaches Tauri's menu, dialog
  and opener APIs as a remote page on `127.0.0.1` (`src-tauri/capabilities`).
- **Capabilities.** Drivers report `supportsCancel`, `supportsSchemas`, `supportsNetwork`, `supportsDatabases`,
  `locksDatabase` and `sessionActions` (what the session monitor may do; empty for embedded databases); the UI adapts to
  them.
- **Session monitor.** The monitor uses its own session per connection, because the metadata session might wait on the
  locks being investigated.
- **ClickHouse over HTTP.** No client library: each statement is one request to the HTTP interface, a `session_id`
  keeps temporary tables and `SET` options per tab.
- **Lakehouses on DuckDB.** Each lakehouse connection is an in-memory DuckDB database with the format's extensions
  (installed from DuckDB's extension repository on first use). Iceberg REST catalogs and Unity catalogs are attached
  (Unity: the database picker switches the catalog); the Delta tables of a folder or of a OneLake lakehouse become
  views (OneLake: the database picker switches the lakehouse). Queries are DuckDB SQL. Files connections (`files`) work
  the same way: each data file or URL becomes a view (`read_csv`, `read_parquet`, `read_json`, `read_xlsx`); S3/GCS
  keys and bearer tokens become DuckDB secrets.

### Security

- The server binds to `127.0.0.1` on a random port.
- Every `/api/*` request needs a random per-start token (`x-colwerk-token`, constant-time comparison).
- Requests with a foreign `Host` or `Origin` are rejected (DNS rebinding, cross-site).

### Connections and credentials

Connections, open tabs, query history and the MCP audit log are stored in the data directory
(`~/Library/Application Support/colwerk`, `%APPDATA%\colwerk`, `$XDG_CONFIG_HOME/colwerk`; override with
`COLWERK_DATA_DIR`). Passwords, keys and tokens (including MCP passwords) are encrypted with AES-256-GCM; the key
lives in the OS keychain, or in `secret.key` (mode 0600) if none is available or `COLWERK_KEYCHAIN=off`.

Instead of being stored, every secret field (password, client secret, token, SSH password or passphrase) can reference a
password manager: 1Password (`op://vault/item/field`, read with `op`), Bitwarden (item ID and field, `bw`), Bitwarden
Secrets Manager (secret ID, `bws`) or KeePassXC (database file, entry path, attribute and optional key file,
`keepassxc-cli`). Colwerk stores only the reference and reads the secret on every connect, so a rotated password is
picked up; the value stays in memory and is never written to disk. The CLIs run without a shell with the reference as
the only argument, the secret is read from stdout. Master passwords of KeePassXC and Bitwarden and the Secrets Manager
token are asked for in the app and kept in memory until Colwerk quits (Bitwarden: only the `bw` session key); an
inherited `BW_SESSION` or `BWS_ACCESS_TOKEN` works too, 1Password uses its app integration or
`OP_SERVICE_ACCOUNT_TOKEN`. The CLIs are looked up on the PATH and in `/opt/homebrew/bin`, `/usr/local/bin`,
`/Applications/KeePassXC.app/Contents/MacOS` and `%ProgramFiles%\KeePassXC`; on Windows only `.exe` files work (not
npm's `bw.cmd`). `bw` reads its local copy: run `bw sync` to pick up changes (Colwerk syncs once after unlocking).

The connection import only reads the other tools' files, at their default locations or a file you choose. DBeaver and
Beekeeper Studio passwords are decrypted with those apps' built-in keys. Azure Data Studio keeps passwords in the OS
credential store, so the preview asks for them. dbt `env_var()` values are marked, not filled in. Imported passwords
are stored encrypted like all others.

### MCP server

`colwerk-server mcp` is a stdio bridge to `/mcp` and authenticates with the MCP token (`core/mcp-token.ts`). Queries
pass three guard layers: `isSelectStatement`, a transaction that is never committed (`GUARD` in `server/utils/mcp.ts`),
then the statement timeout and the row limit.

- **MCP login:** optional and per connection, for password, Windows and token logins. It never falls back to the main
  login, and MCP then gets sessions of its own (`mcp:<id>`). Entra and OAuth logins have none.
- **DuckDB:** MCP opens the database read-only in its own instance with `enable_external_access = false`, so no files,
  URLs or extensions. The instance closes after every request. This fails while Colwerk has the file open for writing.
  The opt-in "Let AI assistants (MCP) read files and URLs" restores the shared instance. Lakehouse and files
  connections need file and network access and are queried as in the editor.
- **Prompt injection:** query results can contain instructions, and read-only access does not stop a model from acting
  on them with its other tools. The MCP settings show this notice.
- **Audit log:** every tool call goes to `mcp-audit.jsonl` with time, client (from the bridge), tool, connection, SQL,
  duration, row count, status and error. Result rows and credentials are never logged. Retention is 7 to 365 days
  (default 30, at most 10,000 entries). The log can be viewed, filtered and cleared in the app.

### Drivers and native libraries

A driver implements `Driver` in `core/drivers/<name>.ts`, is registered in `core/registry.ts` and added to the contract
test in `tests/drivers.test.ts`. `connect()` must open exactly one connection (no pool), and `cancel()` must work
concurrently with `execute()`.

Native addons (currently DuckDB, `@duckdb/node-bindings`) are not embedded in the packages but downloaded from npm on
first use, verified by hash and stored in the data directory. DuckDB extensions (`excel`, `httpfs`, lakehouse formats)
are installed by DuckDB on first use.

### Known limitations

- The session monitor: SQL Server can only terminate sessions, ClickHouse can only cancel queries. Without
  `pg_read_all_stats`, `PROCESS` or `VIEW SERVER STATE` only your own sessions are visible (MySQL: no lock relations).
- Postgres/DuckDB/SQLite scripts commit each statement individually unless they contain their own `BEGIN`.
- INSERT exports write arrays, structs and maps as JSON text; columns of such types may need a cast. XLSX holds at most
  1,048,576 rows.
- SQLite cannot interrupt a statement: cancelling ends the session's worker, which rolls back an open transaction and
  drops temporary tables. A long step that returns no rows (an aggregate, a large `UPDATE`) still runs to its end in the
  background; outside a transaction its changes are committed.
- Read-only connections: PostgreSQL and MySQL restrict the session and ClickHouse sends `readonly = 2`, which a session can
  switch back; SQL Server and lakehouses rely on Colwerk's check of the SQL text alone. For real protection use a login
  with read privileges only.
- Tables created in a files connection live in memory and are gone when Colwerk quits or the connection's settings
  change; its views over files and URLs are created again. Excel `.xls` files cannot be read (only `.xlsx`).
- SQLite has no decimal or timestamp types: such values come back as stored (text or REAL).
- Schema compare covers tables, columns, primary key, unique, check and foreign key constraints, indexes and views of
  PostgreSQL 12+, MySQL/MariaDB and SQL Server. Not compared: sequences other than serial/identity, routines, triggers,
  types and enums, comments, grants, partitioning, table options, materialized views and column order. SQLite, DuckDB,
  ClickHouse and lakehouses have no schema compare. Dropping a PostgreSQL view that other views depend on fails.
- Data compare covers PostgreSQL, MySQL/MariaDB, SQL Server, SQLite and DuckDB, one table at a time. It rejects
  array, spatial and nested columns (PostgreSQL arrays and geometries, DuckDB `LIST`/`STRUCT`/`MAP`/`UNION`, MySQL
  spatial types, SQL Server `geometry`/`geography`/`xml`/`sql_variant`/`hierarchyid`).
- MySQL sync scripts assume `NO_BACKSLASH_ESCAPES` is off (the default).
- Geometries of SQL Server (`geometry`, `geography`) and SpatiaLite use their own binary formats and are shown as hex;
  DuckDB, PostGIS and MySQL/MariaDB geometries are shown as WKT.
- Imports commit batch by batch; a stopped or cancelled import keeps the batches written before. Source and target in
  the same SQLite file are not supported (the reader blocks the writer).

## License

MIT, see [LICENSE](LICENSE). Third-party licenses are embedded in every build (`THIRD_PARTY_LICENSES.txt`).
