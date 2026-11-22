import { maskLiterals, type SplitDialect, splitStatements } from './sql-split.ts'
import type { CellValue, ColumnInfo, ConnectionConfig, Dialect, IndexInfo, ResultColumn } from './types.ts'

/** Engines whose results can be edited: transactional DML (not ClickHouse, not the catalogs behind lakehouses). */
export const editDialects: Dialect[] = ['postgres', 'mysql', 'mssql', 'duckdb', 'sqlite']

/** Why the results of a connection cannot be edited, undefined if they can. The one place that decides it per connection. */
export function editBlocker(
  connection: Pick<ConnectionConfig, 'dialect' | 'readOnly'>,
): 'connection' | 'dialect' | undefined {
  if (connection.readOnly) return 'connection'
  if (!editDialects.includes(connection.dialect)) return 'dialect'
}

// Words that end the table reference, and words that make the query more than a plain read of one table.
const AFTER_TABLE = new Set(['where', 'order', 'limit', 'offset', 'fetch', 'for', 'option', 'qualify'])
const NOT_PLAIN = new Set(['distinct', 'union', 'intersect', 'except', 'group', 'having', 'window', 'join', 'into'])

function unquote(ident: string): string {
  const close = { '"': '"', '`': '`', '[': ']' }[ident[0]!]
  return close ? ident.slice(1, -1).replaceAll(close + close, close) : ident
}

/** The table of a plain single-table SELECT (no joins, grouping, set operations or derived tables), else undefined. */
export function singleTableSource(sql: string, dialect: SplitDialect): { schema?: string; name: string } | undefined {
  const ranges = splitStatements(sql, dialect)
  if (ranges.length !== 1) return
  const text = sql.slice(ranges[0]!.from, ranges[0]!.to)
  // On the masked text quoted identifiers are `___`, so `[\w$]+` matches them too; the names are read from `text`.
  const masked = maskLiterals(text, dialect).toLowerCase()
  // Depth-0 tokens only: what is inside parentheses (subqueries, function arguments) does not matter.
  const tokens: { word: string; at: number }[] = []
  let depth = 0
  for (const m of masked.matchAll(/[(),.]|[\w$]+/g)) {
    if (m[0] === ')') depth--
    else if (depth === 0) tokens.push({ word: m[0], at: m.index })
    if (m[0] === '(') depth++
  }
  const words = tokens.map((t) => t.word)
  const from = words.indexOf('from')
  if (
    words[0] !== 'select' ||
    from < 0 ||
    words.indexOf('from', from + 1) >= 0 ||
    words.some((w) => NOT_PLAIN.has(w))
  ) {
    return
  }
  const ident = (i: number) =>
    /^[\w$]/.test(words[i] ?? '') ? unquote(text.slice(tokens[i]!.at, tokens[i]!.at + words[i]!.length)) : undefined
  let i = from + 1
  const first = ident(i++)
  if (first === undefined) return
  let schema: string | undefined
  let name = first
  if (words[i] === '.') {
    const second = ident(i + 1)
    if (second === undefined) return
    ;[schema, name] = [first, second]
    i += 2
  }
  if (words[i] === 'as') {
    if (ident(i + 1) === undefined) return
    i += 2
  } else if (ident(i) !== undefined && !AFTER_TABLE.has(words[i]!)) i++
  if (i < words.length && !AFTER_TABLE.has(words[i]!)) return
  return schema === undefined ? { name } : { schema, name }
}

export interface EditColumn {
  name: string
  type: string
  nullable: boolean
}
export interface EditTarget {
  dialect: SplitDialect
  schema: string
  table: string
  /** Per result column: the table column it shows, undefined when it cannot be edited (expressions, binary, …). */
  columns: (EditColumn | undefined)[]
  /** Result column indexes of the primary or unique key. */
  key: number[]
}
export type EditBlock = 'connection' | 'dialect' | 'query' | 'view' | 'noKey' | 'keyMissing'

// Binary, geometry, collections, and types the database fills itself.
const READ_ONLY_TYPE =
  /\[\]$|^(list|struct|map|union)\b|geometry|geography|bytea|blob|binary|image|hierarchyid|sql_variant|rowversion/i
const readOnlyType = (type: string, dialect: SplitDialect) =>
  READ_ONLY_TYPE.test(type) || (dialect === 'mssql' && /^timestamp$/i.test(type))

