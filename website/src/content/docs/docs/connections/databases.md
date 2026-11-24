---
title: Databases
description: Connection settings for PostgreSQL, MySQL and MariaDB, SQL Server, ClickHouse, DuckDB and SQLite in Colwerk.
sidebar:
  order: 2
---

## Server databases

PostgreSQL, MySQL/MariaDB, SQL Server and ClickHouse share these fields:

| Field          | Notes                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------- |
| Host           | Default `127.0.0.1`.                                                                     |
| Port           | Defaults: PostgreSQL 5432, MySQL 3306, SQL Server 1433, ClickHouse 8123 (8443 with TLS). |
| Database       | Optional; the default database of the connection.                                        |
| Authentication | Shown when the engine offers more than one login.                                        |
| User, Password | The password can come from a [password manager](/docs/connections/passwords/).           |
| Use TLS        | Encrypts the connection; see [SSH tunnel and TLS](/docs/connections/ssh-tls/).           |

### Logins

| Login                                    | PostgreSQL | MySQL | SQL Server | ClickHouse |
| ---------------------------------------- | :--------: | :---: | :--------: | :--------: |
| User and password                        |     ✓      |   ✓   |     ✓      |     ✓      |
| Windows (NTLM)                           |            |       |     ✓      |            |
| Microsoft Entra: Azure CLI / environment |     ✓      |   ✓   |     ✓      |            |
| Microsoft Entra: browser (MFA)           |     ✓      |   ✓   |     ✓      |            |
| Microsoft Entra: service principal       |     ✓      |   ✓   |     ✓      |            |

- **Windows (NTLM)** asks for domain, user and password.
- **Entra: Azure CLI / environment** uses the sign-in of `az login`, Azure PowerShell, `azd` or the `AZURE_*`
  environment variables.
- **Entra: browser (MFA)** opens the browser to sign in when connecting. The sign-in lasts until Colwerk quits. For SQL
  Server the **Account** is optional and only suggested when signing in.
- **Entra: service principal** signs in with an app registration: tenant ID, client ID and client secret.
- For PostgreSQL and MySQL with Entra, the user is the Entra user or group as created in the database. SQL Server takes
  the user from the token.

Under **More options**, Entra logins accept a **Tenant ID** (empty: the account's default tenant) and, for the browser
login, a **Client ID** of your own app registration.

### PostgreSQL

- **Unix socket** (More options): the directory of the socket, e.g. `/var/run/postgresql`. Replaces the host.
- **Search path** (`search_path`): schemas searched for unqualified names. Empty: the server's setting.

### MySQL and MariaDB

- MySQL has no schemas below the database: the database picker selects the database, and the schema tree shows its
  tables directly.
- **Unix socket** (More options): the path to the socket, or the named pipe on Windows. Replaces host and port.

### SQL Server

You can enter the host and user the way SQL Server tools write them. On **Test** and **Save**, Colwerk splits them into
its own fields:

- `10.0.0.5\SQLERP` in **Host** becomes host `10.0.0.5` and named instance `SQLERP`.
- `CORP\jdoe` in **User** becomes user `jdoe` and domain `CORP`, and the login switches to **Windows (NTLM)**.

Under More options:

- **Named instance**, e.g. `SQLEXPRESS`: found through the SQL Server Browser (UDP 1434), replaces the port.
- **Connection attempts** (default 3): retries on transient errors, for example while Azure SQL serverless resumes.
- **Language** (`SET LANGUAGE`, e.g. `Deutsch`) and **Date format** (by language, or `dmy`, `mdy`, `ymd` …).
- **Request read-only access** (`ApplicationIntent=ReadOnly`): routes to readable replicas of an Availability Group or
  Azure SQL.
- **MultiSubnetFailover**: faster reconnects after a failover of listeners spanning several subnets.

Scripts are split into batches at `GO` (also `GO 5`), as in SQL Server Management Studio. Variables do not survive a
`GO`.

### ClickHouse

Colwerk talks to ClickHouse through its HTTP interface (port 8123, or 8443 with TLS). Database and user default to
`default`. Each tab has its own ClickHouse session, so temporary tables and `SET` options persist per tab; ClickHouse
forgets them after an hour without a query. ClickHouse has no transactions.

## File databases

### DuckDB

- **Database file**: an absolute path, chosen with **Browse …**. Empty or `:memory:` creates an in-memory database,
  shared by the connection's tabs.
- **Create a new file compatible with DuckDB 1.x** (More options): only applies when the file does not exist yet. DuckDB 1.x cannot
  open files in the format of DuckDB 2.
- **Let AI assistants (MCP) read files and URLs** (More options): see [DuckDB files](/docs/mcp/#duckdb-files).

DuckDB locks its file while it is open; **Disconnect** releases it for other programs.

### SQLite

- **Database file**: an absolute path, or `:memory:` for a temporary database shared by the connection's tabs and
  deleted with the last one.

SQLite cannot interrupt a running statement: cancelling ends the tab's session, which rolls back an open transaction
and drops temporary tables. SQLite has no decimal or timestamp types, so such values come back as stored (text or
number).

### Opening files directly

Double-click a `.duckdb`, `.sqlite` or `.sqlite3` file, drop it onto the window or open it with **File → Open …**.
Colwerk selects the existing connection to that file or creates a new one named after the file.

## The DuckDB driver

Colwerk includes DuckDB's native library, compressed. At the first start after an installation or update, Colwerk
unpacks it into the [data directory](/docs/reference/data-directory/); no download is needed. DuckDB installs its
extensions (for Excel, HTTP, S3 and the lakehouse formats) itself on first use.
