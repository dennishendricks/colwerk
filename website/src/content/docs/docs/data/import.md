---
title: Import data
description: Load CSV, TSV, JSON, NDJSON, Excel and Parquet files or a table of another connection into a new or existing table.
sidebar:
  order: 5
---

The import wizard loads a file, or a table or query of another connection, into a table. Open it with **File → Import
Data …**, the import button in the schema tree header, or a table's context menu: **Import data …** (into this table)
or **Copy to connection …** (from this table).

## 1. Source

- **File**: a local file. Supported: CSV, TSV (`.tsv`, `.tab`), JSON, NDJSON (`.ndjson`, `.jsonl`), Excel (`.xlsx`) and
  Parquet; text formats may be compressed with `.gz` or `.zst`. Files are read with the included DuckDB.
- **Table or query of a connection**: a table, or a single read-only `SELECT` or `WITH` query. A table keeps its
  declared column types.

## 2. Target and mapping

The preview shows the first 20 rows. Choose the **target connection**: PostgreSQL, MySQL/MariaDB, SQL Server,
ClickHouse, DuckDB or SQLite, not read-only.

- **Existing table**: map each source column to a target column, or skip it. Columns with the same name (ignoring case)
  are matched automatically.
- **New table**: enter schema and table name (the file name by default). For each column choose whether to import it,
  its name, its type and whether it belongs to the primary key. Colwerk translates the source types to the target
  dialect and shows the `CREATE TABLE` statement it will run, so you can check it first. ClickHouse tables are created
  as `MergeTree`, ordered by the key.

## 3. Load

| Strategy            | What happens                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Append              | Adds the rows to the table.                                                                                                                                           |
| Truncate and reload | Deletes all rows of the table first.                                                                                                                                  |
| Upsert              | Updates rows whose key columns match and inserts the others. Needs a primary key or unique constraint; not available for ClickHouse. MySQL matches on any unique key. |

A new table is always appended to.

- **Rows per batch**: default 500 (up to 10,000, on SQL Server up to 1,000). Each batch is written in its own
  transaction; on ClickHouse, which has no transactions, each batch is one insert.
- **On errors**: **Stop** (the failed batch is rolled back) or **Skip failed rows** (the failed batch is retried row by
  row, and the rows that fail are counted).

If the target connection asks before writing statements, or you chose truncate, Colwerk shows what it will run and asks
before starting.

## Progress

The wizard shows rows read, inserted, updated and failed. **Cancel** stops the import; batches written before are kept.
At the end, **Query target table** opens the result in a new tab.

:::note
The import commits batch by batch, so a stopped import leaves the batches written so far. Source and target in the same
SQLite file are not supported.
:::
