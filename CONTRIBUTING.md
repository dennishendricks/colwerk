# Contributing

Thanks for helping with Colwerk. Bug reports and pull requests are welcome; for larger changes, please open an issue
first, so we can agree on the approach before you write the code. Security issues go through [SECURITY.md](SECURITY.md),
not public issues.

## Setup

Requirements: Bun 1.4+, Docker (optional, for the test databases). For the desktop app also Rust (stable) and, on
Linux, Tauri's system packages (`libwebkit2gtk-4.1-dev libxdo-dev libssl-dev librsvg2-dev`).

```sh
bun install            # install dependencies
bun run hooks          # pre-commit hook: formats staged files with bun fmt
docker compose up -d   # test databases (Postgres, MariaDB, MSSQL, ClickHouse, Iceberg REST)
bun run dev            # dev server; prints the URL including the session token (--desktop: in the Tauri shell)
```

The [README](README.md#development) lists all commands and describes the architecture.

## Before you open a pull request

```sh
bun fmt --check        # formatting (settings in .editorconfig and bunfig.toml)
bun run lint
bun run typecheck
bun run test           # driver contract tests, API end-to-end test, SQL splitter tests
```

For changes in `src-tauri/` also run `cargo fmt --check` and `cargo clippy -- -D warnings` there. CI runs the same
checks.

Tests against Postgres, MariaDB, MSSQL, ClickHouse and the Iceberg REST catalog are skipped when their container is not
reachable, so start them with `docker compose up -d` when you touch a driver. A change to the SQL splitter
(`core/sql-split.ts`) needs tests for the dialect cases it affects: a wrong split runs the wrong statements.

## Drivers

A driver implements `Driver` in `core/drivers/<name>.ts`, is registered in `core/registry.ts` and is added to the
contract test in `tests/drivers.test.ts`. `connect()` must open exactly one connection (no pool), and `cancel()` must
work concurrently with `execute()`. Values follow the unified type model: `BIGINT`/`DECIMAL` as strings, timestamps
as ISO 8601, binary as `0x` hex.

## Commits and branches

- Branch from `main`: `feature/<topic>`, `fix/<topic>`, `refactor/<topic>`, `chore/<topic>` or `docs/<topic>`.
- Keep one topic per pull request, split into commits that each make sense on their own.
- Commit messages are English, in the imperative ("Add …", "Fix …"), with a short subject line.

## Releases

Maintainers release from a clean `main` that matches `origin/main`:

2. `bun run release` bumps the version in package.json, commits it and pushes the tag `v<version>`.
3. The release workflow builds and tests every target and creates a **draft** release with the packages, their
   checksums and build provenance attestations.
4. Check the draft and publish it on GitHub by hand. Only a published release is visible to the update check in the
   app.

## License

By contributing, you agree that your contributions are licensed under the [MIT license](LICENSE).
