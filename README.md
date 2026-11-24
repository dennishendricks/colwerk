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

Colwerk connects to **PostgreSQL, MySQL/MariaDB, SQL Server, ClickHouse, DuckDB and SQLite**, reads lakehouses
(**Iceberg, Delta Lake, Unity Catalog, OneLake**) through DuckDB and queries CSV, Parquet, JSON and Excel files. It is
open source, free, runs entirely on your machine and has no telemetry, no analytics and no account.

## Download

macOS (Apple Silicon, `.dmg`), Windows (x64, `-setup.exe`) and Linux (x64/arm64, `.deb`):
**[latest release](https://github.com/dennishendricks/colwerk/releases/latest)**, with checksums and a CycloneDX
software bill of materials. See [Install and update](https://colwerk.app/docs/start/install/).

## Features

- **One session per tab**: transactions, temp tables and `SET` options persist per tab.
- **Result grid and export**: sort, filter, edit rows; export to CSV, Parquet, XLSX, JSON, Markdown or INSERT statements.
- **Import, schema and data compare, ER diagrams, session monitor, execution plans.**
- **Production guard rails**: color-coded and read-only connections, confirmations, dry runs.
- **Built-in MCP server**: let your own AI assistant browse schemas and run read-only queries.
- **Local by design**: listens on `127.0.0.1` only, passwords encrypted with a key in the OS keychain or read from a
  password manager.

Everything in detail, including security, MCP and known limitations:
**[documentation](https://colwerk.app/docs/start/)**.

---

## Development

Built with Nuxt 4 (SPA), Nuxt UI 4, CodeMirror 6 and Nitro. The server runs on Bun as a single-file executable; the
desktop app is a Tauri 2 shell around it. Bun is also the development toolchain (scripts, tests, formatting). See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

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

Database tests are skipped when the container is not reachable. Unity Catalog and OneLake have no automated tests.

### Architecture

```
core/       runtime-agnostic TypeScript on node: APIs: drivers, sessions, export, import, compare, store, secrets
server/     thin Nitro layer: security middleware, /api/* routes, MCP tools; no database logic
app/        Nuxt UI frontend, talks to /api/* only; native menus and dialogs through Tauri (app/utils/desktop.ts)
launcher/   entry point of the server binary (colwerk-server), MCP stdio bridge
src-tauri/  desktop shell: starts the server binary as sidecar and shows it in its window
scripts/    dev server, packaging, release
website/    colwerk.app and the documentation (Astro Starlight)
```

- **One session per tab**; introspection and the session monitor use separate sessions per connection.
- **Unified value model**: `BIGINT`/`DECIMAL` as strings, timestamps as ISO 8601, binary as `0x` hex, the rest as JSON.
- **Bounded results**: drivers read at most `rowLimit + 1` rows; exports and imports run on the server.
- **Sidecar**: the desktop app starts `colwerk-server` and opens the URL it prints; the server ends when the app closes
  its stdin. Every `/api/*` request needs a random per-start token, foreign `Host`/`Origin` headers are rejected.
- **Drivers** implement `Driver` in `core/drivers/<name>.ts`, are registered in `core/registry.ts` and added to
  `tests/drivers.test.ts`. `connect()` opens exactly one connection, `cancel()` works during `execute()`.
- **Native addons** (DuckDB) are embedded in the build (`scripts/duckdb-archive.ts`, verified by hash, platform and a
  test load) and unpacked at the first start; DuckDB extensions install on first use.

## License

MIT, see [LICENSE](LICENSE). Third-party licenses are embedded in every build (`THIRD_PARTY_LICENSES.txt`).
