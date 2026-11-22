---
title: Schema and data compare
description: Compare two schemas or one table across two connections, and get a deploy or sync script that you run yourself.
sidebar:
  order: 6
---

**Compare** in the tab bar compares two schemas, or one table across two connections, of the same database engine.
Nothing runs automatically: Colwerk writes a script that you can copy or open in a new tab.

Choose connection, database and schema for **Source** and **Target**; for a data compare also the table.

## Schema compare

Available for PostgreSQL 12+, MySQL/MariaDB and SQL Server.

**Compared**: tables, columns (type, nullability, default, identity, generated), primary key, unique, check and
foreign key constraints, indexes and views.

**Not compared**: sequences other than serial and identity, routines, triggers, types and enums, comments, grants,
partitioning, table options, materialized views and the order of columns. Objects Colwerk cannot compare, such as
functional indexes, are listed as such.

Filter the result by differences, objects only in source or target, different or identical objects. Expand an object to
see which columns, constraints and indexes differ, and the `CREATE` statements of both sides next to each other.

### Deploy script

The **Deploy script** brings the target to the state of the source. It drops what is only in the target (including
tables!), creates what is only in the source and changes what differs, in an order that respects foreign keys and views.
On PostgreSQL it runs in a transaction, on SQL Server in a transaction with `GO` batches; MySQL cannot roll back
structure changes. **Open in new tab** opens it on the target connection.

:::caution
Read the deploy script before running it: tables that only exist in the target are dropped.
:::

## Data compare

Available for PostgreSQL, MySQL/MariaDB, SQL Server, SQLite and DuckDB, one table at a time.

- **Key columns**: default the source's primary key. The key must be unique and contain no `NULL`.
- Only columns present on both sides are compared; generated and computed columns are left out.
- Arrays, geometries, XML and nested types cannot be compared.

Colwerk reads both tables sorted by key and merges them, so even large tables need little memory. The result counts
identical rows, rows only in source or target, and different rows, with up to 1000 samples each; for different rows it
names the changed columns.

### Sync script

The **Sync script** makes the target's rows equal to the source's: `DELETE` for rows only in the target, `UPDATE` of the
changed columns, `INSERT` for rows only in the source, in a transaction. Identity columns are handled (PostgreSQL
`OVERRIDING SYSTEM VALUE`, SQL Server `IDENTITY_INSERT`). A script with more than 10,000 statements is not shown but
saved to a file with **Save script …**.

MySQL sync scripts assume that `NO_BACKSLASH_ESCAPES` is off (the default).
