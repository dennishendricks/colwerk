// SQL of data imports per target dialect: column types translated from the source, CREATE TABLE, the load
// strategies and transactions. Pure, so the wizard shows the same DDL the server runs.
import type { SplitDialect } from './sql-split.ts'
import { AppError, type CellValue } from './types.ts'
import { insertSql, qualifiedName, quoteIdent, sqlLiteral } from './sql-literals.ts'

export type ImportStrategy = 'append' | 'truncate' | 'upsert'
export interface TargetColumn {
  name: string
  type: string
}

export type Canonical =
  | {
      kind:
        | 'boolean'
        | 'smallint'
        | 'integer'
        | 'bigint'
        | 'real'
        | 'double'
        | 'date'
        | 'time'
        | 'timestamp'
        | 'timestamptz'
        | 'uuid'
        | 'json'
        | 'binary'
    }
  | { kind: 'decimal'; precision?: number; scale?: number }
  | { kind: 'text'; length?: number }

const WRAPPER = /^(?:nullable|lowcardinality)\((.*)\)$/i
const HUGE: Canonical = { kind: 'decimal', precision: 38, scale: 0 }

function clickhouseType(t: string): Canonical | undefined {
  if (/^U?Int(?:8|16)$/.test(t)) return { kind: 'smallint' }
  if (t === 'Int32') return { kind: 'integer' }
  if (t === 'UInt32' || t === 'Int64') return { kind: 'bigint' }
  if (/^U?Int(?:64|128|256)$/.test(t)) return HUGE
  if (t === 'Float32') return { kind: 'real' }
  if (t === 'Float64') return { kind: 'double' }
  const decimal = t.match(/^Decimal(?:\d+)?\((\d+)\s*,\s*(\d+)\)$/)
  if (decimal) return { kind: 'decimal', precision: Number(decimal[1]), scale: Number(decimal[2]) }
  if (t === 'Bool') return { kind: 'boolean' }
  if (t === 'Date' || t === 'Date32') return { kind: 'date' }
  if (t.startsWith('DateTime')) return { kind: 'timestamptz' }
  if (t === 'UUID') return { kind: 'uuid' }
  if (t === 'String') return { kind: 'text' }
  const fixed = t.match(/^FixedString\((\d+)\)$/)
  if (fixed) return { kind: 'text', length: Number(fixed[1]) }
  if (/^(?:Array|Tuple|Map)\(/.test(t)) return { kind: 'json' }
}

/** The dialect-independent type of a column type as the `source` dialect's driver reports it. */
export function canonicalType(type: string, source: SplitDialect): Canonical {
  let name = type.trim()
  for (let m = name.match(WRAPPER); m; m = name.match(WRAPPER)) name = m[1]!
  const clickhouse = source === 'clickhouse' ? clickhouseType(name) : undefined
  if (clickhouse) return clickhouse
  const t = name.toLowerCase()
  const w = '(?:\\(\\d+\\))?'
  const is = (pattern: string) => new RegExp(`^(?:${pattern})${w}$`).test(t)
  if (t === 'tinyint(1)' || is('bool|boolean|bit')) return { kind: 'boolean' }
  if (/\[\]|struct\(|map\(|list|union\(/.test(t) || t === 'json' || t === 'jsonb') return { kind: 'json' }
  if (is('tinyint|smallint|int2|tiny|short|utinyint')) return { kind: 'smallint' }
  if (is('int|integer|int4|int24|mediumint|long|year|usmallint')) return { kind: 'integer' }
  if (is('bigint|longlong|uinteger') || (is('int8') && source !== 'clickhouse')) return { kind: 'bigint' }
  if (is('hugeint|uhugeint|ubigint')) return HUGE
  const decimal = t.match(/^(?:decimal|numeric|newdecimal)(?:\((\d+)(?:,\s*(\d+))?\))?$/)
  if (decimal) {
    return {
      kind: 'decimal',
      precision: decimal[1] ? Number(decimal[1]) : undefined,
      scale: decimal[2] ? Number(decimal[2]) : decimal[1] ? 0 : undefined,
    }
  }
  if (is('money|smallmoney')) return { kind: 'decimal', precision: 19, scale: 4 }
  if (is('real|float4') || (is('float') && source === 'mysql')) return { kind: 'real' }
  if (is('float|double|double precision|float8')) return { kind: 'double' }
  if (is('date|newdate')) return { kind: 'date' }
  if (/^(?:timestamptz|datetimeoffset|timestamp(?:\(\d+\))? with time zone)/.test(t)) return { kind: 'timestamptz' }
  if (is('timestamp')) return { kind: source === 'mysql' ? 'timestamptz' : 'timestamp' }
  if (/^(?:timestamp.*without time zone|timestamp_(?:s|ms|ns)|datetime2?|smalldatetime)/.test(t)) {
    return { kind: 'timestamp' }
  }
  if (/^time(?!stamp)/.test(t)) return { kind: 'time' }
  if (is('uuid|uniqueidentifier')) return { kind: 'uuid' }
  if (/^(?:bytea|blob|tinyblob|mediumblob|longblob|binary|varbinary|image)(?:\(.*\))?$/.test(t)) {
    return { kind: 'binary' }
  }
  const text = t.match(/^(?:(?:var)?char|character varying|nvarchar|nchar|bpchar|character)\((\d+)\)$/)
  if (text) return { kind: 'text', length: Number(text[1]) }
  return { kind: 'text' }
}

// Maximum precision of DECIMAL per dialect and the default (38, 10) of those that need one.
const MAX_PRECISION: Partial<Record<SplitDialect, number>> = { mysql: 65, mssql: 38, duckdb: 38, clickhouse: 76 }

/** Type name of `c` in the `target` dialect; `key`: the column is part of the primary key. */
export function renderType(c: Canonical, target: SplitDialect, key = false): string {
  const pick = (v: Record<SplitDialect, string>) => v[target]
  switch (c.kind) {
    case 'boolean':
      return pick({
        postgres: 'boolean',
        mysql: 'boolean',
        mssql: 'bit',
        duckdb: 'boolean',
        sqlite: 'integer',
        clickhouse: 'Bool',
      })
    case 'smallint':
      return pick({
        postgres: 'smallint',
        mysql: 'smallint',
        mssql: 'smallint',
        duckdb: 'smallint',
        sqlite: 'integer',
        clickhouse: 'Int16',
      })
    case 'integer':
      return pick({
        postgres: 'integer',
        mysql: 'int',
        mssql: 'int',
        duckdb: 'integer',
        sqlite: 'integer',
        clickhouse: 'Int32',
      })
    case 'bigint':
      return pick({
        postgres: 'bigint',
        mysql: 'bigint',
        mssql: 'bigint',
        duckdb: 'bigint',
        sqlite: 'integer',
        clickhouse: 'Int64',
      })
    case 'decimal': {
      if (target === 'sqlite') return 'numeric'
      if (target === 'postgres')
        return c.precision === undefined ? 'numeric' : `numeric(${c.precision},${Math.min(c.scale ?? 0, c.precision)})`
      const precision = Math.min(c.precision ?? 38, MAX_PRECISION[target]!)
      const scale = Math.min(c.precision === undefined ? 10 : (c.scale ?? 0), precision)
      return `${target === 'clickhouse' ? 'Decimal' : 'decimal'}(${precision},${scale})`
    }
    case 'real':
      return pick({
        postgres: 'real',
        mysql: 'float',
        mssql: 'real',
        duckdb: 'real',
        sqlite: 'real',
        clickhouse: 'Float32',
      })
    case 'double':
      return pick({
        postgres: 'double precision',
        mysql: 'double',
        mssql: 'float',
        duckdb: 'double',
        sqlite: 'real',
        clickhouse: 'Float64',
      })
    case 'date':
      return pick({
        postgres: 'date',
        mysql: 'date',
        mssql: 'date',
        duckdb: 'date',
        sqlite: 'text',
        clickhouse: 'Date32',
      })
    case 'time':
      return pick({
        postgres: 'time',
        mysql: 'time(6)',
        mssql: 'time',
        duckdb: 'time',
        sqlite: 'text',
        clickhouse: 'String',
      })
    case 'timestamp':
      return pick({
        postgres: 'timestamp',
        mysql: 'datetime(6)',
        mssql: 'datetime2',
        duckdb: 'timestamp',
        sqlite: 'text',
        clickhouse: 'DateTime64(6)',
      })
    case 'timestamptz':
      return pick({
        postgres: 'timestamptz',
        mysql: 'timestamp(6)',
        mssql: 'datetimeoffset',
        duckdb: 'timestamptz',
        sqlite: 'text',
        clickhouse: "DateTime64(6, 'UTC')",
      })
    case 'uuid':
      return pick({
        postgres: 'uuid',
        mysql: 'char(36)',
        mssql: 'uniqueidentifier',
        duckdb: 'uuid',
        sqlite: 'text',
        clickhouse: 'UUID',
      })
    case 'json':
      return pick({
        postgres: 'jsonb',
        mysql: 'json',
        mssql: 'nvarchar(max)',
        duckdb: 'json',
        sqlite: 'text',
        clickhouse: 'String',
      })
    case 'binary':
      return pick({
        postgres: 'bytea',
        mysql: 'longblob',
        mssql: 'varbinary(max)',
        duckdb: 'blob',
        sqlite: 'blob',
        clickhouse: 'String',
      })
    case 'text': {
      const n = c.length
      if (target === 'postgres') return n === undefined ? 'text' : `varchar(${n})`
      if (target === 'mysql') {
        if (n !== undefined && n <= 16383) return `varchar(${n})`
        return key ? 'varchar(255)' : 'longtext'
      }
      if (target === 'mssql') {
        if (key) return `nvarchar(${Math.min(n ?? 450, 450)})`
        return n !== undefined && n <= 4000 ? `nvarchar(${n})` : 'nvarchar(max)'
      }
      return target === 'duckdb' ? 'varchar' : target === 'sqlite' ? 'text' : 'String'
    }
  }
}

/** Type in the `target` dialect for a column of `type` in the `source` dialect. */
export const targetType = (type: string, source: SplitDialect, target: SplitDialect, key = false) =>
  renderType(canonicalType(type, source), target, key)

export function createTableSql(
  dialect: SplitDialect,
  schema: string,
  table: string,
  columns: (TargetColumn & { key: boolean })[],
): string {
  const clickhouse = dialect === 'clickhouse'
  const lines = columns.map((c) => {
    const type = clickhouse && !c.key && !/^nullable\(/i.test(c.type) ? `Nullable(${c.type})` : c.type
    return `  ${quoteIdent(dialect, c.name)} ${type}${c.key ? ' not null' : ''}`
  })
  const keys = columns
    .filter((c) => c.key)
    .map((c) => quoteIdent(dialect, c.name))
    .join(', ')
  if (keys && !clickhouse) lines.push(`  primary key (${keys})`)
  const sql = `create table ${qualifiedName(dialect, [schema, table])} (\n${lines.join(',\n')}\n)`
  return clickhouse ? `${sql}\nengine = MergeTree\norder by ${keys ? `(${keys})` : 'tuple()'}` : sql
}

export const truncateSql = (dialect: SplitDialect, table: string[]) =>
  `${dialect === 'sqlite' ? 'delete from' : 'truncate table'} ${qualifiedName(dialect, table)}`

/** Undefined: no transactions (ClickHouse). */
export function beginSql(dialect: SplitDialect): string | undefined {
  if (dialect === 'clickhouse') return undefined
  if (dialect === 'mysql') return 'start transaction'
  return dialect === 'postgres' || dialect === 'sqlite' ? 'begin' : 'begin transaction'
}

export const commitSql = (dialect: SplitDialect) => (dialect === 'mssql' ? 'commit transaction' : 'commit')
export const rollbackSql = (dialect: SplitDialect) => (dialect === 'mssql' ? 'rollback transaction' : 'rollback')

/** Number of rows of `table` whose key matches one of `rows` (the key values per row); undefined: no row to look for. */
export function existingKeysSql(
  dialect: SplitDialect,
  table: string[],
  keys: TargetColumn[],
  rows: CellValue[][],
): string | undefined {
  const conditions = rows
    .filter((row) => row.every((v) => v !== null))
    .map(
      (row) =>
        `(${keys.map((k, i) => `${quoteIdent(dialect, k.name)} = ${sqlLiteral(dialect, row[i]!, k.type)}`).join(' and ')})`,
    )
  if (!conditions.length) return undefined
  return `select count(*) from ${qualifiedName(dialect, table)} where ${conditions.join(' or ')}`
}

/** One statement writing `rows` (values in the order of `columns`) and updating those whose `keys` exist. */
export function upsertSql(
  dialect: SplitDialect,
  table: string[],
  columns: TargetColumn[],
  keys: string[],
  rows: CellValue[][],
): string {
  if (dialect === 'clickhouse') throw new AppError('upsertUnsupported', 'ClickHouse does not support upserts.')
  const q = (name: string) => quoteIdent(dialect, name)
  const rest = columns.filter((c) => !keys.includes(c.name)).map((c) => c.name)
  if (dialect === 'mssql') {
    const values = rows.map(
      (row) => `(${columns.map((c, i) => sqlLiteral(dialect, row[i] ?? null, c.type)).join(', ')})`,
    )
    const names = columns.map((c) => q(c.name)).join(', ')
    return [
      `merge into ${qualifiedName(dialect, table)} with (holdlock) as target`,
      `using (values ${values.join(', ')}) as source (${names})`,
      `on ${keys.map((k) => `target.${q(k)} = source.${q(k)}`).join(' and ')}`,
      ...(rest.length
        ? [`when matched then update set ${rest.map((c) => `${q(c)} = source.${q(c)}`).join(', ')}`]
        : []),
      `when not matched then insert (${names}) values (${columns.map((c) => `source.${q(c.name)}`).join(', ')});`,
    ].join('\n')
  }
  const insert = insertSql(dialect, table, columns, rows)
  if (dialect === 'mysql') {
    const update = rest.length ? rest.map((c) => `${q(c)} = values(${q(c)})`) : [`${q(keys[0]!)} = ${q(keys[0]!)}`]
    return `${insert}\non duplicate key update ${update.join(', ')}`
  }
  const conflict = `on conflict (${keys.map(q).join(', ')})`
  return rest.length
    ? `${insert}\n${conflict} do update set ${rest.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`
    : `${insert}\n${conflict} do nothing`
}

/** Strategies the target dialect offers; a new table is only appended to. */
export function strategies(dialect: SplitDialect, newTable: boolean): ImportStrategy[] {
  if (newTable) return ['append']
  return dialect === 'clickhouse' ? ['append', 'truncate'] : ['append', 'truncate', 'upsert']
}
