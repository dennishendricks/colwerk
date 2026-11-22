---
title: First steps
description: Add a connection, run a query, and find your way around the Colwerk window.
sidebar:
  order: 3
---

## Add a connection

Click **New** in the connection list at the top of the sidebar (or **File → New Connection …**). Choose the database
system, enter host, port, database, user and password, click **Test** and then **Save**. The details of every engine
are in [Databases](/docs/connections/databases/).

Using DBeaver, Beekeeper Studio, Azure Data Studio, a `.pgpass` file or dbt? [Import your
connections](/docs/connections/import/) instead.

To open a DuckDB or SQLite file, double-click it or drop it onto the window.

## Run a query

1. Select the connection in the sidebar. The schema tree below it shows its schemas and tables.
2. Press ⌘T for a new tab. It uses the selected connection and database.
3. Type a query and press ⌘Enter. Colwerk runs the statement under the cursor, or the selection.

Double-click a table in the schema tree to query all its columns. ⌘P finds any table or view by name.

New tabs start with a limit of 200 rows and a timeout of 60 seconds, enough to see your data and too little to strain
the server. Both can be changed in the toolbar of each tab.

## The window

- **Sidebar:** the connection list, the database picker and the [schema tree](/docs/data/schema-tree/). ⌘B shows or
  hides it.
- **Tab bar:** one tab per query, each with its own database session. The buttons on the right open the
  [compare](/docs/data/compare/), the [history](/docs/editor/tabs/#query-history), the appearance switch and the
  shortcut overview.
- **Toolbar:** the tab's connection, database, row limit and timeout, and the **Run**, **Format** and **Cancel**
  buttons.
- **Editor** above, **[result grid](/docs/data/result-grid/)** below.

Press **?** for all keyboard shortcuts, or see the [shortcut reference](/docs/reference/shortcuts/).

## Language and appearance

Colwerk is available in English and German. It follows the system language; **View** in the menu switches it. The
appearance (system, light or dark) is in the same menu and behind the sun/moon button in the tab bar. ⌘+ and ⌘−
change the font size of editor and grid, ⌘0 resets it.
