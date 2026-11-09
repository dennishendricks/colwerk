# Changelog

All notable changes to Colwerk. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/). Releases and their files are on
[GitHub](https://github.com/dennishendricks/colwerk/releases).

## [Unreleased]

### Added

- ClickHouse connections (HTTP interface, one `session_id` per tab).
- Lakehouses through DuckDB: Apache Iceberg (REST catalog), Delta Lake (local folder), Databricks Unity Catalog and
  Microsoft Fabric OneLake.
- Folder picker for Delta Lake connections, and a browse button for database files.

### Changed

- `@azure/identity` is only loaded for Entra logins.

### Fixed

- Installing DuckDB on Windows no longer fails when a virus scanner briefly locks the new files (the rename is
  retried).

## [0.5.1] - 2026-11-06

### Fixed

- The macOS `.app` is ad-hoc signed.

## [0.5.0] - 2026-11-05

### Changed

- The desktop app is a Tauri 2 shell around the server, which runs as a sidecar; installers are `.dmg`, `.msi`,
  AppImage and `.deb` (see [ADR 0002](docs/adr/0002-tauri-shell-node-sidecar.md)).
- The server is a Bun single-file executable, and Bun replaces Deno as the toolchain (see
  [ADR 0003](docs/adr/0003-bun-runtime-and-toolchain.md)).
- DuckDB uses the official Node-API addon again, downloaded on first use.
- The window stays hidden until the app has loaded, and the native title bar follows the chosen color mode.

## [0.4.0] - 2026-11-03

### Added

- SQLite connections.
- Microsoft Entra ID and Windows logins, and advanced connection options.
- DuckDB `VARIANT` and geometry values; support for older DuckDB versions.
- Releases are built on GitHub Actions; CI and Dependabot.

### Changed

- MCP clients cannot start an Entra browser login.
- Code is formatted with `deno fmt`, also in a pre-commit hook.

## [0.3.2] - 2026-11-03

### Added

- Links to the website and the privacy notice.

### Fixed

- Toggling fullscreen.
- Overscrolling of the page.

## [0.3.1] - 2026-11-03

### Changed

- The server dependencies are bundled, so the third-party license list is complete.

## [0.3.0] - 2026-10-30

### Added

- Search in the editor (⌘F), the schema tree and the result grid.
- Embedded databases that lock their file (DuckDB) offer to disconnect, so other processes can open them.
- Application menu bar.
- Saving and opening queries as files.
- Multiple cursors in the editor.
- English and German interface, with a manual language setting.
- The last tab's connection is restored after a restart; the window size is kept.

### Fixed

- Splitting scripts into statements in edge cases.
- Autocomplete overlapping other windows.

## [0.2.2] - 2026-10-28

### Added

- Switching the database of a connection.
- Fallbacks for older PostgreSQL and SQL Server versions.

## [0.2.1] - 2026-10-28

### Added

- Light and dark mode switch.
- Collapsible sidebar and responsive panels.

### Changed

- Run and execution plan share one button.

## [0.2.0] - 2026-10-27

### Added

- Indexes, routines and DDL in the schema tree, and a table context menu.
- Execution plan of the statement under the cursor.
- Open transactions per tab, with commit and rollback.
- Error positions marked in the editor.
- Query history of the last 50 queries.
- Color-coded connections and confirmation of writes on protected ones.
- Result filter, globally and per column; copying and showing single cell values.
- Renaming tabs; keyboard shortcuts for formatting, cancelling, duplicating and switching tabs.
- Open editor tabs are restored after a restart.

### Changed

- DuckDB is loaded through its C API instead of a Node-API addon (see [ADR 0001](docs/adr/0001-deno-packaging.md)).

## [0.1.1] - 2026-10-26

### Added

- First release: SQL editor for PostgreSQL, MySQL/MariaDB, Microsoft SQL Server and DuckDB (loaded on request), CSV
  and Parquet export, built-in MCP server and update notice.

[Unreleased]: https://github.com/dennishendricks/colwerk/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/dennishendricks/colwerk/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/dennishendricks/colwerk/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dennishendricks/colwerk/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/dennishendricks/colwerk/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/dennishendricks/colwerk/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/dennishendricks/colwerk/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/dennishendricks/colwerk/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/dennishendricks/colwerk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/dennishendricks/colwerk/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/dennishendricks/colwerk/releases/tag/v0.1.1
