---
title: Known limitations
description: Known limitations of Colwerk per engine and feature.
sidebar:
  order: 5
---

## Sessions and queries

- PostgreSQL, DuckDB and SQLite scripts commit each statement on its own, unless they start their own transaction.
- SQLite cannot interrupt a statement: cancelling ends the tab's session, which rolls back an open transaction and drops
  temporary tables. A long statement that returns no rows (an aggregate, a large `UPDATE`) still runs to its end in the
  background; outside a transaction its changes are committed.
- SQLite has no decimal or timestamp types: such values come back as stored (text or number).

## Read-only connections

PostgreSQL and MySQL restrict the session, and ClickHouse sends `readonly = 2`, but a session can switch that back. SQL
Server and lakehouses rely on Colwerk's check of the SQL text alone. For real protection, use a login with read
permissions only.

## Session monitor

SQL Server can only terminate sessions, ClickHouse can only cancel queries. Without `pg_read_all_stats`, `PROCESS` or
`VIEW SERVER STATE` only your own sessions are visible (MySQL: no lock relations either).

## Export

- INSERT exports write arrays, structs and maps as JSON text; such columns may need a cast.
- Excel holds at most 1,048,576 rows per sheet.

## Files connections

- Tables created in a files connection live in memory and are gone when Colwerk quits or its settings change.
- Excel `.xls` files cannot be read, only `.xlsx`.

## Geometries

SQL Server (`geometry`, `geography`) and SpatiaLite geometries use their own binary formats and are shown as hex;
DuckDB, PostGIS and MySQL/MariaDB geometries are shown as WKT.

## Compare

- Schema compare covers PostgreSQL 12+, MySQL/MariaDB and SQL Server, and not every kind of object (see
  [Schema compare](/docs/data/compare/#schema-compare)). Dropping a PostgreSQL view that other views depend on fails.
- Data compare covers PostgreSQL, MySQL/MariaDB, SQL Server, SQLite and DuckDB and rejects array, spatial and nested
  columns.
- MySQL sync scripts assume `NO_BACKSLASH_ESCAPES` is off.

## Import

Imports commit batch by batch; a stopped or cancelled import keeps the batches written before. Source and target in the
same SQLite file are not supported.

## Platforms

- macOS: Apple Silicon only.
- Linux: `.deb` packages only, without automatic updates.