/** Maps the result columns onto the table and picks its key; `columns` of `keyMissing` names the missing key columns. */
export function buildEditTarget(
  dialect: SplitDialect,
  schema: string,
  table: string,
  result: ResultColumn[],
  columns: ColumnInfo[],
  indexes: IndexInfo[],
): { target: EditTarget } | { block: 'noKey' } | { block: 'keyMissing'; columns: string[] } {
  const used = new Set<ColumnInfo>()
  const mapped = result.map((r): EditColumn | undefined => {
    const exact = columns.find((c) => c.name === r.name)
    const loose = columns.filter((c) => c.name.toLowerCase() === r.name.toLowerCase())
    const column = exact ?? (loose.length === 1 ? loose[0] : undefined)
    if (!column || used.has(column) || readOnlyType(column.type, dialect)) return undefined
    used.add(column)
    return { name: column.name, type: column.type, nullable: column.nullable }
  })
  const primary = columns.filter((c) => c.primaryKey)
  const unique = indexes
    .filter((x) => x.unique && !x.primary)
    .map((x) => x.columns.map((name) => columns.find((c) => c.name === name)))
    .find((cols) => cols.length && cols.every((c) => c && !c.nullable))
  const key = (primary.length ? primary : (unique as ColumnInfo[] | undefined)) ?? []
  if (!key.length || key.some((c) => readOnlyType(c.type, dialect))) return { block: 'noKey' }
  const indexesOfKey = key.map((c) => mapped.findIndex((m) => m?.name === c.name))
  const missing = key.filter((_, i) => indexesOfKey[i] === -1).map((c) => c.name)
  if (missing.length) return { block: 'keyMissing', columns: missing }
  return { target: { dialect, schema, table, columns: mapped, key: indexesOfKey } }
}

/** A changed or new value: a value, or the column's default. */
export type EditValue = { value: CellValue } | { default: true }
export interface Changes {
  /** Result row index → result column index → new value. */
  updated: Map<number, Map<number, EditValue>>
  /** New rows, a value per result column. */
  inserted: EditValue[][]
  /** Result row indexes. */
  deleted: Set<number>
}

/** Whether DEFAULT can be set in an existing row (UPDATE … SET c = DEFAULT); new rows can always use it. */
export const canUpdateToDefault = (dialect: SplitDialect) =>
  dialect === 'postgres' || dialect === 'mysql' || dialect === 'mssql'

/** Editor for a column type: boolean select, date input, multi-line text, or single-line text. */
export function editorKind(
  column: EditColumn,
  dialect: SplitDialect,
  text: string,
): 'boolean' | 'date' | 'long' | 'text' {
  if (/^bool(ean)?$/i.test(column.type) || (dialect === 'mssql' && /^bit$/i.test(column.type))) return 'boolean'
  if (/^date$/i.test(column.type)) return 'date'
  if (/json|text|clob|xml/i.test(column.type) || text.length > 100 || text.includes('\n')) return 'long'
  return 'text'
}

export function quoteIdent(name: string, dialect: SplitDialect): string {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`
  return `"${name.replaceAll('"', '""')}"`
}

// The session runs in UTC and MySQL rejects the T/Z form for DATETIME.
const ISO_TIMESTAMP = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d(?:\.\d+)?)Z?$/

export function sqlLiteral(value: CellValue, dialect: SplitDialect): string {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') {
    return dialect === 'mssql' || dialect === 'sqlite' ? (value ? '1' : '0') : value ? 'TRUE' : 'FALSE'
  }
  if (typeof value === 'number') return String(value)
  let text = typeof value === 'string' ? value : JSON.stringify(value)
  if (dialect === 'mysql') text = text.replace(ISO_TIMESTAMP, '$1 $2').replaceAll('\\', '\\\\')
  const quoted = `'${text.replaceAll("'", "''")}'`
  return dialect === 'mssql' ? `N${quoted}` : quoted
}

/** DELETEs, then UPDATEs, then INSERTs; exactly the statements that are executed. */
export function editStatements(target: EditTarget, rows: CellValue[][], changes: Changes): string[] {
  const { dialect, columns } = target
  const q = (name: string) => quoteIdent(name, dialect)
  const into = `${q(target.schema)}.${q(target.table)}`
  const value = (v: EditValue) => ('default' in v ? 'default' : sqlLiteral(v.value, dialect))
  const where = (row: number) =>
    target.key.map((c) => `${q(columns[c]!.name)} = ${sqlLiteral(rows[row]![c] ?? null, dialect)}`).join(' and ')
  const byIndex = (a: number, b: number) => a - b

  const statements = [...changes.deleted].sort(byIndex).map((row) => `delete from ${into} where ${where(row)}`)
  for (const row of [...changes.updated.keys()].sort(byIndex)) {
    const cells = [...changes.updated.get(row)!].sort(([a], [b]) => a - b)
    if (changes.deleted.has(row) || !cells.length) continue
    const set = cells.map(([c, v]) => `${q(columns[c]!.name)} = ${value(v)}`).join(', ')
    statements.push(`update ${into} set ${set} where ${where(row)}`)
  }
  for (const row of changes.inserted) {
    const cells = row.flatMap((v, c) =>
      columns[c] && !('default' in v) ? [[q(columns[c].name), value(v)] as const] : [],
    )
    statements.push(
      cells.length
        ? `insert into ${into} (${cells.map(([name]) => name).join(', ')}) values (${cells.map(([, v]) => v).join(', ')})`
        : dialect === 'mysql'
          ? `insert into ${into} () values ()`
          : `insert into ${into} default values`,
    )
  }
  return statements
}
