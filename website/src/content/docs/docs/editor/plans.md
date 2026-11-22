---
title: Execution plans
description: Show estimated and actual execution plans, including graphical SQL Server plans and .sqlplan files.
sidebar:
  order: 5
---

Press ⌘E in the editor (or **Query → Execution Plan**) to show the estimated plan of the statement under the cursor.
The menu next to **Run** offers **Plan** (estimated) and **Analyze** (actual).

**Analyze** runs the statement to measure it, so it is only offered for read-only statements. Plans work for one
statement at a time.

| Engine     | Plan                     | Analyze                      |
| ---------- | ------------------------ | ---------------------------- |
| PostgreSQL | `EXPLAIN`                | `EXPLAIN (ANALYZE, BUFFERS)` |
| MySQL      | `EXPLAIN FORMAT=JSON`    | `ANALYZE FORMAT=JSON`        |
| SQL Server | graphical (Showplan XML) | graphical, with actual rows  |
| DuckDB     | `EXPLAIN`                | `EXPLAIN ANALYZE`            |
| SQLite     | `EXPLAIN QUERY PLAN`     | –                            |
| ClickHouse | `EXPLAIN indexes = 1`    | –                            |

Text plans appear in the result area with a **Copy** button.

## SQL Server plans

SQL Server plans are shown as a tree of operators. Per statement you see the SQL, the estimated cost and whether the
plan is estimated or actual. The operator table shows object, cost (as a bar, high costs highlighted), estimated and
actual rows (highlighted when they differ by a factor of ten or more) and subtree cost; operators can be collapsed.
Warnings and **missing indexes** are listed above, the latter with a `CREATE INDEX` statement you can copy.

## .sqlplan files

Open a `.sqlplan` file saved by SQL Server Management Studio by double-clicking it, dropping it onto the window or with
**File → Open …**. It opens in a new tab with the plan's statements as SQL and the graphical plan below.
