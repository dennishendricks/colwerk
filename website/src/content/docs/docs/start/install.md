---
title: Install and update
description: Download Colwerk for macOS, Windows or Linux, verify the download, and keep it up to date.
sidebar:
  order: 2
---

## Download

Get the latest version from [GitHub Releases](https://github.com/dennishendricks/colwerk/releases/latest):

| System  | Architecture  | File                                      |
| ------- | ------------- | ----------------------------------------- |
| macOS   | Apple Silicon | `Colwerk-<version>-macos-arm64.dmg`       |
| Windows | x64           | `Colwerk-<version>-windows-x64-setup.exe` |
| Linux   | x64           | `Colwerk-<version>-linux-x64.deb`         |
| Linux   | arm64         | `Colwerk-<version>-linux-arm64.deb`       |

Requirements:

- **Windows** needs the WebView2 Runtime. Windows 11 includes it, and most Windows 10 devices already have it. The
  installer does not install it; if it is missing, download it from
  [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/consumer/).
- **Linux** needs WebKitGTK 4.1; the package manager installs it with the `.deb`.

## Verify the download

Every release lists the checksums of all files in `SHA256SUMS.txt`, a software bill of materials of the npm packages
and Rust crates (`Colwerk-<version>.cdx.json`, CycloneDX) and build provenance attestations from GitHub Actions. With
the GitHub CLI:

```sh
gh attestation verify Colwerk-<version>-macos-arm64.dmg --repo dennishendricks/colwerk
```

## After installing

Colwerk registers itself for `.sql` files, SQL Server execution plans (`.sqlplan`) and DuckDB and SQLite databases
(`.duckdb`, `.sqlite`, `.sqlite3`). On macOS and Linux it is also offered for CSV, TSV, Parquet, JSON and Excel files.
Double-click such a file to [open it in Colwerk](/docs/editor/tabs/#files). If Colwerk is already running, its window
comes to the front instead of a second instance starting.

## Updates

Colwerk checks for a new version each time it starts, and on demand with **Colwerk → Check for Updates …**.

- **macOS and Windows** install updates themselves: click **Install and Restart** in the notice. The update packages
  are signed, and Colwerk checks the signature before installing.
- **Linux (.deb)** shows a notice with a **Download** link to the release page; install the new package as usual.

After an update, Colwerk shows the release notes of the new version once. **Help → Release Notes** opens them again,
and the [changelog](/changelog/) lists the notes of every version.

The update check contacts GitHub only. Without a network connection it fails silently, unless you started it yourself.
