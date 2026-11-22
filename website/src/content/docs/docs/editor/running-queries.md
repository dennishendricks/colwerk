---
title: Running queries
description: Run statements and scripts, set the row limit and timeout, cancel queries and use variables in Colwerk.
sidebar:
  order: 2
---

## What runs

Press ⌘Enter or click **Run**:

- With a **selection**, Colwerk runs the selection.
- Without one, it runs the **statement under the cursor** and selects it, so you see what ran. If the cursor is between
  statements, it takes the one before.

To run a whole script, select all (⌘A) and run. Colwerk splits it into statements the way the engine's own client does:
it knows strings, comments, PostgreSQL dollar quoting, MySQL `DELIMITER`, routine and trigger bodies, and SQL Server
`GO`. The statements run one after another; the first error stops the script and names the statement.

Each statement can return a result. Colwerk shows the last one; the buttons **Result 1**, **Result 2** … switch between
them.

:::note
On PostgreSQL, DuckDB and SQLite each statement of a script is committed on its own, unless the script starts its own
transaction with `BEGIN`. See [Transactions](/docs/editor/transactions/).
:::

## Row limit and timeout

Every tab has its own values in the toolbar:

- **Limit**: 200 rows by default (1 to 100,000). Colwerk reads only that many rows and cancels the rest, so a large
  table does not strain the server. The status line says when the result was truncated; the
  [export](/docs/data/export/) can still write the full result.
- **Timeout (s)**: 60 seconds by default (up to 86,400). When it runs out, Colwerk cancels the statement.

Both are saved with the tab and copied when you duplicate it.

## Cancel

Click **Cancel**, choose **Query → Cancel** or press Ctrl+C (on Windows and Linux only when no text is selected).
Every engine supports cancelling. Closing a tab cancels its running statement first.

## Variables

Write `${name}` in a query to fill in a value when it runs. Colwerk asks for all variables of the query in a dialog,
prefilled with the values you used last in this tab.

```sql
select * from orders
where customer_id = ${customer} and status = '${status}'
```

Values are inserted as typed, without quotes: put the variable in quotes for a text value. Variables are replaced in
code and inside single-quoted strings, but not in comments, quoted identifiers or dollar-quoted bodies. Other
placeholders such as `$1`, `:name` or ClickHouse's `{x:Type}` are left alone. Variables also work for execution plans
and dry runs.

## Before a query runs

Depending on the connection's [guard rails](/docs/connections/#guard-rails), Colwerk checks in this order: variables,
`UPDATE`/`DELETE` without `WHERE`, confirmation of writing statements, then the plan check. See
[Guard rails](/docs/editor/safety/).

## History

Every query you run is recorded in the [query history](/docs/editor/tabs/#query-history), including failed ones.
