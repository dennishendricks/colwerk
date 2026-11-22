---
title: Sessions and transactions
description: How Colwerk keeps one database session per tab, detects open transactions and offers commit and rollback.
sidebar:
  order: 3
---

## One session per tab

Each editor tab holds its own database session. Transactions, temporary tables, variables and `SET` options of a tab
stay with that tab until it is closed or switches connection. Two tabs on the same connection do not see each other's
uncommitted changes.

The schema tree uses a separate metadata session per connection, so browsing never waits on a tab's locks. The
[session monitor](/docs/data/session-monitor/) and [grid edits](/docs/data/editing/) use sessions of their own too.

## Open transactions

After each run Colwerk asks the session whether a transaction is open. If so, the toolbar shows **Transaction open**,
the tab gets a warning icon, and **Commit** and **Rollback** appear in the toolbar and the **Query** menu. After an
error inside a transaction, the badge reads **Transaction failed** and only Rollback is offered.

Detection works on PostgreSQL, MySQL/MariaDB, SQL Server, DuckDB and SQLite. ClickHouse has no transactions.

You start transactions yourself, with `BEGIN`, `START TRANSACTION` or `BEGIN TRANSACTION`. Without one, statements are
committed as they run.

## When a transaction is rolled back

An open transaction is rolled back when its tab is closed, when the tab switches to another connection, or when the
connection is disconnected. Colwerk asks before each of these. A tab with an open transaction cannot be moved to a new
window.

Quitting Colwerk ends all sessions; open transactions are then rolled back by the database without asking.
