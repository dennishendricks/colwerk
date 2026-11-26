---
title: SQLite viewer and browser for Mac, Windows and Linux
description: View a SQLite database in Colwerk, a free, open-source SQLite browser. Double-click the file, browse tables, edit rows and export to CSV or Excel.
---

Colwerk is a free, open-source SQLite viewer and SQL editor for macOS, Windows and Linux. Double-click a `.sqlite` or
`.sqlite3` file to open it, browse its tables in the schema tree and query them with SQL. It is MIT-licensed, runs
entirely on your computer and needs no account.

[Download Colwerk](/#download) or read the [SQLite connection settings](/docs/connections/databases/#sqlite).

## What you can do with SQLite in Colwerk

- **Open a database file** by double-clicking it, dropping it onto the window or with **File → Open …**. Colwerk
  creates a connection named after the file, or `:memory:` gives you a temporary database. See
  [Opening files directly](/docs/connections/databases/#opening-files-directly).
- **Browse tables, views, columns, keys and indexes** in the schema tree. Double-click a table to see its rows, or
  right-click it for **Show DDL**, **Count rows** and SQL templates. See [Schema tree](/docs/data/schema-tree/).
- **Sort, filter and inspect values** in the result grid, and copy rows as JSON, CSV, Markdown or SQL `INSERT`. See
  [Result grid](/docs/data/result-grid/).
- **Edit rows** of a table with a primary key directly in the grid, review the SQL and save it in one transaction. A
  dry run counts the rows an `UPDATE` or `DELETE` would change. See [Edit rows](/docs/data/editing/).
- **Write SQL** with autocomplete for tables, columns and joins along foreign keys, and warnings for unknown names.
  `EXPLAIN QUERY PLAN` shows how SQLite runs a query. See [The editor](/docs/editor/) and
  [Execution plans](/docs/editor/plans/).
- **Draw an ER diagram** from the foreign keys and save it as Mermaid or DBML. See [ER diagrams](/docs/data/er-diagrams/).
- **Export and import**: save a result as CSV, Excel, Parquet, JSON or SQL `INSERT`, and load CSV, Excel, JSON or
  Parquet files into a table. See [Export results](/docs/data/export/) and [Import data](/docs/data/import/).
- **Compare data** of a table between two SQLite databases and get a sync script. See
  [Schema and data compare](/docs/data/compare/#data-compare).

To look at a file without risk of changing it, mark the connection [read-only](/docs/connections/#read-only): Colwerk
then opens the file read-only. An AI assistant such as Claude, Codex, Cursor or VS Code can also read the database
through Colwerk's [MCP server](/docs/mcp/), in a session that cannot write.

## On Mac, Windows and Linux

### SQLite viewer for Mac

Colwerk runs natively on Macs with Apple Silicon and installs signed updates itself. Double-click a `.sqlite` or
`.sqlite3` file in the Finder to open it.

### SQLite viewer for Windows

On Windows (x64), Colwerk installs with a setup program and updates itself. It needs the WebView2 Runtime, which Windows
11 includes. Colwerk registers itself for `.sqlite` and `.sqlite3` files, so a double-click opens them.

### SQLite viewer for Linux

On Linux (x64 and arm64), Colwerk comes as a `.deb` package; the package manager installs WebKitGTK with it. New
versions are announced in the app and installed like any package. It is registered for `.sqlite` and `.sqlite3` files as
well.

See [Install and update](/docs/start/install/) for downloads and requirements.

## Who it is for

Anyone who needs to look into a SQLite file: app developers checking what their app stored, testers, analysts with a
database export, or people who received a `.sqlite` file and want to see what is in it. You can browse without writing
SQL and switch to the editor when you need a query.

## Limits

- SQLite cannot interrupt a running statement. **Cancel** ends the tab's session, which rolls back an open transaction
  and drops temporary tables. A long statement that returns no rows still runs to its end in the background.
- SQLite has no decimal or timestamp types, so such values come back as stored, as text or number.
- A script commits each statement on its own unless it starts a transaction with `BEGIN`.
- There is no session monitor and no schema compare for SQLite, and an import cannot use the same file as source and
  target.
- SpatiaLite geometries are shown as hex.
- macOS builds are for Apple Silicon only; Linux is available as `.deb` packages.

The full list is in [Known limitations](/docs/reference/limitations/).

## Questions

### How do I view a SQLite database on a Mac?

Install Colwerk and double-click the `.sqlite` or `.sqlite3` file, or drop it onto the Colwerk window. The tables appear
in the schema tree; double-click one to see its rows.

### Can I edit a SQLite database without writing SQL?

Yes, for tables with a primary key. Double-click the table, then change cells, add, clone or delete rows in the grid
and click **Save …**. Colwerk shows the SQL it will run before saving.

### Can I export a SQLite table to CSV or Excel?

Yes. Query the table, choose the format in the export bar and click **Save as …**. With **Full result (without limit)**
Colwerk writes every row, not only those shown.

## Get started

1. [Install Colwerk](/docs/start/install/) for macOS, Windows or Linux.
2. Follow the [first steps](/docs/start/first-steps/) to open a file and run a query.
3. Look up the [SQLite connection settings](/docs/connections/databases/#sqlite).
