---
title: Lakehouses
description: Query Apache Iceberg, Delta Lake, Databricks Unity Catalog and Microsoft Fabric OneLake with Colwerk.
sidebar:
  order: 3
---

Colwerk reads lakehouses through DuckDB. Each lakehouse connection is an in-memory DuckDB database with the extensions
of its format; queries are written in DuckDB's SQL. The first connection of a kind downloads the extensions it needs
for the included [DuckDB driver](/docs/connections/databases/#the-duckdb-driver).

Lakehouse connections have no TLS switch: the URL decides (`https://`). Writing statements depend on what the format
and catalog allow; mark the connection read-only to have Colwerk refuse them.

## Apache Iceberg (REST catalog)

| Field          | Notes                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Catalog URL    | The REST catalog, e.g. Apache Polaris, Lakekeeper or Nessie.             |
| Warehouse      | As configured in the catalog.                                            |
| Authentication | OAuth2 client credentials (client ID and secret), access token, or none. |

Under More options: the **Token endpoint** (empty: catalog URL + `/v1/oauth/tokens`) and the **Scope**, e.g.
`PRINCIPAL_ROLE:ALL` for Apache Polaris. The catalog is attached as database `iceberg`; its namespaces are the schemas.

## Delta Lake (folder)

**Folder**: the absolute path of a folder with Delta tables (subfolders with `_delta_log`), or of a single table. Each
table becomes a view in schema `main`.

## Databricks Unity Catalog

| Field         | Notes                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| Workspace URL | e.g. `https://adb-1234567890123456.7.azuredatabricks.net`.              |
| Catalog       | The default catalog; the others can be selected in the database picker. |
| Access token  | e.g. a Databricks personal access token.                                |

Under More options: the **AWS region** of the S3 storage (not needed on Azure and Google Cloud).

## Microsoft Fabric OneLake

| Field          | Notes                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| Workspace      | Name or ID of the Fabric workspace.                                                    |
| Lakehouse      | The default lakehouse; the others can be selected in the database picker.              |
| Authentication | One of the Microsoft Entra logins (see [Logins](/docs/connections/databases/#logins)). |

The Delta tables under `Tables/` become views. Lakehouses with schemas show `Tables/<schema>/<table>` as schemas.
