---
title: MySQL GUI client for Windows, Mac and Linux
description: Colwerk is a free, open-source MySQL and MariaDB client for Windows, macOS and Linux, with autocomplete, EXPLAIN, grid editing, dry runs and schema compare.
---

Colwerk is a free, open-source MySQL and MariaDB client for Windows, macOS and Linux. It is a graphical SQL editor with
a schema tree, an editable result grid, execution plans, a session monitor and schema compare. It is MIT-licensed, runs
entirely on your computer and needs no account.

[Download Colwerk](/#download) or read the [MySQL and MariaDB connection settings](/docs/connections/databases/#mysql-and-mariadb).

## What you can do with MySQL in Colwerk

- **Connect** with host and port 3306, a Unix socket or, on Windows, a named pipe, with TLS and an SSH tunnel, or with
  Microsoft Entra logins for Azure. See [Databases](/docs/connections/databases/) and
  [SSH tunnel and TLS](/docs/connections/ssh-tls/).
- **Switch databases** with the database picker. MySQL has no schemas below the database, so the schema tree shows the
  tables directly, with approximate row counts from statistics instead of `COUNT(*)`. See
  [Schema tree](/docs/data/schema-tree/).
- **Run scripts with `DELIMITER`**, routine and trigger bodies: Colwerk splits them into statements the way the MySQL
  client does. See [Running queries](/docs/editor/running-queries/).
- **Write SQL with autocomplete** for tables, columns, aliases, functions and joins along foreign keys, with warnings for
  unknown names and `UPDATE` or `DELETE` without `WHERE`. See [The editor](/docs/editor/).
- **Read plans** with `EXPLAIN FORMAT=JSON` and `ANALYZE FORMAT=JSON`, and get a warning before a query reads a large
  table completely (access type `ALL`). See [Execution plans](/docs/editor/plans/) and
  [Guard rails](/docs/editor/safety/).
- **Edit rows in the grid** and save them in one transaction, or count the rows a statement would change with a dry
  run. See [Edit rows](/docs/data/editing/).
- **Watch sessions**, see who blocks whom, cancel queries and terminate sessions. See
  [Session monitor](/docs/data/session-monitor/).
- **Compare schemas and data** between two MySQL or MariaDB databases and get a deploy or sync script. See
  [Schema and data compare](/docs/data/compare/).

Results export to CSV, Parquet, Excel, JSON, Markdown or SQL `INSERT`, and the [import wizard](/docs/data/import/) loads
CSV, Excel, JSON or Parquet files into a table. MySQL and MariaDB geometries are shown as WKT. Through the built-in
[MCP server](/docs/mcp/), Claude, Codex, Cursor or VS Code can explore the database with read-only queries.

## Who it is for

Developers and administrators who want a desktop MySQL GUI instead of the `mysql` command line, for local databases,
Docker containers or managed databases such as Amazon RDS, Azure Database or Google Cloud SQL. If you use several
engines, the same window also connects to PostgreSQL, SQL Server, ClickHouse, DuckDB and SQLite.

## Limits

- A dry run refuses tables whose storage engine cannot roll back, such as MyISAM.
- A read-only connection runs `SET SESSION TRANSACTION READ ONLY`; temporary tables stay writable and a session can
  switch it off. For real protection, use a login with read permissions only.
- A schema deploy script cannot be rolled back on MySQL, because MySQL cannot roll back structure changes.
- Sync scripts assume that `NO_BACKSLASH_ESCAPES` is off.
- Without the `PROCESS` privilege, the session monitor shows only your own sessions and no lock relations.
- Windows needs the WebView2 Runtime and runs on x64. macOS builds are for Apple Silicon only; Linux is available as
  `.deb` packages.

The full list is in [Known limitations](/docs/reference/limitations/).

## Questions

### Is there a free MySQL client for Windows?

Yes. Colwerk is free and open source under the MIT license and has a Windows x64 installer. Windows 11 includes the
WebView2 Runtime it needs; most Windows 10 devices have it too.

### Does Colwerk work with MariaDB?

Yes. MySQL and MariaDB share one connection type, and editing, dry runs, the session monitor and schema and data
compare work for both.

### Is Colwerk a replacement for the mysql command-line client?

It is a graphical client: you write and run SQL in an editor and see the results in a grid. It splits scripts with
`DELIMITER` the way the MySQL client does, so scripts with routine and trigger bodies run as a whole.

## Get started

1. [Install Colwerk](/docs/start/install/) for Windows, macOS or Linux.
2. Follow the [first steps](/docs/start/first-steps/) to add a connection and run a query.
3. Look up the [MySQL and MariaDB connection settings](/docs/connections/databases/#mysql-and-mariadb) and the
   [setup for cloud databases](/docs/connections/common-setups/#postgresql-and-mysql-in-the-cloud).
