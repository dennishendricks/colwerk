---
title: The editor
description: Autocomplete, checks, formatting, multiple cursors and search in Colwerk's SQL editor.
sidebar:
  order: 1
---

Each tab has a SQL editor with syntax highlighting in the dialect of its connection, line numbers, bracket matching and
automatic indentation.

## Autocomplete

Suggestions appear while you type; ⌃Space opens them. Colwerk knows:

- **tables and columns** of the connection. Columns load shortly after you name a table, for up to 20 tables of the
  query.
- **aliases**: after `o.` it suggests the columns of the table, CTE or subquery named `o`.
- **joins along foreign keys**: after `JOIN` it suggests the tables linked to those already in the query, in either
  direction, with the complete `ON` clause and an alias, e.g. `order_items oi on oi.order_id = o.id`.
- **functions** of the engine with their signature, and user-defined functions. They are inserted with the cursor
  between the parentheses.

There are no suggestions inside strings and comments.

## Checks

Colwerk underlines likely mistakes shortly after you stop typing:

- **Unknown names**: "Unknown table …", "… has no column …" (PostgreSQL, MySQL, SQL Server and SQLite), and
  ambiguous columns that exist in several tables of the query (all engines). Only schemas whose tables are loaded are
  checked; temporary tables and tables created in the same script are known.
- **UPDATE or DELETE without WHERE**: "… without WHERE affects all rows".

Both checks can be turned off in the menu next to the **Run** button ("Check table and column names", "Warn on
UPDATE/DELETE without WHERE"). The setting applies to all tabs.

When the database reports an error with a position, Colwerk marks the place in the editor and moves the cursor there.

## Formatting

**Format** in the toolbar or ⌘⇧F formats the whole query in the connection's dialect: four-space indentation, keywords
as written, one clause per line. ⌘Z undoes it.

## SQL from the schema

The [schema tree](/docs/data/schema-tree/) writes SQL for you: double-click a table to query all its columns, or
right-click it for **Generate SQL** with `SELECT`, `INSERT`, `UPDATE` and `DELETE` templates. The templates use the
placeholder style of the engine (`$1`, `?`, `@p1`, `{p1:String}`), and `UPDATE` and `DELETE` match on the primary key.

## Multiple cursors and selection

| Keys      | Action                       |
| --------- | ---------------------------- |
| ⌘⌥↑ / ⌘⌥↓ | Add a cursor above / below   |
| ⌘D        | Select the next occurrence   |
| ⌘⇧L       | Select all occurrences       |
| ⌥ + drag  | Block selection across lines |
| Esc       | Back to a single cursor      |

## Search and replace

⌘F opens search and replace with options for case, regular expressions and whole words. F3 or ⌘G jumps to the next
match (with ⇧ to the previous one), ⌘⌥G goes to a line.

More editing keys (comment lines, move lines, indent) are in the [shortcut reference](/docs/reference/shortcuts/).
