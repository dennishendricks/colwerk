// SQL text of identifiers and values in a dialect, for generated statements (INSERT export, data import). Values
// follow the unified value model (see `CellValue`); `type` is the column's type name as the driver reports it and
// decides whether a numeric, hex or timestamp string becomes a number, binary or timestamp literal.
import type { SplitDialect } from './sql-split.ts'
import type { CellValue } from './types.ts'

/** Quoted identifier; always quoted, so reserved words and any case survive. */
export function quoteIdent(dialect: SplitDialect, name: string): string {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`
  if (dialect === 'clickhouse') return `"${name.replace(/[\\"]/g, '\\$&')}"`
  return `"${name.replaceAll('"', '""')}"`
}

/** `schema.table` (any number of parts), each part quoted. */
export const qualifiedName = (dialect: SplitDialect, parts: string[]) =>
  parts.map((p) => quoteIdent(dialect, p)).join('.')

/** MySQL and ClickHouse treat the backslash as escape character in strings; SQL Server needs N'' for Unicode. */
export function stringLiteral(dialect: SplitDialect, value: string): string {
  if (dialect === 'mysql' || dialect === 'clickhouse') return `'${value.replace(/[\\']/g, '\\$&')}'`
  return `${dialect === 'mssql' ? 'N' : ''}'${value.replaceAll("'", "''")}'`
}

// Wrappers of ClickHouse types (`Nullable(Int32)`) are skipped.
const WRAPPED = /^(?:(?:nullable|lowcardinality)\()*/i
const NUMERIC_TYPE =
  /^(?:u?int\d*|tinyint|smallint|mediumint|bigint|integer|hugeint|uhugeint|ubigint|uinteger|usmallint|utinyint|decimal|numeric|dec|float\d*|double|real|money|smallmoney)\b/i
const BINARY_TYPE = /^(?:bytea|blob|tinyblob|mediumblob|longblob|binary|varbinary|image)\b/i
const TEMPORAL_TYPE = /date|time/i
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
const HEX = /^0x(?:[0-9a-f]{2})*$/i
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/

/** Literal of `value` for a column of `type` (empty: unknown type, numbers and binary stay strings). */
export function sqlLiteral(dialect: SplitDialect, value: CellValue, type = ''): string {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return dialect === 'mssql' ? (value ? '1' : '0') : value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return String(value)
  // Arrays, structs and maps as JSON text: fits JSON columns, other types may need a cast.
  if (typeof value === 'object') return stringLiteral(dialect, JSON.stringify(value))
  const t = type.replace(WRAPPED, '')
  if (NUMERIC_TYPE.test(t) && NUMBER.test(value)) return value
  if (BINARY_TYPE.test(t) && HEX.test(value)) return binaryLiteral(dialect, value.slice(2))
  const ts = TEMPORAL_TYPE.test(t) ? value.match(TIMESTAMP) : null
  if (ts) return timestampLiteral(dialect, value, ts[1]?.length ?? 0)
  return stringLiteral(dialect, value)
}

function binaryLiteral(dialect: SplitDialect, hex: string): string {
  if (dialect === 'postgres') return `'\\x${hex}'::bytea`
  if (dialect === 'mysql' || dialect === 'sqlite') return `X'${hex}'`
  if (dialect === 'mssql') return `0x${hex}`
  return `unhex('${hex}')`
}

// ClickHouse parses the ISO form with its zone itself; MySQL wants UTC without zone (Colwerk's MySQL sessions run
// with time_zone '+00:00', TIMESTAMP values arrive with `Z`). The others accept ISO 8601 as it is.
function timestampLiteral(dialect: SplitDialect, value: string, digits: number): string {
  if (dialect === 'clickhouse') {
    return `parseDateTime64BestEffort(${stringLiteral(dialect, value)}, ${Math.min(digits, 9)})`
  }
  if (dialect === 'mysql') return stringLiteral(dialect, utcText(value))
  return stringLiteral(dialect, value)
}

/** `2024-01-02T03:04:05.123456+01:00` → `2024-01-02 02:04:05.123456` (UTC, without zone). */
function utcText(value: string): string {
  const [, base = '', frac, zone] = value.match(/^(.*?:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/) ?? []
  const shifted = zone && zone !== 'Z' ? new Date(`${base}${zone}`).toISOString().slice(0, 19) : base
  return `${shifted.replace('T', ' ')}${frac ? `.${frac}` : ''}`
}

/** Rows a single INSERT … VALUES may hold (SQL Server: 1000 row constructors). */
export const maxInsertRows = (dialect: SplitDialect) => (dialect === 'mssql' ? 1000 : Infinity)

/** One INSERT of `rows`, whose values are in the order of `columns`; without trailing semicolon. */
export function insertSql(
  dialect: SplitDialect,
  table: string[],
  columns: { name: string; type: string }[],
  rows: CellValue[][],
): string {
  const values = rows.map((row) => `(${columns.map((c, i) => sqlLiteral(dialect, row[i] ?? null, c.type)).join(', ')})`)
  return `insert into ${qualifiedName(dialect, table)} (${columns.map((c) => quoteIdent(dialect, c.name)).join(', ')}) values\n  ${values.join(',\n  ')}`
}
