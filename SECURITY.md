# Security

## Supported versions

Only the latest release gets security fixes. Fixes ship as a new release; older versions are not patched.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub's security advisories](https://github.com/dennishendricks/colwerk/security/advisories/new) ("Report a
vulnerability"), with the version, the platform, the steps to reproduce and the impact you expect.

Once a fix is released, the advisory is published.

## Security model

Colwerk runs entirely on your machine. It has no telemetry, no analytics and no account. It only connects to the
databases you configure, to GitHub to check for updates, and to npm and DuckDB's extension repository when DuckDB or one
of its extensions is installed on first use.

- **Local server.** The server binds to `127.0.0.1` on a random port.
- **Session token.** Every `/api/*` request needs a random token created at each start (`x-colwerk-token`, compared in
  constant time). It travels in the URL fragment, which is not sent to the server or written to access logs.
- **Host and Origin checks.** Requests with a foreign `Host` or `Origin` header are rejected, against DNS rebinding and
  cross-site requests.
- **MCP token.** MCP clients authenticate with a token of their own (`Authorization: Bearer`), kept in the OS keychain
  or in `mcp-token` (mode 0600) in the data directory. MCP tools only run read-only queries.
- **Credentials.** Passwords are stored encrypted with AES-256-GCM. The key lives in the OS keychain, or in `secret.key`
  (mode 0600) when no keychain is available or `COLWERK_KEYCHAIN=off`.
- **Native code.** DuckDB's native addon is downloaded from npm on first use and checked against the integrity hash
  fixed at build time.
- **Releases.** Release files come with SHA-256 checksums (`SHA256SUMS.txt`) and build provenance attestations.

Out of scope: attackers who already run code as your user, or can read your data directory or the process environment
of the running server.
