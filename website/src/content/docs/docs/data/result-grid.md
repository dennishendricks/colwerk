---
title: Result grid
description: Sort, filter, pin, hide and resize columns, inspect values, copy rows and compare results in Colwerk's result grid.
sidebar:
  order: 2
---

Results appear in a grid below the editor. The status line shows the number of rows, the duration, and whether the
result was cut at the row limit.

## Columns

Click a column name for its menu:

- **Sort ascending / descending**, **Clear sorting**. Numbers stored as text (`BIGINT`, `DECIMAL`) sort as numbers,
  other text in natural order ("2" before "10"); `NULL` always goes last.
- **Pin left / right**, **Unpin**.
- **Filter …**: only rows whose column contains the text.
- **Hide**. The button in the `#` header shows and hides columns.

Drag the edge of a header to resize a column; double-click it to reset. Sorting, filters and layout are reset when a new
result arrives.

## Filter

**Filter result …** in the status bar (⌘F while the result has focus) keeps the rows that contain the text in any
visible column, ignoring case.

## Values

| Value                                | Shown as                |
| ------------------------------------ | ----------------------- |
| `NULL`                               | _NULL_, in italics      |
| `BIGINT`, `DECIMAL`                  | exact, as text          |
| dates and timestamps                 | ISO 8601                |
| binary                               | hex, starting with `0x` |
| JSON, arrays, structs                | JSON                    |
| PostGIS, MySQL, DuckDB geometries    | WKT                     |
| SQL Server and SpatiaLite geometries | hex                     |

Long text is shortened in the cell. Double-click a cell (or **Show value …** in the context menu) to see the full value,
with JSON formatted, and copy it.

## Copying

Right-click a row: **Copy value**, **Copy row as JSON**, **CSV**, **Markdown** or **SQL INSERT**. CSV uses the separator
and quoting of the [CSV settings](/docs/data/export/#csv-settings).

**Copy as** in the export bar copies the whole result as Markdown, JSON or SQL INSERT, exactly as the grid shows it:
visible columns in their order, rows sorted and filtered.

## Several results and pinned results

A script that returns several results shows **Result 1**, **Result 2** … in the status bar.

**Pin result** keeps the current result in the tab while you run other queries. Click a pin to look at it again, or
**Compare** to see it next to the current result, with a common filter. Pinned results can be exported and copied, but
not edited; they are not kept when Colwerk quits.

## Editing

If the result comes from a single table with a key, you can edit it directly in the grid. See
[Edit rows](/docs/data/editing/).
