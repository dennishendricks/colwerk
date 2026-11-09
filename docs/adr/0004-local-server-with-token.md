# 0004 · Local HTTP server with a per-start token

- Status: Accepted
- Date: 2026-10-26 (initial commit); not changed by the runtime switches

## Context

The frontend is a web app that talks to a server holding database connections and credentials. The same server runs
behind the desktop app, behind the self-hosted binary in a browser and behind the MCP endpoint for AI assistants. Other
local processes, and web pages in the user's browser, must not be able to use it.

## Decision

- The server listens on `127.0.0.1` only, on a random port.
- Every start creates a random token. The app URL carries it in the fragment (`#token=…`), which is never sent to the
  server or written to access logs. `/api/*` requests send it as `x-colwerk-token`, and the server compares it in
  constant time.
- Requests with a foreign `Host` or `Origin` are rejected (DNS rebinding, cross-site requests).
- MCP clients use a separate MCP token; `instance.json` in the data directory only tells them the port.
- The frontend talks to `/api/*` only. The database logic lives in `core/`, and Nitro stays a thin layer.

## Consequences

- The desktop shell only has to start the server and open the URL it prints.
- Anyone who can read the token (the printed URL, the server's environment) can use the API until the server stops,
  so logs and diagnostics must not contain it.
