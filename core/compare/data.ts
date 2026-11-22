import { createReadStream } from 'node:fs'
import { type FileHandle, open, rm } from 'node:fs/promises'
import type { SplitDialect } from '../sql-split.ts'
import { AppError, type CellValue, type ColumnInfo, type RowSink } from '../types.ts'
import type { Workbench } from '../workbench.ts'
import { flag, qualified, query, quoteIdent, stringLiteral } from './sql.ts'
import { type DataCompareRequest, type DataCompareResult, SAMPLE_LIMIT, SCRIPT_LIMIT, type TableRef } from './types.ts'

type Row = CellValue[]
type KeyKind = 'number' | 'guid' | 'text'

/** A pull-based view on a streamed result that holds at most one batch: the stream waits until it is consumed. */
export function pull(start: (sink: RowSink) => Promise<void>): { next(): Promise<Row | undefined>; close(): void } {
  interface Batch {
    rows: Row[]
    resolve: () => void
    reject: (e: Error) => void
  }
  let current: Batch | undefined
  let at = 0
  let incoming: Batch | undefined
  let arrived: (() => void) | undefined
  let done = false
  let failure: { error: unknown } | undefined
  let closed = false
  const wake = () => {
    arrived?.()
    arrived = undefined
  }
  start({
    columns() {},
    rows: (rows) =>
      new Promise<void>((resolve, reject) => {
        if (closed) return reject(new Error('closed'))
        incoming = { rows, resolve, reject }
        wake()
      }),
  })
    .then(
      () => {
        done = true
      },
      (error) => {
        done = true
        failure = { error }
      },
    )
    .finally(wake)
  return {
    async next() {
      for (;;) {
        if (current && at < current.rows.length) return current.rows[at++]
        current?.resolve()
        current = incoming
        incoming = undefined
        at = 0
        if (current) continue
        if (failure) throw failure.error
        if (done) return undefined
        await new Promise<void>((resolve) => (arrived = resolve))
      }
    },
    close() {
      closed = true
      for (const batch of [current, incoming]) batch?.reject(new Error('closed'))
    },
  }
}

