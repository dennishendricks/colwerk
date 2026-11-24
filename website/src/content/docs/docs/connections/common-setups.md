---
title: Common setups
description: Step-by-step settings for typical connections in Colwerk, and the names other tools use for the same options.
sidebar:
  order: 8
---

The fields themselves are described under [Databases](/docs/connections/databases/) and
[SSH tunnel and TLS](/docs/connections/ssh-tls/). This page shows how they combine for typical cases.

## SQL Server in a Windows domain

A server in the company network with a named instance, a domain login and a self-signed certificate, written as
`10.0.0.5\SQLERP` and `CORP\jdoe` in other tools.

1. **Host**: `10.0.0.5\SQLERP`, or `10.0.0.5` with **Named instance** `SQLERP` under More options. Colwerk splits the
   first form itself on Test and Save. Leave the port empty: the SQL Server Browser reports it.
2. **Authentication**: **Windows (NTLM)**, with **Domain** `CORP`, user `jdoe` and the Windows password. Entering
   `CORP\jdoe` as user with the login **User and password** does the same: Colwerk switches to Windows (NTLM) and fills
   in the domain.
3. **Use TLS** on, and under More options either a **CA certificate** (the PEM file of your company CA) or **Don't
   verify certificate**. The latter is what other tools call **Trust Server Certificate**.

If the connection fails:

- **Timeout or "instance not found"**: the SQL Server Browser is not running or UDP port 1434 is blocked. Ask for the
  instance's TCP port and enter it as **Port** instead of the named instance.
- **Certificate error** (e.g. "self-signed certificate"): the server enforces encryption with a certificate your system
  does not trust. Set a CA certificate or turn on Don't verify certificate.
- **Login failed**: the domain is usually the short (NetBIOS) name, e.g. `CORP` rather than `corp.example.com`.

## SQL Server behind an SSH server

An SSH tunnel cannot look up a named instance, because the lookup runs over UDP. Enter the instance's fixed TCP port
instead. To find it, run this in a session that is already connected, e.g. in SQL Server Management Studio:

```sql
select local_tcp_port from sys.dm_exec_connections where session_id = @@spid
```

Host and port are then resolved on the SSH server, so `localhost` means the SSH server itself.

## Azure SQL Database

1. **Host**: `myserver.database.windows.net`, port 1433.
2. **Use TLS** on. Azure's certificates are signed by public CAs, so no further TLS setting is needed.
3. **Authentication**: **User and password** for SQL logins, or one of the Microsoft Entra logins.
4. Optional, under More options: **Connection attempts** for serverless databases that need a moment to resume, and
   **Request read-only access** for read-only replicas.

## PostgreSQL and MySQL in the cloud

Managed databases (Amazon RDS, Azure Database, Google Cloud SQL) usually require TLS.

1. **Use TLS** on.
2. **CA certificate**: the provider's CA bundle as a PEM file. Without it, the certificate check fails for providers
   whose CA is not in your system's trust store.
3. Only to try out a connection: **Don't verify certificate** instead of the CA file.

## Names in other tools

| Other tools                                                        | Colwerk                                           |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| `Server=host\instance`, Host `host\instance`                       | Host and **Named instance** (split automatically) |
| `Server=host,1433`                                                 | Host and **Port**                                 |
| `DOMAIN\user`, Integrated Security, Windows authentication         | **Windows (NTLM)** with domain, user and password |
| `Encrypt=True`, `Encrypt=Mandatory`                                | **Use TLS**                                       |
| `Encrypt=Strict`                                                   | **Use TLS** and **Strict encryption (TDS 8.0)**   |
| `TrustServerCertificate=True`                                      | **Use TLS** and **Don't verify certificate**      |
| `HostNameInCertificate=…`                                          | **Host name in certificate**                      |
| `ApplicationIntent=ReadOnly`                                       | **Request read-only access**                      |
| `MultiSubnetFailover=True`                                         | **MultiSubnetFailover**                           |
| PostgreSQL `sslmode=require`                                       | **Use TLS** and **Don't verify certificate**      |
| PostgreSQL `sslmode=verify-full`, MySQL `ssl-mode=VERIFY_IDENTITY` | **Use TLS**, optionally with a **CA certificate** |
| `sslrootcert=…`, `ssl-ca=…`                                        | **CA certificate**                                |

Windows (NTLM) needs a password: Colwerk cannot sign in with the current Windows session (Kerberos single sign-on).
To take over connections from other tools in one go, see [Import connections](/docs/connections/import/).
