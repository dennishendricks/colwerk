---
title: Audit log
description: Every tool call of an AI assistant is recorded in Colwerk's MCP audit log, without result data.
sidebar:
  order: 3
---

Colwerk records every tool call of an AI assistant, including failed ones. Open the log with **Colwerk → MCP Audit Log
…** or from the footer of the MCP dialog.

## What is recorded

Each entry holds:

- the time of the call and the client (name and version as the assistant reports them),
- the tool and the connection (by the name it had at the time),
- the SQL, if any,
- the duration and, for `run-query` and `sample-rows`, the number of rows returned,
- the columns [masked](/docs/data/masking/) in the answer,
- the status (ok, error or timeout) and the error message.

Result rows and credentials are never recorded.

## Viewing and filtering

Filter by connection and by period (last hour, last 24 hours, last 7 days or all). The log shows the newest 500
matching entries; failed calls and timeouts are marked. Click an entry with SQL to open the query in a new tab. Entries
of a deleted connection show "Deleted connection" and cannot be opened.

## Retention

Choose how long entries are kept in the footer: 7, 30, 90 or 365 days (default 30). The log keeps at most 10,000
entries, the newest. **Clear log** empties it at once, without asking.

The log is the file `mcp-audit.jsonl` (JSON Lines) in the [data directory](/docs/reference/data-directory/), readable
only by your user.
