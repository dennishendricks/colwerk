---
title: Tabs, windows and files
description: Work with tabs and windows, open and save SQL files, find tables quickly and search the query history.
sidebar:
  order: 6
---

## Tabs

⌘T opens a new tab on the connection and database selected in the sidebar. Each tab has its own
[session](/docs/editor/transactions/), connection, SQL, row limit, timeout and variables.

- **Rename**: double-click the title, or press F2 while the tab is focused.
- **Duplicate**: ⌘⇧D copies SQL, limit, timeout and variables into a new tab.
- **Switch**: ⌘1 to ⌘9, or ⇧⌘[ and ⇧⌘] for the previous and next tab.
- **Close**: ⌘W. Colwerk asks if the tab contains a query or an open transaction. Right-click a tab to close the
  others, or those to its left or right.

A tab shows a spinner while it runs, a warning icon with an open transaction and the color of its connection.

Colwerk saves the open tabs of every window and restores them on the next start, with SQL, connection, limit, timeout
and variables. Results and transactions are not restored.

## Windows

In the desktop app, right-click a tab and choose **Move to New Window**. Each window has its own tabs and menu. **Move
to Main Window** moves it back; closing a window moves its tabs back to the main window. Tabs with an open transaction
or a running query cannot be moved to a new window.

## Go to table

⌘P (**View → Go to Table …**) searches the tables and views of all schemas of the selected connection; type part of the
schema name too, e.g. `sales.ord`. Enter queries all columns of the selection, like a double-click in the schema tree.

## Query history

The history icon in the tab bar (or **Query → History …**) lists the last 50 queries you ran, newest first, with
connection, time, duration, row count and error. Search the SQL, or turn off **Current connection only** to see all.
Click an entry to open it in a new tab; it is not run. **Clear history** deletes all entries. An empty tab shows the
recent queries of its connection.

## Files

- **Open** (⌘O): opens a `.sql` file in a new tab, titled with the file name. If it is already open, Colwerk switches to
  its tab.
- **Save** (⌘S) writes the tab to its file, or asks for a name. **Save As …** (⌘⇧S) always asks.
- Double-click a `.sql` file in your file manager to open it in Colwerk.

Dropping files onto the window opens them too: `.sql` and `.sqlplan` files in a tab, DuckDB and SQLite files as a
[connection](/docs/connections/databases/#opening-files-directly), data files as a
[query](/docs/connections/files/).
