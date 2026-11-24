---
title: Import connections
description: Take over connections from DBeaver, Beekeeper Studio, Azure Data Studio, .pgpass and dbt profiles.yml.
sidebar:
  order: 7
---

Open **Import** in the connection list, **File → Import Connections …** or **Import connections** on the empty start
screen. Colwerk only reads the other tools' files; it changes nothing there.

Each source shows the file found at its default location. **Show connections** reads it, **Choose file …** reads
another file.

| Source            | Default location                                                                   |
| ----------------- | ---------------------------------------------------------------------------------- |
| DBeaver           | `DBeaverData/workspace6/General/.dbeaver/data-sources.json` in the app data folder |
| Beekeeper Studio  | `beekeeper-studio/app.db` in the app data folder (also Snap and Flatpak)           |
| Azure Data Studio | `azuredatastudio/User/settings.json` in the app data folder                        |
| .pgpass           | `$PGPASSFILE`, else `~/.pgpass` (Windows: `%APPDATA%\postgresql\pgpass.conf`)      |
| dbt               | `$DBT_PROFILES_DIR/profiles.yml`, else `~/.dbt/profiles.yml`                       |

The app data folder is `~/Library/Application Support` on macOS, `%APPDATA%` on Windows and `~/.config` (or
`~/.local/share` for DBeaver) on Linux.

## What is imported

- **DBeaver**: PostgreSQL, MySQL, SQL Server, ClickHouse, SQLite and DuckDB connections with folder, host, port,
  database, user and password (decrypted with DBeaver's built-in key). Windows and Azure logins, SSH tunnels (without
  jump hosts) and TLS. Connections of type "prod" become red with **Confirm writing statements** on.
- **Beekeeper Studio**: PostgreSQL, MySQL/MariaDB, SQL Server, SQLite, DuckDB and ClickHouse with folders, socket, TLS
  settings, SSH tunnels (without bastion hosts), color and passwords. Beekeeper's read-only mode becomes **Confirm
  writing statements**.
- **Azure Data Studio**: SQL Server and PostgreSQL connections with instance, encryption, application intent, failover
  and retry settings, and connection groups as folders. Azure Data Studio keeps passwords in the system's credential
  store, so the preview asks for them.
- **.pgpass**: every line becomes a PostgreSQL connection named `user@host:port/db`. Lines with a `*` host are skipped.
- **dbt**: every output of a profile becomes a connection named "profile (output)" (postgres, sqlserver, fabric, mysql,
  mariadb, clickhouse, duckdb). Values from `env_var()` are not filled in but marked, so you can enter them afterwards.

Client certificates are not imported. A SQL Server connection with **Trust Server Certificate** but without encryption
turned on (Beekeeper Studio, Azure Data Studio) is imported with **Use TLS** and **Don't verify certificate**: the
setting only has an effect when the server enforces encryption, and in Colwerk it requires TLS.

## Preview

The preview lists every connection with its target and notes, for example settings that were not taken over. Those
that cannot be imported are listed with the reason. Connections that already exist in Colwerk (same engine and file,
or same host, port, database and user) are marked and cannot be selected. Where a password is missing, the preview
offers a field for it; leave it empty to store none.

**Import** saves the selected connections. Their passwords are stored encrypted like all others.
