---
title: Passwords and password managers
description: How Colwerk stores passwords, and how to read them from 1Password, Bitwarden, Bitwarden Secrets Manager or KeePassXC instead.
sidebar:
  order: 6
---

## Stored passwords

By default Colwerk stores passwords, client secrets, tokens and SSH passphrases encrypted with AES-256-GCM. The key
lives in the operating system's keychain (macOS Keychain, Windows Credential Manager, libsecret on Linux). More in
[Security and privacy](/docs/reference/security/).

## Password managers

Instead of storing a secret, Colwerk can read it from a password manager on every connect. Choose the **Source** next to
the password field (also for the SSH password or passphrase). Colwerk stores only the reference; the secret stays in
memory and is never written to disk, so a rotated password is picked up at the next connect.

| Source                    | Reference                                               | CLI             |
| ------------------------- | ------------------------------------------------------- | --------------- |
| 1Password                 | Secret reference `op://vault/item/field`                | `op`            |
| Bitwarden                 | Item ID and field                                       | `bw`            |
| Bitwarden Secrets Manager | Secret ID                                               | `bws`           |
| KeePassXC                 | Database file, entry path, attribute, optional key file | `keepassxc-cli` |

The CLI must be installed. Colwerk looks for it on the `PATH` and in `/opt/homebrew/bin`, `/usr/local/bin`,
`/Applications/KeePassXC.app/Contents/MacOS` and `%ProgramFiles%\KeePassXC`. On Windows only `.exe` files work, not
npm's `bw.cmd`.

### 1Password

In 1Password, choose **Copy Secret Reference** on the field and paste it. Colwerk signs in through the 1Password app
(turn on its CLI integration) or `OP_SERVICE_ACCOUNT_TOKEN`. The app may ask you to confirm the access.

### Bitwarden

Enter the item ID (`bw list items`) and the field: `password`, `username`, `notes` or the name of a custom field. Log in
once with `bw login` in a terminal. When the vault is locked, Colwerk asks for the master password and keeps only the
session key in memory; an inherited `BW_SESSION` works too. `bw` reads its local copy: Colwerk syncs once after
unlocking, run `bw sync` to pick up later changes.

### Bitwarden Secrets Manager

Enter the secret ID. Colwerk asks for the access token of a machine account and keeps it in memory until it quits; an
inherited `BWS_ACCESS_TOKEN` works too.

### KeePassXC

Enter the database file (e.g. `~/Passwords.kdbx`), the path of the entry (e.g. `Databases/Production`), the attribute
(default `Password`) and, if used, the key file. Colwerk asks for the master password once and keeps it in memory until
it quits. Leave it empty if the database is protected by the key file only.

### Unlocking

When a vault is locked, Colwerk shows **Unlock** with a field for the master password or access token. After unlocking,
run the action again.
