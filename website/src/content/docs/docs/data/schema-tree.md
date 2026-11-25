---
title: Schema tree
description: Browse schemas, tables, columns, keys, indexes and functions in Colwerk's schema tree, and generate SQL from it.
sidebar:
  order: 1
---

The schema tree in the sidebar shows the selected connection and database. It loads on demand: a schema's tables load
when you open it, a table's columns when you open the table.

## What it shows

- **Schemas**, without system schemas (`pg_*`, `information_schema`, `mysql`, `sys`, `performance_schema`, ClickHouse
  `system`). MySQL shows the tables of the database directly.
- **Tables and views** with their approximate row count from statistics (no `COUNT(*)`), and a **PART** badge for
  partitioned tables. The tooltip shows comment, partitioning and clustering.
- **Columns** with type and `not null`; primary key columns in bold. Badges mark the primary key (**PK**), foreign keys
  (**FK →** target table) and indexed columns (**IDX**).
- **Indexes** of a table with their columns, primary and unique indexes marked.
- **Functions** and procedures of a schema.

**Reload** in the header clears the cache. :kbd[meta+F] in the tree searches the objects that are loaded so far and opens the
branches with hits.

## Double-click

Double-clicking a table writes a `SELECT` of all its columns and runs it with the tab's row limit, in the current tab if
it is idle and uses the same connection, otherwise in a new one.

## Context menu

Right-click a table or view:

- **Query**, **Query in new tab**, **Count rows**
- **Generate SQL**: `SELECT`, `INSERT`, `UPDATE` and `DELETE` templates in a new tab, not run. Views and read-only
  connections offer `SELECT` only. `SELECT` has `limit 100` (SQL Server `top 100`); parameters use the engine's style
  (`$1`, `?`, `@p1`, `{p1:String}`), and `UPDATE` and `DELETE` match on the primary key, or all columns without one.
- **Show DDL** in a new tab
- **Import data …** into the table, **Copy to connection …** from it (see [Import data](/docs/data/import/))
- **ER diagram** of the table and its neighbors (see [ER diagrams](/docs/data/er-diagrams/))
- **Copy name**, **Copy qualified name**, **Reload**

Schemas offer **ER diagram** and **Copy name**; functions and procedures **Show DDL** and **Copy name**.
