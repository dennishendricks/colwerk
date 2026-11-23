---
title: Export results
description: Save query results as CSV, Parquet, Excel, JSON, NDJSON, Markdown or SQL INSERT statements, including the full unlimited result.
sidebar:
  order: 4
---

The export bar below the result saves it to a file: choose the format, then **Save as …** (or **File → Save Result As
…**). Colwerk writes the file itself, straight to disk, so large exports never pass through the window. It writes to a
temporary file first and renames it at the end: a failed or cancelled export leaves an existing file untouched.
**Cancel** in the toolbar stops a running export.

## Shown rows or full result

When the result was cut at the [row limit](/docs/editor/running-queries/#row-limit-and-timeout), choose what to save:

- **Shown rows**: the rows already loaded.
- **Full result (without limit)**: Colwerk runs the statement again in the tab's session, without limit, and streams
  every row to the file. Only for read-only statements. In a script, this works for the statement of the shown
  result, but not when MySQL or SQL Server ran several statements as one batch.

The export writes the result as the query returned it, with all columns and in their original order. Sorting, filters
and hidden columns of the grid apply to **Copy as**, not to the file.

## Formats

| Format     | Details                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV        | Every field quoted, CRLF line endings, `NULL` as an empty field. Separator, quoting and encoding as set in the [settings](#csv-settings).   |
| Parquet    | Typed columns (boolean, integers, floating point, decimal, date, time, timestamp, UUID); a column with values that do not fit becomes text. |
| Excel      | One sheet with a frozen header; numbers, dates and times typed. Numbers with more than 15 digits stay text, so they keep every digit.       |
| JSON       | An array of objects.                                                                                                                        |
| NDJSON     | One object per line.                                                                                                                        |
| Markdown   | A table.                                                                                                                                    |
| SQL INSERT | `INSERT` statements in the dialect of the connection.                                                                                       |

### CSV settings

Open **Settings** (gear icon in the tab bar; in the desktop app **Colwerk → Settings …**) to choose how CSV is written.
The choice is kept in `settings.json` in the [data directory](/docs/reference/data-directory/) and applies to every CSV
export and to **Copy row as CSV** in the result grid.

| Setting         | Options                                                     | Default        |
| --------------- | ----------------------------------------------------------- | -------------- |
| Separator       | Semicolon `;`, comma `,`, tab, vertical bar `\|`            | Semicolon      |
| Quote character | Double `"` or single `'`                                    | Double         |
| Escaping        | Double the quote character (`""`) or backslash (`\"`, `\\`) | Double         |
| Encoding        | UTF-8 with BOM, UTF-8, UTF-16 LE (with BOM), Windows-1252   | UTF-8 with BOM |

With a backslash, backslashes in the values are doubled too. Windows-1252 covers Western European languages; other
characters, such as emoji, become `?`. Excel opens UTF-8 with BOM and UTF-16 LE without asking for the encoding.

### SQL INSERT

- **Target table**: defaults to the table the query reads, otherwise `export_table`. Up to three parts
  (`database.schema.table`).
- **Rows per INSERT**: default 100 (up to 10,000, on SQL Server up to 1,000).

Binary values become literals of the dialect. Arrays, structs and maps are written as JSON text; such columns may need a
cast when you load the file.

### Limits of Excel

An Excel sheet holds at most 1,048,576 rows and 16,384 columns, a cell at most 32,767 characters. Colwerk's Excel files
are limited to 4 GB. For larger results, export CSV or Parquet.

## Copy instead of saving

**Copy as** copies the result to the clipboard as Markdown, JSON or SQL INSERT, exactly as the grid shows it. Single
rows can be copied from their context menu (see [Result grid](/docs/data/result-grid/#copying)).