const NUMBER =
  /^(u?(tiny|small|medium|big|huge)?int(eger)?(\(|\s|$|\d)|serial|smallserial|bigserial|decimal|numeric|real|double|float|money|smallmoney|number|ubigint|uinteger|usmallint|utinyint)/i
const UNSUPPORTED: Partial<Record<SplitDialect, RegExp>> = {
  postgres: /\[\]|geometry|geography/i,
  duckdb: /\[\d*\]$|^(struct|map|union)\b/i,
  mysql: /^(geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)$/i,
  mssql: /^(geometry|geography|xml|sql_variant|hierarchyid)/i,
}
const CHARACTER: Partial<Record<SplitDialect, RegExp>> = {
  postgres: /char|text|name|citext/i,
  mysql: /char|text|enum|^set/i,
  mssql: /char|text/i,
}

function keyKind(dialect: SplitDialect, type: string): KeyKind {
  if (dialect === 'mssql' && /^uniqueidentifier/i.test(type)) return 'guid'
  return NUMBER.test(type) ? 'number' : 'text'
}

/** Position of a key column in `order by`. Text keys sort in binary order, so that the database agrees with `compareKeys`. */
function orderBy(dialect: SplitDialect, name: string, type: string, kind: KeyKind): string {
  const column = quoteIdent(dialect, name)
  if (kind === 'number') return column
  if (dialect === 'sqlite') return `${column} collate binary`
  if (dialect === 'mssql') {
    if (kind === 'guid') return `cast(${column} as char(36)) collate Latin1_General_100_BIN2`
    return CHARACTER.mssql!.test(type) ? `${column} collate Latin1_General_100_BIN2` : column
  }
  if (!CHARACTER[dialect]?.test(type)) return column
  return dialect === 'postgres' ? `${column} collate "C"` : dialect === 'mysql' ? `cast(${column} as binary)` : column
}

function compareDecimal(a: string, b: string): number {
  const parse = (s: string) => {
    const m = /^([+-]?)(\d*)\.?(\d*)$/.exec(s.trim())
    if (!m) return undefined
    const integer = m[2]!.replace(/^0+/, '')
    const fraction = m[3]!.replace(/0+$/, '')
    return { negative: m[1] === '-' && (!!integer || !!fraction), integer, fraction }
  }
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return Math.sign(Number(a) - Number(b))
  if (x.negative !== y.negative) return x.negative ? -1 : 1
  const magnitude =
    x.integer.length - y.integer.length ||
    (x.integer < y.integer ? -1 : x.integer > y.integer ? 1 : 0) ||
    (x.fraction < y.fraction ? -1 : x.fraction > y.fraction ? 1 : 0)
  return x.negative ? -magnitude : magnitude
}

/** By code point, like the binary order of the databases (`<` on strings compares UTF-16 code units). */
function compareText(a: string, b: string): number {
  const x = a[Symbol.iterator]()
  const y = b[Symbol.iterator]()
  for (;;) {
    const p = x.next()
    const q = y.next()
    if (p.done || q.done) return p.done === q.done ? 0 : p.done ? -1 : 1
    if (p.value !== q.value) return p.value.codePointAt(0)! - q.value.codePointAt(0)!
  }
}

export function compareKeys(kind: KeyKind, a: CellValue, b: CellValue): number {
  if (kind === 'number') {
    return typeof a === 'number' && typeof b === 'number' ? a - b : compareDecimal(String(a), String(b))
  }
  if (kind === 'guid') return compareText(String(a).toUpperCase(), String(b).toUpperCase())
  return compareText(String(a), String(b))
}

const BINARY = /bytea|blob|binary|varbinary|image/i

/** SQL literal of a value of a column of `type`, as the drivers return it (see CellValue). */
export function literal(dialect: SplitDialect, value: CellValue, type: string): string {
  const float = dialect === 'postgres' || dialect === 'duckdb'
  if (value === null) return 'null'
  if (typeof value === 'boolean') return float ? String(value) : value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    if (NUMBER.test(type)) {
      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return value
      if (float && /^[+-]?(NaN|Infinity)$/i.test(value)) return `'${value}'::float8`
    }
    if (BINARY.test(type) && value.startsWith('0x')) {
      const hex = value.slice(2)
      if (dialect === 'postgres') return `'\\x${hex}'::bytea`
      if (dialect === 'duckdb') return `from_hex('${hex}')`
      if (dialect === 'sqlite') return `X'${hex}'`
      return hex || dialect === 'mssql' ? `0x${hex}` : `''`
    }
    // The PostgreSQL driver parses JSON, so a string in a json column is a JSON string.
    if (dialect === 'postgres' && /json/i.test(type)) return stringLiteral(dialect, JSON.stringify(value))
    return stringLiteral(dialect, value)
  }
  return stringLiteral(dialect, JSON.stringify(value))
}

/** Columns that cannot be written (generated, computed, rowversion) and identity columns of a table. */
async function writable(wb: Workbench, dialect: SplitDialect, ref: TableRef) {
  const S = (s: string) => stringLiteral(dialect, s)
  const run = (sql: string) =>
    wb.metadata(ref.connectionId, ref.database, (s) => query<Record<string, unknown>>(s, sql))
  const generated = new Set<string>()
  const identity = new Map<string, string>()
  const name = (r: Record<string, unknown>) => String(r.name)
  if (dialect === 'postgres') {
    const rows = await run(
      `select a.attname as name, a.attidentity as identity, a.attgenerated as generated
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = ${S(ref.schema)} and c.relname = ${S(ref.table)} and a.attnum > 0 and not a.attisdropped`,
    )
    for (const r of rows) {
      if (r.generated) generated.add(name(r))
      if (r.identity) identity.set(name(r), r.identity === 'a' ? 'always' : 'by default')
    }
  } else if (dialect === 'mysql') {
    const rows = await run(
      `select column_name as name, extra as extra from information_schema.columns
       where table_schema = ${S(ref.schema)} and table_name = ${S(ref.table)}`,
    )
    for (const r of rows) if (/VIRTUAL|STORED|PERSISTENT/i.test(String(r.extra))) generated.add(name(r))
  } else if (dialect === 'mssql') {
    const rows = await run(
      `select c.name, c.is_identity as is_identity, c.is_computed as is_computed, type_name(c.system_type_id) as type
       from sys.columns c where c.object_id = object_id(${S(qualified(dialect, ref.schema, ref.table))})`,
    )
    for (const r of rows) {
      if (flag(r.is_computed) || r.type === 'timestamp') generated.add(name(r))
      if (flag(r.is_identity)) identity.set(name(r), 'identity')
    }
  } else if (dialect === 'sqlite') {
    const rows = await run(`select name, hidden from pragma_table_xinfo(${S(ref.table)}, ${S(ref.schema)})`)
    // Hidden 2 and 3 are generated columns.
    for (const r of rows) if (r.hidden === 2 || r.hidden === 3) generated.add(name(r))
  }
  return { generated, identity }
}

