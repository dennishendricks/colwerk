---
title: 'Parquet viewer: open Parquet files with SQL'
description: Open and view Parquet files with Colwerk, a free Parquet viewer for macOS, Windows and Linux. Query, filter and join Parquet, CSV, JSON and Excel with SQL.
---

Colwerk is a free, open-source Parquet viewer for macOS, Windows and Linux. It opens a Parquet file as a view in an
in-memory DuckDB database and shows its rows in a result grid, so you can sort and filter them or query the file with
SQL. The same SQL editor reads CSV, TSV, JSON, NDJSON and Excel files, on disk, on S3, on Google Cloud Storage or on
the web.

[Download Colwerk](/#download) · [Files and URLs](/docs/connections/files/)

## Open a Parquet file

- **Drop** the file onto the Colwerk window,
- choose **File → Query Data File …**, or
- on macOS and Linux, double-click it: Colwerk registers itself for CSV, TSV, Parquet, JSON and Excel files
  ([Install and update](/docs/start/install/#after-installing)).

The file opens in a new tab with `select * from "<view>"`, which runs right away. The view is named after the file:
`Sales 2026.parquet` becomes `sales_2026`. Files are read with the [DuckDB driver](/docs/connections/databases/#the-duckdb-driver)
that comes with Colwerk; nothing else needs to be installed.

For a file that is not on your computer, choose **File → Query URL …** and enter an `s3://`, `gs://` or `https://`
address. Private buckets and protected URLs take an S3 access key, a Google Cloud Storage HMAC key or an access token;
S3-compatible storage such as MinIO works through the **Endpoint** field.

## View the data

The [result grid](/docs/data/result-grid/) shows the rows:

- sort, pin, hide and filter columns, or filter all visible columns at once with **Filter result …**,
- double-click a cell to see the full value, with nested structs and arrays formatted as JSON,
- copy rows as JSON, CSV, Markdown or SQL `INSERT`.

Colwerk reads only up to the row limit of the tab (200 rows by default) and cancels the rest
([Row limit and timeout](/docs/editor/running-queries/#row-limit-and-timeout)).

## Query Parquet with SQL

Every file in a files connection is a view, so you can filter, aggregate and join it like a table:

```sql
select region, count(*), sum(amount)
from sales_2026
where order_date >= '2026-01-01'
group by region
order by 3 desc
```

Several files of different formats can sit in one files connection and be joined, for example a Parquet file with a CSV
lookup table. The **Files and URLs** field of the connection lists one path or URL per line; each becomes a view when
the connection opens. Queries use DuckDB's SQL.

## CSV, JSON and Excel

The same steps work for:

| Format | Extensions                             |
| ------ | -------------------------------------- |
| CSV    | `.csv`                                 |
| TSV    | `.tsv`, `.tab`                         |
| JSON   | `.json`, NDJSON as `.ndjson`, `.jsonl` |
| Excel  | `.xlsx`                                |

Text formats may be compressed with gzip or Zstandard.

## Convert and load

- **Export** a query result to Parquet, CSV, Excel, JSON, NDJSON, Markdown or SQL `INSERT`. **Full result (without
  limit)** writes every row, not only those shown ([Export results](/docs/data/export/)).
- **Import** a Parquet, CSV, JSON or Excel file into a table of PostgreSQL, MySQL/MariaDB, SQL Server, ClickHouse,
  DuckDB or SQLite with the import wizard ([Import data](/docs/data/import/)).
- For Parquet files in a data lake, Colwerk also reads [Delta Lake, Apache Iceberg and other lakehouses](/docs/connections/lakehouses/).

## On Mac, Windows and Linux

### Parquet viewer for Mac

Colwerk runs natively on Macs with Apple Silicon and installs signed updates itself. In the Finder, Colwerk is offered
to open CSV, TSV, Parquet, JSON and Excel files.

### Parquet viewer for Windows

On Windows (x64), Colwerk installs with a setup program and updates itself. It needs the WebView2 Runtime, which Windows
11 includes. Drop Parquet or CSV files onto the window or use **File → Query Data File …**; Windows does not offer
Colwerk for these file types.

### Parquet viewer for Linux

On Linux (x64 and arm64), Colwerk comes as a `.deb` package; the package manager installs WebKitGTK with it. New
versions are announced in the app and installed like any package. Like on the Mac, Colwerk is offered to open CSV, TSV,
Parquet, JSON and Excel files.

See [Install and update](/docs/start/install/) for downloads and requirements.

## Who it is for

Data engineers and analysts who receive Parquet or CSV exports and want to look at them, check them with SQL or load
them into a database, without writing a script or starting a notebook.

## Limits

- Tables you create in a files connection live in memory and are gone when Colwerk quits or the connection's settings
  change. The views over the files are created again.
- Excel `.xls` files cannot be read, only `.xlsx`.
- A files connection holds one set of credentials.
- macOS: Apple Silicon only. Linux: `.deb` packages only.

See [Known limitations](/docs/reference/limitations/).

## Questions

### How do I open a Parquet file?

Drop it onto the Colwerk window or choose **File → Query Data File …**. Colwerk opens it in a new tab and shows its
rows with `select * from` the file's view.

### Can I open a Parquet file on S3 without downloading it?

Yes. **File → Query URL …** reads `s3://`, `gs://` and `https://` addresses directly, with an access key, HMAC key or
token for private data.

### Can I convert Parquet to CSV or Excel?

Yes. Query the file, then save the result with the export bar as CSV, Excel or another format. Choose **Full result
(without limit)** to write every row.

## Get started

- [Download Colwerk](/#download)
- [Install and update](/docs/start/install/)
- [Files and URLs](/docs/connections/files/)
- [Export results](/docs/data/export/)
