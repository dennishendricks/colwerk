---
title: SQL Server client for Mac
description: Colwerk is a free SQL Server client for Mac on Apple Silicon. Connect to SQL Server in Docker or Azure SQL, run T-SQL with GO batches and read graphical plans.
---

Colwerk is a free, open-source SQL Server client for Mac that runs natively on Apple Silicon. It connects to Microsoft
SQL Server and Azure SQL, splits scripts at `GO` like SQL Server Management Studio and shows execution plans
graphically. The SQL editor is a client only: the SQL Server itself runs elsewhere, for example in Docker, on a Windows
or Linux server, or in Azure.

[Download Colwerk](/#download) · [SQL Server connection settings](/docs/connections/databases/#sql-server)

## SQL Server on a Mac: client and server

Searching for "SQL Server for Mac" usually means one of two things:

- **The database server.** SQL Server does not run on macOS itself. On a Mac, developers typically run it in a Docker
  container or use a server on the network or in Azure.
- **A client to work with it.** That is what Colwerk is: a desktop app that connects to any of these servers over the
  network.

## Connect to SQL Server

A SQL Server connection takes host, port (default 1433), database, user and password. You can enter host and user the
way SQL Server tools write them: `10.0.0.5\SQLERP` becomes host and **Named instance**, `CORP\jdoe` becomes user and
domain with the **Windows (NTLM)** login. See [Databases](/docs/connections/databases/#sql-server).

Logins:

- user and password,
- **Windows (NTLM)** with domain, user and password,
- Microsoft Entra through the Azure CLI or environment, in the browser with MFA, or as service principal
  ([Logins](/docs/connections/databases/#logins)).

Under **More options** you find **Connection attempts** (for Azure SQL serverless while it resumes),
**Request read-only access** (`ApplicationIntent=ReadOnly`) and **MultiSubnetFailover**. Connections can use TLS and
SSH tunnels ([SSH tunnel and TLS](/docs/connections/ssh-tls/)).

## What works with SQL Server

- **T-SQL scripts** are split into batches at `GO` (also `GO 5`).
- **Execution plans** appear as a tree of operators with cost, estimated and actual rows, warnings and missing indexes
  with a `CREATE INDEX` statement. `.sqlplan` files saved by SQL Server Management Studio open in a new tab
  ([Execution plans](/docs/editor/plans/)).
- **Edit rows** in the result grid, saved in one transaction ([Edit rows](/docs/data/editing/)).
- **Schema and data compare** with a deploy or sync script that you run yourself
  ([Schema and data compare](/docs/data/compare/)).
- **Session monitor** to see and terminate sessions ([Session monitor](/docs/data/session-monitor/)).
- **Export** to CSV, Parquet, Excel, JSON and more ([Export results](/docs/data/export/)).

The [feature matrix](/docs/reference/features/) lists what each engine supports.

## An Azure Data Studio alternative

Microsoft retired Azure Data Studio on 2026-02-28; it gets no more updates or security fixes
([Microsoft Learn](https://learn.microsoft.com/en-us/sql/tools/whats-happening-azure-data-studio)). Microsoft
recommends Visual Studio Code with the MSSQL extension as its successor, and SQL Server Management Studio remains
Microsoft's tool for administration on Windows.

If you want a standalone SQL client on the Mac instead, Colwerk imports Azure Data Studio connections: SQL Server and
PostgreSQL connections with instance, encryption, application intent, failover and retry settings, and connection
groups as folders. Azure Data Studio keeps passwords in the system's credential store, so the import asks for them
([Import connections](/docs/connections/import/)).

## Who it is for

Developers and analysts on a Mac who write T-SQL against SQL Server or Azure SQL and also work with PostgreSQL,
MySQL, ClickHouse, DuckDB or SQLite in the same app. For server administration on Windows (agent jobs, backups,
security settings), SQL Server Management Studio is the tool Microsoft provides.

## Limits

- macOS: Apple Silicon only.
- SQL Server sessions can only be terminated in the session monitor, not cancelled.
- A read-only SQL Server connection relies on Colwerk's check of the SQL text; for real protection, use a login with
  read permissions only.
- SQL Server geometries (`geometry`, `geography`) are shown as hex.

See [Known limitations](/docs/reference/limitations/).

## Questions

### Is there SQL Server Management Studio for Mac?

No. SQL Server Management Studio runs on Windows only. On a Mac you can use a SQL Server client such as Colwerk, or
Visual Studio Code with the MSSQL extension, which Microsoft recommends.

### Can I run SQL Server on a Mac?

Not natively. You can run SQL Server in a Docker container or connect to a server on the network or in Azure, then
connect Colwerk to it.

### Does Colwerk work with Azure SQL and Microsoft Entra?

Yes. Colwerk connects to Azure SQL with Entra logins through the Azure CLI, the browser with MFA or a service
principal, and retries the connection while a serverless database resumes.

## Get started

- [Download Colwerk](/#download)
- [Install and update](/docs/start/install/)
- [Import connections from Azure Data Studio](/docs/connections/import/)
- [First steps](/docs/start/first-steps/)
