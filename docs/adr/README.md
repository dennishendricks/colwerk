# Architecture Decision Records

Decisions that shape Colwerk's runtime, packaging and architecture, one file each in the format of Michael Nygard
(Status, Context, Decision, Consequences). An accepted record is not rewritten: a later record supersedes it and links
back.

| ADR                                       | Title                                               | Status                     |
| ----------------------------------------- | --------------------------------------------------- | -------------------------- |
| [0001](0001-deno-packaging.md)            | Package the app with Deno                           | Superseded by 0002, 0003   |
| [0002](0002-tauri-shell-node-sidecar.md)  | Tauri 2 shell with a Node single-executable sidecar | Superseded in part by 0003 |
| [0003](0003-bun-runtime-and-toolchain.md) | Bun as sidecar runtime and toolchain                | Accepted                   |
| [0004](0004-local-server-with-token.md)   | Local HTTP server with a per-start token            | Accepted                   |

New records take the next number. Write one when a change replaces a runtime, toolchain or packaging approach, or
changes how the parts of the app talk to each other.
