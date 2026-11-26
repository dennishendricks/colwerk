---
title: DuckDB GUI client for Mac, Windows and Linux
description: Colwerk is a free, open-source DuckDB GUI for the desktop. Open .duckdb files with a double-click, query Parquet, CSV and lakehouses, edit rows and export results.
---

Colwerk is a free, open-source DuckDB GUI for macOS, Windows and Linux. It opens `.duckdb` files with a double-click,
queries Parquet, CSV, JSON and Excel files and lakehouses with DuckDB's SQL, and runs entirely on your computer. Colwerk
started as a desktop client for DuckDB, and DuckDB still powers its files, lakehouse and import features.

[Download Colwerk](/#download) or read the [DuckDB connection settings](/docs/connections/databases/#duckdb).

## What you can do with DuckDB in Colwerk

- **Open a database file directly**: double-click a `.duckdb` file, drop it onto the window or use **File → Open …**.
  Colwerk selects the existing connection to that file or creates one. Leave the path empty or use `:memory:` for an
  in-memory database shared by the connection's tabs. See [Databases](/docs/connections/databases/#opening-files-directly).
- **Start without setup**: DuckDB's native library is part of Colwerk, so nothing needs to be installed. DuckDB adds
  the extensions for Excel, HTTP, S3 and the lakehouse formats itself on first use. See
  [The DuckDB driver](/docs/connections/databases/#the-duckdb-driver).
- **Query data files with SQL**: drop CSV, TSV, Parquet, JSON, NDJSON or Excel files onto the window, or query a URL on
  S3, Google Cloud Storage or the web. Each file becomes a view you can join with others. See
  [Files and URLs](/docs/connections/files/) and the [Parquet viewer](/parquet-viewer/).
- **Read lakehouses**: Apache Iceberg, Delta Lake, Databricks Unity Catalog and Microsoft Fabric OneLake, queried with
  DuckDB's SQL. See [Lakehouses](/docs/connections/lakehouses/).
- **Write SQL with autocomplete** and formatting, and read plans with `EXPLAIN` and `EXPLAIN ANALYZE`. See
  [The editor](/docs/editor/) and [Execution plans](/docs/editor/plans/).
- **Edit rows in the grid**, check an `UPDATE` or `DELETE` with a dry run first and save all changes in one
  transaction. See [Edit rows](/docs/data/editing/) and [Guard rails](/docs/editor/safety/).
- **Move data in and out**: import CSV, JSON, Excel or Parquet files and tables of other connections into DuckDB, and
  export results to Parquet, CSV, Excel, JSON or SQL `INSERT`. See [Import data](/docs/data/import/) and
  [Export results](/docs/data/export/).
- **Compare data** of a table between two connections and get a sync script. See
  [Schema and data compare](/docs/data/compare/).

An AI assistant such as Claude, Codex or Cursor can explore a DuckDB database through Colwerk's
[MCP server](/docs/mcp/). By default it opens the file read-only, in a DuckDB instance of its own that cannot read
files or URLs.

## On Mac, Windows and Linux

### DuckDB GUI for Mac

Colwerk runs natively on Macs with Apple Silicon and installs signed updates itself. Double-click a `.duckdb` file in
the Finder to open it; DuckDB is included.

### DuckDB GUI for Windows

On Windows (x64), Colwerk installs with a setup program and updates itself. It needs the WebView2 Runtime, which Windows
11 includes. Colwerk registers itself for `.duckdb` files, so a double-click opens them.

### DuckDB GUI for Linux

On Linux (x64 and arm64), Colwerk comes as a `.deb` package; the package manager installs WebKitGTK with it. New
versions are announced in the app and installed like any package. It is registered for `.duckdb` files as well.

See [Install and update](/docs/start/install/) for downloads and requirements.

## Who it is for

Data engineers and analysts who use DuckDB for local analytics and want a desktop client instead of the command line:
to look into a `.duckdb` file, check a Parquet export, join a CSV with a table or read an Iceberg table without setting
up a server.

## Limits

- DuckDB locks its file while it is open. **Disconnect** releases it for other programs.
- A script commits each statement on its own unless it starts its own transaction.
- Files created with DuckDB 2 cannot be opened by DuckDB 1.x. When Colwerk creates a new file, **Create a new file
  compatible with DuckDB 1.x** (More options) keeps it readable for older tools.
- Tables created in a files connection live in memory and are gone when Colwerk quits.
- DuckDB has no session monitor or schema compare in Colwerk. Excel `.xls` files cannot be read, only `.xlsx`.

The full list is in [Known limitations](/docs/reference/limitations/).

## Questions

### Is there a desktop GUI for DuckDB?

Yes. Colwerk is a free, open-source desktop client for DuckDB on macOS (Apple Silicon), Windows (x64) and Linux (x64
and arm64). It includes DuckDB, so you only install Colwerk.

### How do I open a .duckdb file?

Double-click it or drop it onto the Colwerk window. Colwerk creates a connection named after the file, and you can
browse its schemas and tables in the sidebar.

### Can I query Parquet and CSV files with DuckDB in a GUI?

Yes. Drop the files onto the window: each becomes a view in an in-memory DuckDB database, and its rows appear right
away. You can join files with each other with SQL.

## Get started

1. [Install Colwerk](/docs/start/install/) for macOS, Windows or Linux.
2. Follow the [first steps](/docs/start/first-steps/) to add a connection and run a query.
3. Look up the [DuckDB connection settings](/docs/connections/databases/#duckdb) and
   [Files and URLs](/docs/connections/files/).
