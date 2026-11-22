---
title: ER diagrams
description: Draw entity-relationship diagrams of a schema or a table and its neighbors from foreign keys, and export them as Mermaid or DBML.
sidebar:
  order: 7
---

Right-click a schema or table in the schema tree and choose **ER diagram**. The diagram is read-only and built from the
foreign keys.

- **Schema**: all tables of the schema (views are left out). Above 100 tables, Colwerk shows the 100 with the most
  relations; open the diagram from a table to see its neighborhood.
- **Table**: the table in the middle, the tables it references on the right, the tables referencing it on the left.

Tables outside the scope, for example in other schemas, appear as dashed boxes with their key columns only.

## Navigating

- Mouse wheel zooms at the pointer, dragging moves the diagram; **Fit to window** shows all of it.
- **Keys only** shows only primary and foreign key columns. It is on by default above 30 tables.
- Double-click a table to center the diagram on it and its relations.

Relation lines end in a marker for "one" or, for nullable foreign keys, "zero or one".

## Mermaid and DBML

The **Mermaid** and **DBML** views show the diagram as text for documentation or other tools. **Copy** puts it on the
clipboard, **Save As** writes a `.mmd` or `.dbml` file.
