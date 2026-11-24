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

## Tutorials

Short guided tours show Colwerk one feature at a time. Many of them use a demo database, a DuckDB database in memory
with sample data, so you can try everything without your own data. Colwerk adds it as a connection named
**Colwerk Demo** (some tours add variants of it) when a tour needs it, also again after you deleted it. Delete these
connections once you no longer need them. The demo data is created anew after every restart; changes you make in a tour
may stay until then.

On start, notifications in the bottom right corner offer the three most important tutorials you have not finished yet.
**Start** begins one, **Don't show again** hides it for good, and the close button hides it until the next start; other
tutorials are offered from the next start on. All tutorials are under **Help → Tutorials**, grouped by topic (in the browser behind the graduation cap in the tab bar).
Colwerk remembers which tutorials you have completed in `tours.json` in the
[data directory](/docs/reference/data-directory/).

## Language and appearance

Colwerk is available in English and German. It follows the system language; **View** in the menu switches it. The
appearance (system, light or dark) is in the same menu and behind the sun/moon button in the tab bar. ⌘+ and ⌘−
change the font size of editor and grid, ⌘0 resets it.
