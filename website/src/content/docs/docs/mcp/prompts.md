---
title: Example prompts for AI assistants
description: What to ask Claude, Codex, Cursor or another MCP client about your databases through Colwerk, from exploring a schema to a finished query.
sidebar:
  label: Example prompts
  order: 2
---

Once an assistant is [connected to Colwerk](/docs/mcp/), you ask it questions in plain language. It explores the
schema with Colwerk's [MCP tools](/docs/mcp/tools/), runs read-only queries and, when you ask for it, hands a finished
query to a new editor tab. These prompts work in Claude Desktop, Claude Code, Codex, Cursor, VS Code and other MCP
clients. Name the connection when you have more than one.

## Find your way around a database

- "Which connections do I have in Colwerk, and which of them are reachable?"
- "Give me an overview of the `shop` connection: schemas, the largest tables and what they are for."
- "How are `orders`, `customers` and `products` related? List the foreign keys and the join paths."
- "Describe the table `billing.invoices` and show me a few sample rows."
- "Which tables have no primary key?"

The assistant uses `list-connections`, `list-schemas`, `list-tables`, `describe-table` and `sample-rows` for this.
Row counts are estimates from the database statistics, so the assistant does not need `COUNT(*)` on large tables.

## Answer a question with data

- "Which city bought the most coffee last month?"
- "How many new customers did we get per week this year? Show the trend."
- "Which products were ordered together most often?"
- "Compare the average order value of new and returning customers."

The assistant tries queries with `run-query` until it has the answer. Each query runs in a read-only transaction that is
rolled back, with a timeout of 30 seconds and at most 1000 rows (see
[How queries are protected](/docs/mcp/#how-queries-are-protected)).

## Get a query to run yourself

- "Write a query for monthly revenue per country and open it in Colwerk."
- "Open a query in a new tab that lists all orders without an invoice, with a comment explaining it."
- "Turn this question into SQL for SQL Server and open it in Colwerk: which sessions held locks longest today?"

With `open-query`, the query opens in a new tab with the assistant's explanation as a SQL comment above it. Colwerk does
not run it: you review it, change it and run it with :kbd[meta+Enter]. This is also the way to queries that change
data, which the assistant itself cannot run.

## Check data quality

- "Find duplicate customers by email address in `crm.contacts`."
- "Which columns in `orders` are always NULL?"
- "Are there order lines whose product no longer exists?"
- "Check whether `created_at` ever lies after `updated_at` in the `tickets` table."

## Document a schema

- "Write a short description of every table in the `public` schema, based on columns and sample rows."
- "Draw a Mermaid ER diagram of the tables around `orders`."
- "Explain the purpose of the column `status` in `shipments` and list its values."

Colwerk can also draw [ER diagrams](/docs/data/er-diagrams/) from the foreign keys itself, without an assistant.

## Tips

- **Ask for SQL in your engine's dialect.** Colwerk tells the assistant which engine a connection uses, but naming it
  ("for ClickHouse", "for T-SQL") helps with the details.
- **Give it a login of its own.** For production databases, set up a
  [separate login for AI assistants](/docs/mcp/#a-login-of-its-own) with read permissions only.
- **Personal data stays masked.** Columns with email addresses, names and other personal data are
  [masked](/docs/data/masking/#ai-assistants) in the answers to assistants by default, and queries that name them are
  refused. Ask for counts or aggregates instead.
- **See what happened.** Every tool call is recorded in the [audit log](/docs/mcp/audit-log/).
