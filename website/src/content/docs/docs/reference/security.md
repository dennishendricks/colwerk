---
title: Security and privacy
description: How Colwerk protects its local server, encrypts passwords and what network connections it makes.
sidebar:
  order: 4
---

## No telemetry

Colwerk has no telemetry, no analytics and no account. Queries go directly from your computer to your databases. See
also the [privacy policy](/privacy/).

Colwerk itself only connects to:

- **GitHub**, to check for updates, download them and load release notes;
- **the npm registry**, once, to download the DuckDB library (verified against a hash fixed at build time);
- **DuckDB's extension repository**, to install the extensions a feature needs;
- the databases, catalogs and cloud services you configure.

## The local server

Colwerk consists of a window and a local server that talks to the databases. The server:

- listens only on `127.0.0.1`, on a random port;
- requires a random token, created at every start, on every request;
- rejects requests with a foreign `Host` or `Origin` header, against DNS rebinding and requests from websites;
- serves its page with a strict Content Security Policy.

The [MCP server](/docs/mcp/) uses a token of its own, which only the MCP bridge on your computer reads.

## Passwords

Passwords, client secrets, tokens, SSH passphrases and MCP passwords are encrypted with AES-256-GCM. The key is stored
in the operating system's keychain: the macOS Keychain, the Windows Credential Manager or libsecret on Linux (through
`secret-tool`). Without a usable keychain, or with `COLWERK_KEYCHAIN=off`, the key is kept in the file `secret.key`
in the [data directory](/docs/reference/data-directory/), readable only by your user. That protects against accidental
disclosure (backups, sync folders), not against someone with access to your user account.

With a [password manager](/docs/connections/passwords/), Colwerk stores only a reference and keeps the secret in memory.

AI assistants never see credentials.

## Signed downloads

Updates are signed, and Colwerk checks the signature before installing one. Every release comes with checksums, a
software bill of materials and build provenance attestations (see [Install and update](/docs/start/install/)).

## Reporting a vulnerability

Please report security issues privately as described in
[SECURITY.md](https://github.com/dennishendricks/colwerk/blob/main/SECURITY.md).
