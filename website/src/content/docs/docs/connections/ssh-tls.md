---
title: SSH tunnel and TLS
description: Reach a database through an SSH server and encrypt connections with TLS in Colwerk.
sidebar:
  order: 5
---

Both settings are available for PostgreSQL, MySQL/MariaDB, SQL Server and ClickHouse, under **More options** in the
connection dialog.

## SSH tunnel

Turn on **SSH tunnel** to reach the database through an SSH server. Host and port of the connection are then resolved
on the SSH server. A tunnel cannot be combined with a Unix socket or a named instance.

| Field     | Notes                                    |
| --------- | ---------------------------------------- |
| SSH host  | Required.                                |
| SSH port  | Default 22.                              |
| SSH user  | Required.                                |
| SSH login | Password, private key file or SSH agent. |

- **Password**: also answered when the server asks through keyboard-interactive (PAM).
- **Private key file**: e.g. `~/.ssh/id_ed25519`, with an optional passphrase.
- **SSH agent**: uses the agent from `SSH_AUTH_SOCK`; on Windows the OpenSSH agent. Pageant is not supported.

The SSH password or passphrase can come from a [password manager](/docs/connections/passwords/).

### Host key

Colwerk records the SSH server's host key on the first successful connect (not on **Test**) and refuses a different key
afterwards. The recorded fingerprint is shown in the dialog. If the key changed on purpose, click **Forget host key**.
Changing the SSH host or port forgets it automatically.

All sessions of a connection share one tunnel. It is closed with the last session and opened again when needed.

## TLS

Turn on **Use TLS** to encrypt the connection. Under More options:

- **CA certificate**: a PEM file, e.g. for self-signed servers. Empty: the system's certificate authorities.
- **Don't verify certificate**: encrypted, but without protection against man-in-the-middle attacks. Use it only for
  testing.

SQL Server also offers:

- **Host name in certificate**: when you connect through an IP address or alias while the certificate is issued for
  another name.
- **Strict encryption (TDS 8.0)**: TLS before the login, as required by SQL Server 2022 with "Force Strict Encryption".
