---
title: Guard rails
description: Write confirmation, the stop for UPDATE and DELETE without WHERE, dry runs and the plan check in Colwerk.
sidebar:
  order: 4
---

Colwerk offers several checks against expensive or unintended statements. Most are set per connection in the
[connection dialog](/docs/connections/#guard-rails); the [read-only](/docs/connections/#read-only) setting is there too.

## Confirm writing statements

With **Confirm writing statements** on, Colwerk asks "Run writing statement?" before a statement that may change data
or structures, and shows the SQL. Choose **Run**, **Cancel** or, where available, **Dry run**. The check reads the SQL
text: it is a safety net, not a permission system.

## UPDATE and DELETE without WHERE

With **Stop UPDATE and DELETE without WHERE** on, Colwerk asks "Change every row?" before `UPDATE` or `DELETE` without
`WHERE`, and before `TRUNCATE`. A join counts as a filter. Writes inside a CTE are not detected.

Independent of this setting, the editor underlines such statements while you type (see [Checks](/docs/editor/#checks)).

## Dry run

A dry run tells you how many rows an `INSERT`, `UPDATE`, `DELETE` or `MERGE` would change, without changing them.
Choose **Dry run** in the menu next to **Run**, or in the write confirmation.

Colwerk runs the statement in a separate session inside a transaction and rolls it back. The tab's own transaction is
untouched, but its temporary tables and `SET` options are not visible there.

- Available for PostgreSQL, MySQL/MariaDB, SQL Server, DuckDB and SQLite, not on read-only connections.
- Exactly one statement, also behind `WITH`.
- MySQL refuses tables whose engine cannot roll back (e.g. MyISAM).

:::caution
Triggers and sequences may still have side effects, and locks are held until the rollback.
:::

## Plan check

With **Warn before full scans of large tables** on, Colwerk runs `EXPLAIN` (never `ANALYZE`) before each query and asks
"Expensive query?" when the plan reads a large table completely. The dialog lists the tables with their approximate
row counts; choose **Run anyway**, **Show plan** or **Cancel**.

| Engine     | Counts as full scan                          | Rows from        |
| ---------- | -------------------------------------------- | ---------------- |
| PostgreSQL | Seq Scan                                     | table statistics |
| MySQL      | access type `ALL`                            | the plan         |
| SQL Server | Table Scan, Clustered Index Scan, Index Scan | table statistics |
| ClickHouse | `EXPLAIN ESTIMATE`                           | the plan         |

The **Row threshold** (default 1,000,000) decides what is large. Colwerk checks the first ten statements of a script;
if an `EXPLAIN` fails or takes longer than 10 seconds, it is skipped.
