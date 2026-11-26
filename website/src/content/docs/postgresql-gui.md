---
title: PostgreSQL GUI client for Mac, Windows and Linux
description: Colwerk is a free, open-source PostgreSQL client with autocomplete along foreign keys, EXPLAIN ANALYZE, a session monitor, schema compare and grid editing.
---

Colwerk is a free, open-source PostgreSQL client for macOS, Windows and Linux. It combines a SQL editor with a schema
tree, a result grid you can edit, execution plans, a session monitor and schema compare. It is MIT-licensed, runs
entirely on your computer and needs no account.

[Download Colwerk](/#download) or read the [PostgreSQL connection settings](/docs/connections/databases/#postgresql).

## What you can do with PostgreSQL in Colwerk

- **Connect the way your server expects**: host and port 5432, a Unix socket, a `search_path`, TLS with a CA
  certificate, an SSH tunnel, or Microsoft Entra logins for Azure. See [Databases](/docs/connections/databases/) and
  [SSH tunnel and TLS](/docs/connections/ssh-tls/).
- **Import existing connections** from a `.pgpass` file, DBeaver, Beekeeper Studio, Azure Data Studio or dbt
  `profiles.yml`. See [Import connections](/docs/connections/import/).
- **Write SQL with autocomplete** for tables, columns, aliases and functions. After `JOIN` it suggests linked tables
  with the complete `ON` clause, and it underlines unknown tables and columns. See [The editor](/docs/editor/).
- **Run scripts** that use dollar quoting and function bodies: Colwerk splits them the way `psql` does, and each tab
  keeps its own session with its transactions and temporary tables. See
  [Running queries](/docs/editor/running-queries/) and [Sessions and transactions](/docs/editor/transactions/).
- **Read execution plans** with `EXPLAIN` or `EXPLAIN (ANALYZE, BUFFERS)`, and get a warning before a query does a
  `Seq Scan` on a large table. See [Execution plans](/docs/editor/plans/) and [Guard rails](/docs/editor/safety/).
- **Edit rows in the grid** of a single-table result with a key, review the generated SQL and save it in one
  transaction. A dry run counts the rows an `UPDATE` or `DELETE` would change. See [Edit rows](/docs/data/editing/).
- **Watch sessions and blocking chains**, cancel a query or terminate a session. See
  [Session monitor](/docs/data/session-monitor/).
- **Compare schemas and data** between two PostgreSQL databases and get a deploy or sync script that you run yourself.
  See [Schema and data compare](/docs/data/compare/).

ER diagrams, export to CSV, Parquet, Excel or SQL `INSERT`, and PostGIS geometries shown as WKT work as well. An AI
assistant such as Claude, Codex, Cursor or VS Code can explore the database through Colwerk's
[MCP server](/docs/mcp/) with read-only queries.

## Who it is for

Developers, data analysts and database administrators who work with PostgreSQL on their own machine, in Docker or in
the cloud (Amazon RDS, Azure Database, Google Cloud SQL). Color-coded and [read-only](/docs/connections/#read-only)
connections and a confirmation before writing statements help when you also connect to production.

## Limits

- A PostgreSQL script commits each statement on its own unless it starts its own transaction with `BEGIN`.
- A read-only connection sets `default_transaction_read_only`, which a session can switch off with `SET`. For real
  protection, use a login with read permissions only.
- Schema compare needs PostgreSQL 12 or newer and leaves out sequences other than serial and identity, routines,
  triggers, types, comments, grants and materialized views.
- Without `pg_read_all_stats`, the session monitor shows only your own sessions.
- macOS builds are for Apple Silicon only; Linux is available as `.deb` packages.

The full list is in [Known limitations](/docs/reference/limitations/).

## Questions

### Is there a free PostgreSQL GUI for Mac?

Yes. Colwerk is free and open source under the MIT license and runs on Macs with Apple Silicon. It also runs on Windows
(x64) and Linux (x64 and arm64).

### Can I use my .pgpass file with a PostgreSQL client?

Colwerk imports a `.pgpass` file: every line becomes a PostgreSQL connection named `user@host:port/db`. Lines with a `*`
host are skipped.

### Does Colwerk support EXPLAIN ANALYZE for Postgres?

Yes. **Plan** runs `EXPLAIN`, and **Analyze** runs `EXPLAIN (ANALYZE, BUFFERS)` for read-only statements. The plan
appears in the result area with a **Copy** button.

## Get started

1. [Install Colwerk](/docs/start/install/) for macOS, Windows or Linux.
2. Follow the [first steps](/docs/start/first-steps/) to add a connection and run a query.
3. Look up the [PostgreSQL connection settings](/docs/connections/databases/#postgresql) and the
   [setup for cloud databases](/docs/connections/common-setups/#postgresql-and-mysql-in-the-cloud).
