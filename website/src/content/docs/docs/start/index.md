---
title: Introduction
description: What Colwerk is, which databases it connects to and how the documentation is organized.
sidebar:
  order: 1
---

Colwerk is a free, open-source SQL editor and database client for macOS, Windows and Linux. It runs entirely on your
computer: there is no account, no telemetry and no cloud service in between.

## Databases

Colwerk connects to **PostgreSQL**, **MySQL and MariaDB**, **Microsoft SQL Server**, **ClickHouse**, **DuckDB** and
**SQLite**. Through DuckDB it also reads lakehouses: **Apache Iceberg** (REST catalog), **Delta Lake**, **Databricks
Unity Catalog** and **Microsoft Fabric OneLake**, and it queries CSV, Parquet, JSON and Excel files on disk, S3, Google
Cloud Storage or the web. The [feature matrix](/docs/reference/features/) shows what each engine supports.

## What sets it apart

- **One session per tab.** Every editor tab holds its own database connection, so transactions, temporary tables and
  `SET` options stay where you left them.
- **Gentle on the database.** Colwerk reads only up to the row limit, loads the schema tree on demand and takes table
  sizes from statistics instead of `COUNT(*)`.
- **Guard rails for production.** Color-coded and read-only connections, confirmation before writing statements, a
  stop for `UPDATE` and `DELETE` without `WHERE`, dry runs and a warning before full scans of large tables.
- **Bring your own AI.** Colwerk has no AI inside, but a built-in MCP server lets the assistant you already use explore
  schemas and run read-only queries. It hands its final query to a new tab, and you decide what runs.

## How this documentation is organized

- [Getting started](/docs/start/install/): install Colwerk and run your first query.
- [Connections](/docs/connections/): set up databases, lakehouses and files, SSH tunnels, TLS and password managers.
- [Writing SQL](/docs/editor/): the editor, running queries, transactions, guard rails and execution plans.
- [Working with data](/docs/data/schema-tree/): the schema tree, result grid, editing, export, import, compare, ER
  diagrams and the session monitor.
- [AI assistants (MCP)](/docs/mcp/): connect Claude, Codex or another MCP client.
- [Reference](/docs/reference/shortcuts/): keyboard shortcuts, feature matrix, data directory, security and known
  limitations.
