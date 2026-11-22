---
title: Files and URLs
description: Query CSV, TSV, Parquet, JSON and Excel files on disk, S3, Google Cloud Storage or the web with SQL in Colwerk.
sidebar:
  order: 4
---

Colwerk queries data files with DuckDB. Each file or URL becomes a view in an in-memory DuckDB database, the files
connection, ready to query and join with SQL.

Supported formats: CSV, TSV (`.tsv`, `.tab`), Parquet, JSON, NDJSON (`.ndjson`, `.jsonl`) and Excel (`.xlsx`, not
`.xls`). Text formats may be compressed with gzip (`.gz`) or Zstandard (`.zst`).

## Query a file

- **Drop** files onto the Colwerk window, or
- choose **File → Query Data File …**, or
- choose **File → Query URL …** for a file on S3 (`s3://`), Google Cloud Storage (`gs://`) or a web server
  (`https://`).

Each file opens in a new tab with `select * from "<view>"`, which runs right away. Colwerk adds the files to the files
connection of the current tab, otherwise to the first files connection, otherwise to a new one named **Files**. The
first time, Colwerk asks to download the [DuckDB driver](/docs/connections/databases/#the-duckdb-driver).

The view name is the file name without extension, in lower case, with other characters replaced by `_` (a leading
digit gets the prefix `t_`, duplicates get `_2`, `_3` …).

## The files connection

Like any connection, a files connection can be edited. Its **Files and URLs** field lists one absolute path or URL per
line; each becomes a view when the connection opens.

To read private buckets or protected URLs, choose an **Authentication**:

| Option                        | Fields                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------- |
| None                          |                                                                               |
| S3 access key                 | Access key ID, secret access key, AWS region (default `us-east-1`), endpoint. |
| Google Cloud Storage HMAC key | HMAC key ID and secret.                                                       |
| Access token                  | Sent as bearer token to `https://` sources.                                   |

The **Endpoint** points to S3-compatible storage such as MinIO (`minio.example.com:9000`); empty means AWS. A files
connection holds one set of credentials.

:::note
Tables you create in a files connection live in memory and are gone when Colwerk quits or the connection's settings
change. The views over the files are created again.
:::

To load a file into a database table instead, use the [data import](/docs/data/import/).