type Kind = 'delete' | 'update' | 'insert'
const SUFFIX: Record<Kind, string> = { delete: 'd', update: 'u', insert: 'i' }

/** The statements of the sync script: in memory up to SCRIPT_LIMIT, then in part files next to `path`, or only counted. */
class Script {
  private memory: Record<Kind, string[]> | undefined = { delete: [], update: [], insert: [] }
  private files: Record<Kind, { file: FileHandle; buffer: string[] }> | undefined
  readonly counts: Record<Kind, number> = { delete: 0, update: 0, insert: 0 }

  constructor(private path?: string) {}

  get total() {
    return this.counts.delete + this.counts.update + this.counts.insert
  }

  async add(kind: Kind, statement: string) {
    this.counts[kind]++
    if (this.memory && this.total > SCRIPT_LIMIT) {
      const memory = this.memory
      this.memory = undefined
      if (this.path) {
        const kinds = Object.keys(SUFFIX) as Kind[]
        const [delete_, update, insert] = await Promise.all(
          kinds.map(async (k) => ({ file: await open(`${this.path}.${SUFFIX[k]}.part`, 'w'), buffer: [] as string[] })),
        )
        this.files = { delete: delete_!, update: update!, insert: insert! }
        for (const k of kinds) for (const s of memory[k]) await this.write(k, s)
      }
    }
    if (this.memory) this.memory[kind].push(statement)
    else if (this.files) await this.write(kind, statement)
  }

  private async write(kind: Kind, statement: string) {
    const target = this.files![kind]
    target.buffer.push(statement)
    if (target.buffer.length >= 1000) await this.flush(kind)
  }

  private async flush(kind: Kind) {
    const target = this.files![kind]
    if (target.buffer.length) await target.file.write(`${target.buffer.join('\n')}\n`)
    target.buffer = []
  }

  /** The script text, or null when it was too large for memory (it is then written to `path` if there was one). */
  async finish(header: string[], begin: string, insertOn: string | undefined, insertOff: string | undefined) {
    const framed = (deletes: string[], updates: string[], inserts: string[]) => [
      ...header,
      begin,
      ...deletes,
      ...updates,
      ...(inserts.length && insertOn ? [insertOn, ...inserts, insertOff!] : inserts),
      'commit;',
    ]
    if (this.memory) {
      const { delete: d, update: u, insert: i } = this.memory
      return this.total ? `${framed(d, u, i).join('\n')}\n` : `${header.join('\n')}\n-- No differences\n`
    }
    if (!this.files) return null
    const kinds = Object.keys(SUFFIX) as Kind[]
    for (const k of kinds) await this.flush(k)
    const out = await open(this.path!, 'w')
    try {
      await out.write(`${[...header, begin].join('\n')}\n`)
      for (const k of kinds) {
        if (k === 'insert' && insertOn) await out.write(`${insertOn}\n`)
        await this.files[k].file.close()
        for await (const chunk of createReadStream(`${this.path}.${SUFFIX[k]}.part`)) await out.write(chunk)
        if (k === 'insert' && insertOn) await out.write(`${insertOff}\n`)
      }
      await out.write('commit;\n')
    } finally {
      await out.close()
    }
    return null
  }

  /** Closes and removes the part files. */
  async dispose() {
    if (!this.files) return
    const files = Object.entries(this.files)
    this.files = undefined
    for (const [k, { file }] of files) {
      await file.close().catch(() => {})
      await rm(`${this.path}.${SUFFIX[k as Kind]}.part`, { force: true })
    }
  }
}

