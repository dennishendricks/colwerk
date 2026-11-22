---
title: Manage connections
description: Create, organize, color-code and protect database connections in Colwerk.
sidebar:
  order: 1
---

Connections are listed at the top of the sidebar. **New** creates one, **Import** takes them over from
[other tools](/docs/connections/import/), and the pencil button that appears on hover edits one. The same actions are
in the **File** menu.

## The connection dialog

Every connection has a **Name**, an optional **Folder** and a **Database system**. The other fields depend on the
engine:

- [Databases](/docs/connections/databases/): PostgreSQL, MySQL/MariaDB, SQL Server, ClickHouse, DuckDB and SQLite.
- [Lakehouses](/docs/connections/lakehouses/): Iceberg, Delta Lake, Unity Catalog and OneLake.
- [Files and URLs](/docs/connections/files/): CSV, Parquet, JSON and Excel through DuckDB.

Less common settings are under **More options**, which opens by itself when a saved connection uses any of them:
[SSH tunnel and TLS](/docs/connections/ssh-tls/), engine-specific options, the
[MCP login](/docs/mcp/#a-login-of-its-own), the [color](#color) and the [guard rails](#guard-rails).

**Test** tries to connect with the values in the dialog; **Save** (or Enter) stores the connection. Passwords are
stored encrypted, or read from a [password manager](/docs/connections/passwords/) on every connect. When you edit a
connection, an empty password field keeps the stored password; a switch below it removes it.

**Delete** removes the connection at once, without asking.

### Folders

Type a folder name to group connections; existing folders are suggested. Folders have one level, are listed before
connections without a folder and can be collapsed. Leave the field empty for the top level.

## Color

Give a connection a color, for example red for production. It marks the connection in the list, its tabs and the
toolbar of every tab that uses it. Choices: none, red, orange, yellow, green, blue and purple.

## Guard rails

These settings are at the end of **More options**. They protect against mistakes, not against a determined user: for real
protection, use a database login with the permissions it needs and no more.

### Read-only

Colwerk refuses any script that may change data or structures, before anything runs, and the toolbar shows a
**Read-only** badge. Where the database supports it, Colwerk also restricts the session:

| Engine     | What read-only does                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------- |
| PostgreSQL | Sets `default_transaction_read_only`. A session can switch it off again with `SET`.               |
| MySQL      | `SET SESSION TRANSACTION READ ONLY`. Temporary tables stay writable; a session can switch it off. |
| SQL Server | No read-only session exists: Colwerk checks the SQL text only.                                    |
| ClickHouse | Sends `readonly = 2` with every request (reading and changing settings only).                     |
| DuckDB     | Opens the database file read-only. In-memory databases: SQL text check only.                      |
| SQLite     | Opens the database file read-only.                                                                |
| Lakehouses | SQL text check only. Use catalog credentials with read access for real protection.                |

Read-only connections show a lock in the connection list. Editing rows in the grid, dry runs and data imports into them
are not available.

### Confirm writing statements

Asks before running a statement that may change data or structures, shows the SQL and offers a
[dry run](/docs/editor/safety/#dry-run) where available. Scripts are checked statement by statement, so a script of
only `SELECT`s runs without asking. Off by default.

### Stop UPDATE and DELETE without WHERE

Runs `UPDATE` and `DELETE` without `WHERE`, and `TRUNCATE`, only after an explicit confirmation. On by default when
writing statements are confirmed.

### Warn before full scans of large tables

Runs `EXPLAIN` (never `ANALYZE`) before each query and warns when the plan reads a large table completely. The **Row
threshold** sets what counts as large (default 1,000,000 rows, by table statistics). Available for PostgreSQL,
MySQL/MariaDB, SQL Server and ClickHouse; on by default when writing statements are confirmed. See
[Guard rails](/docs/editor/safety/#plan-check).

## Connecting and disconnecting

Colwerk opens database sessions when they are needed: one per editor tab, plus one per connection and database for the
schema tree. There is no separate connect step for server databases.

DuckDB locks its database file while it is open. A DuckDB connection therefore has a **Disconnect** button in the
sidebar (and **File → Disconnect**), which closes all its sessions and releases the file for other programs. Open
transactions in its tabs are rolled back; Colwerk asks first.

## Choosing the database

For engines with several databases (PostgreSQL, MySQL/MariaDB, SQL Server, ClickHouse, and the catalogs of Unity
Catalog and the lakehouses of OneLake), the picker below the connection list selects the database of the schema tree
and of new tabs. The database entered in the connection is the default. Each tab can switch connection and database in
its toolbar; with an open transaction, Colwerk asks first, because switching rolls it back.
