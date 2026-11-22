---
title: Connect an AI assistant
description: Set up Colwerk's built-in MCP server in Claude Desktop, Claude Code, Codex, Cursor or VS Code, and decide what the assistant may read.
sidebar:
  order: 1
---

Colwerk has no AI inside. Instead it runs an MCP server (Model Context Protocol), so the assistant you already use can
browse your schemas, look at sample rows and run read-only queries. When it has a query for you, it opens it in a new
editor tab, and you decide whether it runs.

MCP is always available while Colwerk runs. There is nothing to switch on, but an assistant needs the entry described
below, and Colwerk must be running when the assistant calls it.

## Set up the client

Open **Colwerk → Set Up MCP …** in the menu (in the browser version: the sparkles button in the tab bar). The dialog
shows the configuration for your system, with the real path of the `colwerk-server` program. Copy it from there.

The client starts `colwerk-server mcp`, a small bridge that forwards its requests to the running app. It finds the app on
its own, so you can start Colwerk before or after the assistant.

### Claude Desktop

In Claude, open **Settings → Developer → Edit Config**, add the entry to `claude_desktop_config.json` and restart Claude:

```json
{
  "mcpServers": {
    "colwerk": {
      "command": "/Applications/Colwerk.app/Contents/MacOS/colwerk-server",
      "args": ["mcp"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add colwerk -- /Applications/Colwerk.app/Contents/MacOS/colwerk-server mcp
```

### Codex

ChatGPT only accepts MCP servers on the internet over HTTPS, not local programs like Colwerk. Codex (CLI and app)
supports them, by command or in `~/.codex/config.toml`:

```sh
codex mcp add colwerk -- /Applications/Colwerk.app/Contents/MacOS/colwerk-server mcp
```

```toml
[mcp_servers.colwerk]
command = "/Applications/Colwerk.app/Contents/MacOS/colwerk-server"
args = ["mcp"]
```

### Other clients

Cursor, VS Code and other clients take the same command as a stdio server: the path to `colwerk-server` with the
argument `mcp`.

The paths above are those of macOS. On Windows and Linux, copy the path from the dialog.

## What the assistant can do

The assistant gets [seven tools](/docs/mcp/tools/): it can list your connections, schemas and tables, describe a table,
read sample rows, run a `SELECT` and open a query in a new tab. It cannot:

- see passwords or other credentials,
- insert, update or delete rows or change the schema,
- run anything in your editor tabs,
- connect without the MCP token, which only the bridge on your computer has.

A typical session: you ask a question, the assistant explores the schema, tries a few queries and finally hands over
its query with `open-query`. The query opens in a new tab with the assistant's explanation as a SQL comment above it,
and is not run.

## How queries are protected

Every query of an assistant goes through three layers:

1. **Text check.** Only a single statement starting with `SELECT` or `WITH` is accepted.
2. **A transaction that is never committed.** The query runs in a session of its own, inside a read-only transaction
   that is rolled back afterwards (PostgreSQL `BEGIN READ ONLY`, MySQL `START TRANSACTION READ ONLY`, SQLite
   `query_only`, ClickHouse `readonly = 2`, SQL Server and DuckDB a transaction that is rolled back).
3. **Limits.** A statement timeout of 30 seconds and a row limit: `run-query` returns at most 1000 rows (default 100),
   `sample-rows` at most 50 (default 10).

Assistants never start a Microsoft Entra sign-in; they can only use a sign-in that is still valid. A connection you
disconnected stays disconnected for them too.

### A login of its own

For the strongest protection, give MCP its own database login with read permissions only. In the connection dialog,
open **Advanced** and turn on **Separate login for AI assistants (MCP)**, then enter the MCP user and password (or token).
Assistants then always use this login, never the main one, in sessions of their own. This works for password, Windows
and token logins; Entra and OAuth logins have no separate MCP login.

### DuckDB files

By default an assistant opens a DuckDB database file read-only, in a DuckDB instance of its own that cannot read files,
URLs or extensions. The instance is closed after every request. This fails while Colwerk has the file open for writing;
disconnect the connection or open it read-only in that case.

If the assistant needs the files and URLs the database refers to, turn on **Let AI assistants (MCP) read files and
URLs** in the connection. Its queries then run in the editor's DuckDB instance, still inside a transaction that is
rolled back.

Lakehouse and files connections always need file and network access; assistants query them like the editor does.

## Prompt injection

:::caution
Query results can contain text written by others that tries to give the assistant instructions. Read-only access does
not stop the assistant from acting on such text with its other tools, such as files, shell or web access. Connect only
data you trust, and review what the assistant does.
:::

Every tool call is recorded in the [audit log](/docs/mcp/audit-log/).

## The MCP token

The bridge authenticates with a token that Colwerk creates on the first start and keeps, so the client configuration
stays valid across updates. It is stored in the OS keychain (or in the file `mcp-token` in the
[data directory](/docs/reference/data-directory/) without one). The environment variable `COLWERK_MCP_TOKEN` sets a
token of your own.

If Colwerk is not running, the assistant gets the answer "Colwerk is not running. Start the app and try again."
