---
title: Mask personal data
description: Mask columns with personal data (PII) in exports and in the answers to AI assistants, with editable patterns for column names.
sidebar:
  order: 4
---

Colwerk can mask columns with personal data, such as email addresses, names or IBANs, in two places:

- in **exports**, when you choose **Mask PII** in the export bar,
- in the answers to **AI assistants** ([MCP](/docs/mcp/)), on by default for every connection.

The result grid always shows the real values. Masked columns have a shield icon in their header, and editing them in the
grid writes the values you type, never a masked value.

## Patterns

Which columns are masked depends on their name. Open **Settings → PII masking** to see the patterns. Each pattern is a
regular expression on the column name in lower case, with camelCase and other separators written as snake_case
(`firstName` is tested as `first_name`, `E-Mail` as `e_mail`). The first matching pattern decides the masking; your own patterns are checked before the built-in ones.

| Built-in pattern                    | Examples                                                                                | Masking |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ------- |
| Email address                       | `email`, `E-Mail`, `customerEmail`, `mail`                                              | Partly  |
| Phone number                        | `phone`, `telefon`, `telnr`, `mobilnummer`, `mobil_1`, `fax1`                           | Partly  |
| First and last name                 | `first_name`, `nachname`, `familienname`, `username`, `kontoinhaber`                    | Replace |
| IP and device addresses             | `ip`, `ip_address`, `mac_address`, `device_id`, `imei`                                  | Hash    |
| Street and address                  | `street`, `strasse`, `address`, `adresszusatz`, `hausnr`                                | Replace |
| Postal code                         | `zip`, `postal_code`, `plz`, `postleitzahl`                                             | Replace |
| Date of birth                       | `birth_date`, `dob`, `geburtsdatum`, `geb_dat`, `gebtag`                                | Replace |
| Bank, card and credit data          | `iban`, `blz`, `card_number`, `cvv`, `kredit`, `credit_limit`                           | Partly  |
| ID, tax and social security numbers | `ssn`, `steuernummer`, `svnr`, `versichertennummer`, `fuehrerschein`, `kfz_kennzeichen` | Replace |
| Gender, religion, health and origin | `geschlecht`, `konfession`, `staatsangehoerigkeit`, `krankenkasse`, `diagnose`          | Replace |
| Passwords, tokens and keys          | `password`, `kennwort`, `pin`, `api_key`, `token`                                       | Empty   |
| Coordinates (off by default)        | `latitude`, `lng`, `geo_location`                                                       | Replace |
| Column `name` (off by default)      | `name`                                                                                  | Replace |

Coordinates and the column `name` are off by default because they often describe things rather than people, such as
the location of a store or the name of a product. You can switch each pattern on or off or change its masking. Below the list, add patterns of your own, for example
`kunden_?nr` for customer numbers. The patterns are kept in `settings.json` in the
[data directory](/docs/reference/data-directory/).

## Masking

| Masking | Result                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace | `***`                                                                                                                                                                     |
| Partly  | Email addresses keep the first letter and the domain (`j***@example.com`), other values the last 4 characters (`***3000`); values shorter than 8 characters become `***`. |
| Hash    | A 16-character hash. The same value always gets the same hash, so joins across exported tables still work.                                                                |
| Empty   | `NULL`                                                                                                                                                                    |

`NULL` stays `NULL`. A masked column is written as text, except with **Empty**. In JSON values and structs, keys that
match a pattern are masked too, at any depth. PostgreSQL rows selected as one value (`select c from customers c`) are
always replaced.

The hash is keyed with a secret derived from Colwerk's key in the OS keychain, so it cannot be reversed by hashing
known values, and it is the same on every export from this computer. Hashed data counts as pseudonymized, not
anonymized: for an anonymous export, use **Replace** or **Empty**.

## Columns of a connection

Some columns need a decision per database. In the connection dialog, under **Advanced**:

- **Always mask**: columns masked in addition to the patterns, as `column`, `table.column` or `schema.table.column`.
- **Never mask**: columns a pattern matches by mistake.

The column menu in the result grid does the same with one click: **Mask column** or **Do not mask column** adds the
column name to one of these lists, without reconnecting.

A query result does not tell which table a column comes from. Where the table is unknown, a qualified entry of
**Always mask** applies to every column of that name, and a qualified entry of **Never mask** applies to none. The
`sample-rows` and `describe-table` tools of MCP know the table, so qualified entries apply there exactly.

## Exports

Turn on **Mask PII** in the export bar before **Save as …**. The tooltip of the checkbox lists the columns that will
be masked, and the message after saving names the masked columns. Masking applies to every format and to both the
shown rows and the full result. **Copy as** copies the values unmasked.

## AI assistants

With **Mask PII for AI assistants** on (connection dialog, **Advanced**), Colwerk masks the answers of `run-query` and
`sample-rows`, and `describe-table` marks masked columns with `masked: true`. `run-query` refuses a query that names a
masked column anywhere, in the column list, in `WHERE`, `JOIN` or `ORDER BY`, so the assistant cannot get at the values
through aliases, expressions or filters. It also refuses functions that turn whole rows into one value, such as
`row_to_json` or `FOR JSON`. The [audit log](/docs/mcp/audit-log/) records which columns were masked.

:::caution
The check reads the query's text; it is not a guarantee. If personal data must not reach an assistant under any
circumstances, give MCP [a login of its own](/docs/mcp/#a-login-of-its-own) without permissions on these columns, for
example with column privileges or a view.
:::

## Performance

Masking runs while the rows are written. On a typical computer, 100,000 rows with five masked columns take about
0.1 seconds, most of it for the hash; without hashed columns it is a few hundredths of a second. Columns without a
match cost almost nothing.
