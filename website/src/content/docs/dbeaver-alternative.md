---
title: A free, open-source DBeaver alternative
description: Colwerk is a free, MIT-licensed DBeaver alternative for Mac, Windows and Linux, with a built-in MCP server, no telemetry and import of DBeaver connections.
---

Colwerk is a free, open-source SQL client for macOS, Windows and Linux, released under the MIT license. Compared with
DBeaver Community, it supports fewer database engines, has a built-in MCP server for AI assistants in the free app,
queries files and lakehouses through the included DuckDB and collects no usage statistics. Colwerk imports DBeaver connections, including their passwords.

[Download Colwerk](/#download) · [Import connections](/docs/connections/import/)

## Colwerk and DBeaver Community compared

Compared versions: **Colwerk 0.9.2** and **DBeaver Community 26.2.5.2** (released 24 November 2026), as of November
2026, based on the public documentation of both products (see [Sources](#sources)). Later versions may differ.

|                              | Colwerk                                                                                                                                          | DBeaver Community                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| License                      | MIT                                                                                                                                              | Apache License 2.0 [1]                                                                             |
| Price                        | Free                                                                                                                                             | Free; PRO editions from $113 per year [2]                                                          |
| Technology                   | Desktop app with the system's web view and a local server                                                                                        | Java; the Windows and macOS installers include OpenJDK [3]                                         |
| Platforms                    | macOS (Apple Silicon), Windows x64, Linux x64 and arm64 (`.deb`)                                                                                 | Windows 10+, macOS 11+, most Linux distributions [3]                                               |
| Engines in the free edition  | PostgreSQL, MySQL/MariaDB, SQL Server, ClickHouse, DuckDB, SQLite; Iceberg, Delta Lake, Unity Catalog, Fabric OneLake; CSV, Parquet, JSON, Excel | Databases with a JDBC driver, including PostgreSQL, MySQL, MariaDB, SQL Server, SQLite, DuckDB [1] |
| MCP server for AI assistants | Built in                                                                                                                                         | Lite, Enterprise and Ultimate editions only [4]                                                    |
| Built-in AI                  | None; your own assistant connects through MCP                                                                                                    | AI chat; in Community with OpenAI or GitHub Copilot [5]                                            |
| What the AI receives         | Schemas, sample rows and read-only query results, with personal data masked by default                                                           | Table and column names of the current schema, after a confirmation per connection [5]              |
| Usage statistics             | None                                                                                                                                             | UI actions, database types, anonymized OS and locale; can be turned off in the preferences [6]     |

## What Colwerk offers

This list describes Colwerk; some of these features exist in DBeaver in another form.

- **MCP server in the free app.** Claude, Codex, Cursor, VS Code and other MCP clients can browse schemas and run
  read-only queries in a transaction that is rolled back. A query the assistant suggests opens in a new tab and is not
  run ([Connect an AI assistant](/docs/mcp/)). ChatGPT only accepts MCP servers on the internet, not local ones.
- **Masking of personal data** in exports and in answers to assistants ([Mask personal data](/docs/data/masking/)).
- **Files and lakehouses.** Query CSV, Parquet, JSON and Excel files, Delta Lake, Apache Iceberg, Databricks Unity
  Catalog and Microsoft Fabric OneLake through the included DuckDB ([Files and URLs](/docs/connections/files/),
  [Lakehouses](/docs/connections/lakehouses/)).
- **One session per tab**, guard rails such as dry runs and a stop for `UPDATE` without `WHERE`
  ([Guard rails](/docs/editor/safety/)), and graphical SQL Server plans ([Execution plans](/docs/editor/plans/)).
- **Schema and data compare** with a script you run yourself ([Schema and data compare](/docs/data/compare/)).
- **No telemetry, no account** ([Security and privacy](/docs/reference/security/)).

## Where DBeaver is the better choice

- **Engine breadth.** DBeaver Community works with any database that has a JDBC driver, such as Oracle, Snowflake or
  Redshift [1]; the PRO editions add NoSQL and big data databases [2]. Colwerk supports six engines plus lakehouses and
  files ([Feature matrix](/docs/reference/features/)).
- **ER diagrams.** DBeaver can combine tables from different connections in custom diagrams [7]; the Enterprise,
  Ultimate and Team editions add an edit mode [2]. Colwerk's [ER diagrams](/docs/data/er-diagrams/) are read-only.
- **Data transfer.** DBeaver transfers data between tables of the same or different databases and exports and imports
  many formats [8].
- **Connection import.** DBeaver imports connections from DbVisualizer, MySQL Workbench, DataGrip, Navicat, Oracle SQL
  Developer, pgAdmin 4, SQuirreL SQL and Toad [9]. Colwerk imports from DBeaver, Beekeeper Studio, Azure Data Studio,
  `.pgpass` and dbt.
- **Intel Macs.** Colwerk runs on Apple Silicon only.

## Switch from DBeaver

Open **File → Import Connections …** and choose DBeaver. Colwerk reads `data-sources.json` and takes over PostgreSQL,
MySQL, SQL Server, ClickHouse, SQLite and DuckDB connections with folder, host, port, database, user and password, Windows
and Azure logins, SSH tunnels (without jump hosts) and TLS. Connections of type "prod" become red with **Confirm
writing statements** on. DBeaver's files are only read, not changed ([Import connections](/docs/connections/import/)).

## Limits

- macOS: Apple Silicon only. Linux: `.deb` packages only, without automatic updates.
- Schema compare covers PostgreSQL 12+, MySQL/MariaDB and SQL Server.
- ClickHouse results cannot be edited.

See [Known limitations](/docs/reference/limitations/).

## Questions

### Is there a free DBeaver alternative for Mac?

Yes. Colwerk is free and open source and runs natively on Macs with Apple Silicon. It connects to PostgreSQL,
MySQL/MariaDB, SQL Server, ClickHouse, DuckDB and SQLite.

### Can I move my DBeaver connections to Colwerk?

Yes. **File → Import Connections …** reads DBeaver's connection file, including the saved passwords, and shows a
preview before anything is saved.

### Does Colwerk have an AI assistant like DBeaver?

Colwerk has no AI inside. Its built-in MCP server lets an assistant you already use, such as Claude, Codex or Cursor,
explore schemas and run read-only queries.

## Get started

- [Download Colwerk](/#download)
- [Install and update](/docs/start/install/)
- [Import connections](/docs/connections/import/)
- [Connect an AI assistant](/docs/mcp/)

## Sources

1. [About DBeaver](https://dbeaver.io/about/), dbeaver.io; version from [Download](https://dbeaver.io/download/)
2. [DBeaver editions](https://dbeaver.com/edition/), dbeaver.com
3. [Installation](https://dbeaver.com/docs/dbeaver/Installation/), DBeaver documentation
4. [Model Context Protocol Server](https://dbeaver.com/docs/dbeaver/Model-Context-Protocol-Server/), DBeaver documentation
5. [AI Assistance and Data Privacy](https://dbeaver.com/docs/dbeaver/AI-Assistance-and-Data-Privacy/), DBeaver documentation
6. [Statistics Collection](https://dbeaver.com/docs/dbeaver/Statistics-Collection/), DBeaver documentation
7. [ER Diagrams](https://dbeaver.com/docs/dbeaver/ER-Diagrams/), DBeaver documentation
8. [Data transfer](https://dbeaver.com/docs/dbeaver/Data-transfer/), DBeaver documentation
9. [Import connections from external tools](https://dbeaver.com/docs/dbeaver/How-to-import-Connections-from-External-Tools/), DBeaver documentation

DBeaver is a trademark of its owner. Colwerk is not affiliated with, endorsed by or sponsored by the owner of DBeaver.
