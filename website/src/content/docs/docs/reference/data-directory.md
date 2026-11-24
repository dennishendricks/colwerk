---
title: Data directory and settings
description: Where Colwerk stores connections, tabs, history and logs, and the environment variables it reads.
sidebar:
  order: 3
---

## Location

| System  | Data directory                                             |
| ------- | ---------------------------------------------------------- |
| macOS   | `~/Library/Application Support/colwerk`                    |
| Windows | `%APPDATA%\colwerk`                                        |
| Linux   | `$XDG_CONFIG_HOME/colwerk`, by default `~/.config/colwerk` |

## Contents

| File or folder            | Content                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `connections.json`        | Connections; passwords and other secrets encrypted.                                                           |
| `workspace.json`          | Open tabs per window, restored on the next start.                                                             |
| `settings.json`           | The settings: [CSV format](/docs/data/export/#csv-settings), [SQL formatting](/docs/editor/#format-settings). |
| `history.json`            | The last 50 queries.                                                                                          |
| `mcp-audit.jsonl`         | The [MCP audit log](/docs/mcp/audit-log/); `mcp-audit-settings.json` its retention.                           |
| `instance.json`           | Port of the running app, for the MCP bridge; removed on exit.                                                 |
| `drivers/`                | DuckDB's library, unpacked from the app at the first start of a version.                                      |
| `logs/`                   | Logs of the desktop app (5 MB each, the last three are kept).                                                 |
| `secret.key`, `mcp-token` | Only without a usable keychain: the encryption key and the MCP token.                                         |

Files with secrets are readable only by your user. DuckDB keeps its extensions in its own folder, `~/.duckdb/extensions`.

To move Colwerk to another computer, copy the data directory. Stored passwords cannot be decrypted there, because their
key stays in the old computer's keychain; enter them again.

## Settings

Colwerk has no settings dialog. Settings live where they apply:

- **Per connection**: color, read-only and the [guard rails](/docs/connections/#guard-rails).
- **Per tab**: row limit, timeout and variables.
- **In the menu next to Run**: the editor's [checks](/docs/editor/#checks).
- **View menu**: language, appearance and font size.

## Environment variables

| Variable               | Effect                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| `COLWERK_DATA_DIR`     | Use another data directory.                                             |
| `COLWERK_KEYCHAIN=off` | Keep the encryption key and MCP token in files instead of the keychain. |
| `COLWERK_MCP_TOKEN`    | Use this MCP token instead of the stored one.                           |

Colwerk also passes on variables that other tools read: `SSH_AUTH_SOCK` for the SSH agent, `AZURE_*` for Entra logins,
and `OP_SERVICE_ACCOUNT_TOKEN`, `BW_SESSION` and `BWS_ACCESS_TOKEN` for password managers.

## Diagnostics

**Help → Export Diagnostics …** saves a text file with the Colwerk version, the system, the state of the server and the
logs, for a bug report. The logs contain no tokens or passwords, but may contain SQL and error messages from your
databases: look through the file before you share it.
