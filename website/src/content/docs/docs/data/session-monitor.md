---
title: Session monitor
description: See running queries and blocking chains on PostgreSQL, MySQL, SQL Server and ClickHouse, and cancel queries or terminate sessions.
sidebar:
  order: 8
---

The **Sessions** button next to a connection opens the session monitor: who is connected, what runs, and who waits for
whom. It uses a session of its own, so it works even when other sessions are blocked.

## Engines and actions

| Engine        | Cancel query | Terminate session |
| ------------- | :----------: | :---------------: |
| PostgreSQL    |      ✓       |         ✓         |
| MySQL/MariaDB |      ✓       |         ✓         |
| SQL Server    |              |         ✓         |
| ClickHouse    |      ✓       |                   |

DuckDB, SQLite and lakehouses have no session monitor.

## The list

The list shows id, user, database, client, state, duration, what the session waits for, who blocks it and the query
(click a row for the full text). Colwerk's own monitor session is left out.

- **Refresh** updates the list; **Auto refresh** every 2, 5, 10 or 30 seconds (off by default; paused while the window
  is hidden).
- **Show idle** includes idle sessions; without it, idle sessions only appear if they block others.
- **Filter** searches user, database, application and query.

**Blocking chains** shows a tree of waiting sessions below the session at the head of the chain, marked "blocks
others". In a deadlock, the session with the smallest id is shown as the head.

## Cancelling and terminating

- **Cancel query** stops the running statement; the session stays open.
- **Terminate session** disconnects the session; its open transaction is rolled back.

Colwerk asks before both.

## Permissions

Without these permissions, only your own sessions are listed:

- PostgreSQL: `pg_read_all_stats`
- MySQL/MariaDB: `PROCESS` (without it there are also no lock relations)
- SQL Server: `VIEW SERVER STATE`

Cancelling or terminating other users' sessions needs the corresponding server permissions.
