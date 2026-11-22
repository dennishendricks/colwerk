---
title: Edit rows
description: Change, add, clone and delete rows in Colwerk's result grid, review the SQL and save it in one transaction.
sidebar:
  order: 3
---

Colwerk can edit the result of a query in the grid. Nothing is written until you save, and you see the SQL before it
runs.

## When a result can be edited

- The engine is PostgreSQL, MySQL/MariaDB, SQL Server, DuckDB or SQLite (editing needs transactions).
- The connection is not read-only.
- The query is a `SELECT` from a single table, without joins, `DISTINCT`, `GROUP BY`, `UNION` and the like. `WHERE`,
  `ORDER BY` and `LIMIT` are fine.
- The table is not a view and has a primary key or a unique key on `NOT NULL` columns, and the result contains all key
  columns.

Otherwise the export bar shows **Read-only** with the reason in its tooltip.

Columns that are expressions, or of binary, geometry, array, nested, `hierarchyid`, `sql_variant` or `rowversion` type,
cannot be edited.

## Changing values

Double-click a cell, or choose **Edit value …** in its context menu. The editor fits the column: a true/false choice
for booleans, a date picker for dates, a text area for long text and JSON (⌘Enter applies). **NULL** and **DEFAULT**
set those values; both are also in the context menu. `DEFAULT` on an existing row works on PostgreSQL, MySQL and SQL
Server.

## Adding and deleting rows

- **Add row** in the footer adds a row with `DEFAULT` in every column.
- **Clone row** copies a row; its key columns are set to `DEFAULT`, so identity columns get new values.
- **Delete row** marks a row for deletion.
- **Undo changes to row** reverts one row; **Discard** reverts all.

Changed cells are yellow, new rows green, deleted rows red and struck through.

## Saving

**Save …** shows the statements that will run: first the `DELETE`s, then the `UPDATE`s, then the `INSERT`s. Rows are
identified by their key with the values loaded. On a connection with **Confirm writing statements**, the dialog says so
and the button is red.

All statements run in one transaction, in a session of their own (not the tab's). If one of them changes no row,
because someone else changed or deleted it meanwhile, everything is rolled back and nothing is saved. After saving,
the query runs again.
