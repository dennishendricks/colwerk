# Colwerk: notes for coding agents

Database workbench: Nuxt 4 SPA (Nuxt UI 4, CodeMirror 6) + Nitro server on Bun, packaged as a single-file binary and
as a Tauri 2 desktop shell. This file replaces the README for agents: read the README only for the section a task
needs (`grep -n '^#' README.md`, then read that range).

## Where things are

Each source directory has a generated file index (`core/CLAUDE.md`, `server/CLAUDE.md`, `app/CLAUDE.md`, one line per
file). Use it instead of listing directories or opening files to find your way.

- `core/`: runtime-agnostic TypeScript on `node:` APIs (drivers, sessions, export, import, compare, store, secrets).
  No Nuxt dependencies. Public API in `core/index.ts`, imported elsewhere as `#core`.
- `server/`: thin Nitro layer (security middleware, `/api/*` routes, MCP tools in `server/mcp/`). No database logic.
- `app/`: Nuxt UI frontend, talks to `/api/*` only. Tauri menus and dialogs through `app/utils/desktop.ts`.
- `launcher/`: entry point of the server binary, MCP stdio bridge. `scripts/`: dev server, packaging, release.
- `src-tauri/`: Rust desktop shell, starts the server binary as sidecar.
- `tests/`: `bun test`, one `<topic>.test.ts` per module; driver contract tests in `tests/drivers.test.ts`.
- `website/`: colwerk.app and the documentation (Astro Starlight), with its own `package.json`; check with
  `bun run build` there. Goes live only with the next published release (`.github/workflows/website.yml`).
  Pages in `website/src/content/docs/docs/`; a user-facing change updates them (`.github/workflows/docs.yml` fails
  otherwise, unless the PR has the label `no_docs`). Engines, shortcuts (`app/utils/shortcuts.ts`), limits and MCP
  tools reach the reference pages through `website/src/data/reference.json`, written by `bun run docs-data`.
- `i18n/locales/{en,de}.json`: UI strings, about 45 KB each. Never read them whole: grep for the key, read around the
  line number, and add every key to both files.

## Rules

- One session (database connection) per editor tab; introspection uses a separate metadata session per connection.
- Unified value model: `BIGINT`/`DECIMAL` as strings, timestamps as ISO 8601, binary as `0x` hex, the rest as JSON.
- A driver implements `Driver` in `core/drivers/<name>.ts`, is registered in `core/registry.ts` and added to
  `tests/drivers.test.ts`. `connect()` opens exactly one connection (no pool); `cancel()` works during `execute()`.
- A change to `core/sql-split.ts` needs tests for the dialect cases it affects.
- Code style: no semicolons, single quotes, 120 columns. Comments and commit messages in English; commit subjects in
  the imperative ("Add …", "Fix …").

## Commands

- Single test file: `bun test tests/<name>.test.ts` (prefer this over the whole suite). Database tests are skipped
  unless `docker compose up -d` runs.
- `bun run typecheck`, `bun run lint`; Rust: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`.
- No need to run `bun fmt`: the pre-commit hook formats staged files and updates the file indexes
  (`bun run agent-docs`). CI fails on outdated indexes.

## Saving tokens

- Files marked **KB** in the file indexes are large: grep first, then read only the relevant range.
- Do not open `bun.lock`, `src-tauri/Cargo.lock` or build output (`.nuxt/`, `.output/`, `dist/`, `src-tauri/target/`).
- Hand broad searches across many files to a search subagent and keep only its conclusion.
- New source files start with a one-line `//` comment saying what they do; the file index shows it.