/**
 * Compares one table across two connections of the same engine: both sides stream in key order and are merged, so
 * memory is bounded by one batch per side. Nothing is written to the target; the result carries the INSERT, UPDATE
 * and DELETE statements that would make it equal.
 */
export async function compareData(
  wb: Workbench,
  dialect: SplitDialect,
  request: DataCompareRequest,
  signal: AbortSignal,
): Promise<DataCompareResult> {
  const { id, source, target } = request
  const ident = (name: string) => quoteIdent(dialect, name)
  const sameName = (a: string, b: string) => (dialect === 'postgres' ? a === b : a.toLowerCase() === b.toLowerCase())
  const columnsOf = (ref: TableRef) =>
    wb.introspect(ref.connectionId, { kind: 'columns', schema: ref.schema, table: ref.table }, true, ref.database)
  const [sourceColumns, targetColumns, sourceIndexes, sourceMeta, targetMeta] = await Promise.all([
    columnsOf(source),
    columnsOf(target),
    wb.introspect(
      source.connectionId,
      { kind: 'indexes', schema: source.schema, table: source.table },
      true,
      source.database,
    ),
    writable(wb, dialect, source),
    writable(wb, dialect, target),
  ])

  const common = sourceColumns.flatMap((s) => {
    const t = targetColumns.find((c) => sameName(c.name, s.name))
    return t && !sourceMeta.generated.has(s.name) && !targetMeta.generated.has(t.name) ? [{ source: s, target: t }] : []
  })
  const ignored = (columns: ColumnInfo[], side: 'source' | 'target') =>
    columns.filter((c) => !common.some((m) => m[side] === c)).map((c) => c.name)
  const keyNames = request.keys?.length
    ? request.keys
    : (sourceIndexes.find((i) => i.primary)?.columns ?? sourceColumns.filter((c) => c.primaryKey).map((c) => c.name))
  const keys = keyNames.map((name) => common.find((c) => sameName(c.source.name, name)))
  if (!keys.length || keys.includes(undefined)) {
    throw new AppError('compareNoKey', 'The table has no primary key or a key column is not on both sides.')
  }
  const unsupported = UNSUPPORTED[dialect]
  for (const c of common) {
    for (const column of [c.source, c.target]) {
      if (unsupported?.test(column.type)) {
        throw new AppError('compareUnsupportedType', `Column ${column.name} (${column.type}) cannot be compared.`, {
          params: { column: column.name, type: column.type },
        })
      }
    }
  }

  const keyIndexes = keys.map((k) => common.indexOf(k!))
  const kinds = keys.map((k) => keyKind(dialect, k!.source.type))

  const sides = { source, target }
  const select = (side: 'source' | 'target') =>
    `select ${common.map((c) => ident(c[side].name)).join(', ')} from ${qualified(dialect, sides[side].schema, sides[side].table)} order by ${keys.map((k, i) => orderBy(dialect, k![side].name, k![side].type, kinds[i]!)).join(', ')}`
  const tab = (side: 'source' | 'target') => `compare:${id}:${side}`
  const cancelBoth = () =>
    Promise.all((['source', 'target'] as const).map((side) => wb.cancel(tab(side)).catch(() => {})))
  const onAbort = () => void cancelBoth()
  signal.addEventListener('abort', onAbort)
  const rows = {
    source: pull((sink) => wb.stream(tab('source'), source.connectionId, select('source'), sink, source.database)),
    target: pull((sink) => wb.stream(tab('target'), target.connectionId, select('target'), sink, target.database)),
  }

  const columnNames = common.map((c) => c.source.name)
  const targetTable = qualified(dialect, target.schema, target.table)
  const typeOf = common.map((c) => c.target.type)
  const identityColumns = common.filter((c) => targetMeta.identity.has(c.target.name))
  const overriding =
    dialect === 'postgres' && identityColumns.some((c) => targetMeta.identity.get(c.target.name) === 'always')
  const lit = (row: Row, i: number) => literal(dialect, row[i]!, typeOf[i]!)
  const where = (row: Row) => keyIndexes.map((i) => `${ident(common[i]!.target.name)} = ${lit(row, i)}`).join(' and ')
  const script = new Script(request.path)
  const counts = { same: 0, onlyInSource: 0, onlyInTarget: 0, different: 0 }
  const samples: DataCompareResult['samples'] = { onlyInSource: [], onlyInTarget: [], different: [] }
  const sample = <T>(list: T[], item: T) => list.length < SAMPLE_LIMIT && list.push(item)

  const keyOf = (row: Row) => {
    for (const i of keyIndexes) if (row[i] === null) throw new AppError('compareNullKey', 'A key column contains NULL.')
    return keyIndexes.map((i) => row[i]!)
  }
  const compare = (a: CellValue[], b: CellValue[]) => {
    for (const [n, kind] of kinds.entries()) {
      const c = compareKeys(kind, a[n]!, b[n]!)
      if (c) return c
    }
    return 0
  }
  // Rows must come in strictly increasing key order on each side.
  const advance = async (side: 'source' | 'target', previous: CellValue[] | undefined) => {
    const row = await rows[side].next()
    if (row && previous && compare(keyOf(row), previous) <= 0) {
      throw new AppError('compareOrder', 'The key is not unique or the databases sort it differently.')
    }
    return row
  }

  try {
    let s = await advance('source', undefined)
    let t = await advance('target', undefined)
    let count = 0
    while (s || t) {
      if (++count % 1000 === 0 && signal.aborted) throw new AppError('cancelled', 'Query was cancelled')
      const order = !s ? 1 : !t ? -1 : compare(keyOf(s), keyOf(t))
      if (order < 0) {
        counts.onlyInSource++
        sample(samples.onlyInSource, s!)
        await script.add(
          'insert',
          `insert into ${targetTable} (${common.map((c) => ident(c.target.name)).join(', ')})${overriding ? ' overriding system value' : ''} values (${s!.map((_, i) => lit(s!, i)).join(', ')});`,
        )
        s = await advance('source', keyOf(s!))
      } else if (order > 0) {
        counts.onlyInTarget++
        sample(samples.onlyInTarget, t!)
        await script.add('delete', `delete from ${targetTable} where ${where(t!)};`)
        t = await advance('target', keyOf(t!))
      } else {
        const changed = columnNames.flatMap((name, i) => (JSON.stringify(s![i]) === JSON.stringify(t![i]) ? [] : [i]))
        if (changed.length) {
          counts.different++
          sample(samples.different, { source: s!, target: t!, changed: changed.map((i) => columnNames[i]!) })
          await script.add(
            'update',
            `update ${targetTable} set ${changed.map((i) => `${ident(common[i]!.target.name)} = ${lit(s!, i)}`).join(', ')} where ${where(t!)};`,
          )
        } else counts.same++
        const [ks, kt] = [keyOf(s!), keyOf(t!)]
        s = await advance('source', ks)
        t = await advance('target', kt)
      }
    }
    if (signal.aborted) throw new AppError('cancelled', 'Query was cancelled')
    const insertTable = dialect === 'mssql' && identityColumns.length ? targetTable : undefined
    const begin = { mysql: 'start transaction;', mssql: 'begin transaction;' }[dialect as string] ?? 'begin;'
    const text = await script.finish(
      [`-- Sync ${source.schema}.${source.table} → ${target.schema}.${target.table} (Colwerk)`],
      begin,
      insertTable && `set identity_insert ${insertTable} on;`,
      insertTable && `set identity_insert ${insertTable} off;`,
    )
    return {
      columns: columnNames,
      keys: keys.map((k) => k!.source.name),
      ignored: { source: ignored(sourceColumns, 'source'), target: ignored(targetColumns, 'target') },
      counts,
      samples,
      statements: script.total,
      script: text,
    }
  } catch (e) {
    await cancelBoth()
    // Cancelling makes the drivers fail with their own error.
    throw signal.aborted && !(e instanceof AppError) ? new AppError('cancelled', 'Query was cancelled') : e
  } finally {
    signal.removeEventListener('abort', onAbort)
    rows.source.close()
    rows.target.close()
    await Promise.all([wb.closeTab(tab('source')), wb.closeTab(tab('target'))])
    await script.dispose()
  }
}
