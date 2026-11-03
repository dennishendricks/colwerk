import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { maskLiterals, splitStatements, type StatementRange } from '../sql-split.ts'
import { AppError, type ColumnInfo, type ConnectionConfig, DbError, type Driver, type IndexInfo, type IntrospectRequest, type IntrospectResult, type QueryResult, type ResultColumn, type RoutineInfo, type RowSink, type Session, type TableInfo, type TransactionState } from '../types.ts'
import { normalizeValue, STREAM_BATCH } from '../values.ts'

type Request =
  | { op: 'open', path: string, readOnly: boolean }
  | { op: 'execute', statements: string[], rowLimit: number }
  | { op: 'stream', sql: string, batch: number }
  | { op: 'rows', sql: string, params: string[] }
  | { op: 'transaction' }
  | { op: 'close' }

type Data = { columns: ResultColumn[] } | { rows: unknown[][] }
type Reply = Data | { result: unknown } | { error: WorkerError }

/** `statement`: index of the failing statement of an `execute`. */
interface WorkerError {
  message: string
  statement?: number
}

interface ExecuteResult {
  resultSets: { columns: ResultColumn[], rows: unknown[][], truncated: boolean }[]
  changes: number
}

/**
 * The worker that owns the connection. node:sqlite only has a synchronous API, so statements run on a thread of
 * their own: the event loop stays free, and `cancel` can end the thread. Stringified into the worker, so it must
 * not use anything from outside the function.
 */
function workerMain() {
  const port = self as unknown as { postMessage(reply: Reply): void, onmessage: (e: MessageEvent<Request | { op: 'next' } | { op: 'abort' }>) => void }
  let db: DatabaseSync
  // Takes the main thread's answer to a streamed batch.
  let ack: ((op: 'next' | 'abort') => void) | undefined

  const value = (v: unknown) => typeof v === 'bigint' && v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER ? Number(v) : v
  const prepare = (sql: string) => {
    const st = db.prepare(sql)
    st.setReadBigInts(true)
    st.setReturnArrays(true)
    return st
  }
  const columns = (st: ReturnType<DatabaseSync['prepare']>) => st.columns().map(c => ({ name: c.name, type: c.type ?? '' }))
  const totalChanges = () => Number((db.prepare('select total_changes() as n').get() as { n: number }).n)

  async function handle(req: Request): Promise<unknown> {
    switch (req.op) {
      case 'open': {
        const { DatabaseSync } = await import('node:sqlite')
        db = new DatabaseSync(req.path, { readOnly: req.readOnly })
        db.exec('pragma busy_timeout = 5000')
        return
      }
      case 'execute': {
        const result: ExecuteResult = { resultSets: [], changes: 0 }
        const before = totalChanges()
        for (const [i, sql] of req.statements.entries()) {
          try {
            const st = prepare(sql)
            const cols = columns(st)
            if (!cols.length) {
              st.run()
              continue
            }
            const rows: unknown[][] = []
            // Leaving the loop resets the statement, so a truncated query does not read the rest.
            for (const row of st.iterate() as Iterable<unknown[]>) {
              rows.push(row.map(value))
              if (rows.length > req.rowLimit) break
            }
            result.resultSets.push({ columns: cols, rows: rows.slice(0, req.rowLimit), truncated: rows.length > req.rowLimit })
          } catch (e) {
            throw Object.assign(e as Error, { statement: i })
          }
        }
        result.changes = totalChanges() - before
        return result
      }
      case 'stream': {
        const st = prepare(req.sql)
        port.postMessage({ columns: columns(st) })
        let batch: unknown[][] = []
        const flush = async () => {
          port.postMessage({ rows: batch })
          batch = []
          return await new Promise(resolve => (ack = resolve)) === 'next'
        }
        for (const row of st.iterate() as Iterable<unknown[]>) {
          batch.push(row.map(value))
          if (batch.length >= req.batch && !await flush()) return
        }
        if (batch.length) await flush()
        return
      }
      case 'rows':
        return db.prepare(req.sql).all(...req.params)
      case 'transaction':
        return db.isTransaction
      case 'close':
        return db?.close()
    }
  }

  port.onmessage = async ({ data }) => {
    if (data.op === 'next' || data.op === 'abort') return ack?.(data.op)
    try {
      port.postMessage({ result: await handle(data) })
    } catch (e) {
      port.postMessage({ error: { message: (e as Error).message, statement: (e as WorkerError).statement } })
    }
  }
}

const workerUrl = URL.createObjectURL(new Blob([`(${workerMain.toString()})()`], { type: 'application/javascript' }))

/**
 * Statement ranges of a script without those that are only comments: node:sqlite crashes the process on SQL
 * without a statement.
 */
function statements(sql: string): StatementRange[] {
  return splitStatements(sql, 'sqlite').filter(r => maskLiterals(sql.slice(r.from, r.to), 'sqlite').trim())
}

/**
 * The worker's error as DbError, located in `sql` when the statement's range is known. Syntax errors only quote
 * the token they failed at ('near "x": syntax error'), so its first occurrence in the statement is taken.
 */
function failure(e: unknown, sql?: string, ranges: StatementRange[] = []): Error {
  if (e instanceof Error) return e
  const { message, statement } = e as WorkerError
  const err = new DbError(message)
  const near = /^near "([\s\S]*)": syntax error/.exec(message)?.[1]
  const range = statement === undefined ? undefined : ranges[statement]
  const at = near && range && sql !== undefined ? sql.slice(range.from, range.to).indexOf(near) : -1
  if (at !== -1) err.position = range!.from + at
  if (ranges.length > 1 && statement !== undefined) err.message = `Statement ${statement + 1}: ${err.message}`
  return err
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`

const SQL = {
  tables: 'select name, type from pragma_table_list where schema = ? order by name',
  columns: 'select name, type, "notnull", pk, hidden from pragma_table_xinfo(?, ?)',
  foreignKeys: 'select "from", "table", "to", seq from pragma_foreign_key_list(?, ?)',
  // One row per index column; expression columns have no name.
  indexColumns: `
    select l.name, l."unique", l.origin, i.name as col
    from pragma_index_list(?, ?) l join pragma_index_info(l.name, ?) i
    order by l.name, i.seqno`,
  primaryKey: 'select name from pragma_table_info(?, ?) where pk > 0 order by pk',
}

class SqliteSession implements Session {
  worker!: Worker
  private queue: Promise<unknown> = Promise.resolve()
  private current?: { resolve(result: unknown): void, reject(e: unknown): void, onData?(data: Data): void }

  /** `name`: the database as listed by introspection (file name or `memory`); `release`: called on close. */
  constructor(private open: Extract<Request, { op: 'open' }>, private name: string, private release: () => Promise<void>) {}

  /** Starts a worker and opens the database in it; requests sent afterwards wait for it. */
  start(): Promise<unknown> {
    const worker = this.worker = new Worker(workerUrl, { type: 'module' })
    // Replies of a worker given up by `cancel` are ignored.
    worker.onmessage = ({ data }: MessageEvent<Reply>) => worker === this.worker && this.reply(data)
    return this.request(this.open)
  }

  private reply(data: Reply) {
    const current = this.current
    if (!current) return
    if ('columns' in data || 'rows' in data) return current.onData?.(data)
    this.current = undefined
    if ('error' in data) current.reject(data.error)
    else current.resolve(data.result)
  }

  /** Sends the request once the previous ones are done; rejects with a WorkerError, or an AppError when cancelled. */
  private request<T>(req: Request, onData?: (data: Data) => void): Promise<T> {
    const run = this.queue.then(() => new Promise<T>((resolve, reject) => {
      this.current = { resolve: resolve as (result: unknown) => void, reject, onData }
      this.worker.postMessage(req)
    }))
    this.queue = run.catch(() => {})
    return run
  }

  // Each statement of a script is run on its own, so every result set is returned and limited on its own.
  async execute(sql: string, { rowLimit }: { rowLimit: number }): Promise<QueryResult> {
    const started = performance.now()
    const ranges = statements(sql)
    try {
      const result = await this.request<ExecuteResult>({ op: 'execute', statements: ranges.map(r => sql.slice(r.from, r.to)), rowLimit })
      return {
        resultSets: result.resultSets.map(s => ({ ...s, rows: s.rows.map(r => r.map(normalizeValue)) })),
        affectedRows: result.resultSets.length ? undefined : result.changes,
        durationMs: performance.now() - started,
      }
    } catch (e) {
      throw failure(e, sql, ranges)
    }
  }

  async stream(sql: string, sink: RowSink): Promise<void> {
    const range = statements(sql)[0]
    if (!range) throw new DbError('No statement to run')
    let failed: unknown
    try {
      await this.request({ op: 'stream', sql: sql.slice(range.from, range.to), batch: STREAM_BATCH }, async (data) => {
        if ('columns' in data) return sink.columns(data.columns)
        const worker = this.worker
        try {
          await sink.rows(data.rows.map(r => r.map(normalizeValue)))
          worker.postMessage({ op: 'next' })
        } catch (e) {
          // A failing sink stops the statement; the session stays usable.
          failed = e
          worker.postMessage({ op: 'abort' })
        }
      })
    } catch (e) {
      throw failure(e)
    }
    if (failed) throw failed
  }

  // node:sqlite cannot interrupt a statement: the worker is ended and the database opened again in a new one,
  // which also rolls back an open transaction and drops temporary tables. The thread only ends between rows, so
  // a long step without rows (an aggregate, a large UPDATE) still runs to its end in the background and keeps its
  // locks until then; outside of a transaction its changes are committed.
  async cancel(): Promise<void> {
    const current = this.current
    if (!current) return
    this.current = undefined
    this.worker.terminate()
    const reopened = this.start()
    current.reject(new AppError('cancelled', 'Query was cancelled'))
    await reopened
  }

  async transactionState(): Promise<TransactionState | undefined> {
    try {
      return await this.request<boolean>({ op: 'transaction' }) ? 'open' : 'idle'
    } catch (e) {
      throw failure(e)
    }
  }

  async introspect<R extends IntrospectRequest>(req: R): Promise<IntrospectResult<R>> {
    // No switching between databases (supportsDatabases is false): only the opened one. Its schemas are the
    // attached databases (main, temp, ATTACH).
    if (req.kind === 'databases') return [{ name: this.name }] as IntrospectResult<R>
    if (req.kind === 'schemas') return await this.rows('select name from pragma_database_list order by seq') as IntrospectResult<R>
    if (req.kind === 'tables') {
      const tables = await this.rows<{ name: string, type: string }>(SQL.tables, [req.schema])
      // Row counts are only known after ANALYZE.
      const counts = new Map(tables.some(t => t.name === 'sqlite_stat1')
        ? (await this.rows<{ tbl: string, n: number }>(`select tbl, max(cast(stat as integer)) as n from ${ident(req.schema)}.sqlite_stat1 group by tbl`)).map(r => [r.tbl, r.n])
        : [])
      return tables.filter(t => t.type !== 'shadow' && !t.name.startsWith('sqlite_')).map((t): TableInfo => ({
        schema: req.schema,
        name: t.name,
        kind: t.type === 'view' ? 'view' : 'table',
        rowEstimate: counts.get(t.name) ?? null,
        comment: null,
        partitioning: null,
        clustering: null,
      })) as IntrospectResult<R>
    }
    // SQLite has no stored routines.
    if (req.kind === 'routines') return [] as RoutineInfo[] as IntrospectResult<R>
    if (req.kind === 'ddl') {
      // The table or view first, then its indexes and triggers; automatic indexes have no SQL.
      const rows = req.object === 'routine'
        ? []
        : await this.rows<{ type: string, sql: string }>(
            `select type, sql from ${ident(req.schema)}.sqlite_schema where tbl_name = ? and sql is not null order by type = ? desc, type, name`,
            [req.name, req.object],
          )
      if (rows[0]?.type !== req.object) throw new AppError('objectNotFound', `${req.schema}.${req.name} not found`, { params: { name: `${req.schema}.${req.name}` } })
      return rows.map(r => `${r.sql};`).join('\n\n') as IntrospectResult<R>
    }
    const indexColumns = await this.rows<{ name: string, unique: number, origin: string, col: string | null }>(SQL.indexColumns, [req.table, req.schema, req.schema])
    if (req.kind === 'indexes') {
      const indexes = new Map<string, IndexInfo>()
      for (const r of indexColumns) {
        if (!indexes.has(r.name)) indexes.set(r.name, { name: r.name, columns: [], unique: r.unique === 1, primary: r.origin === 'pk' })
        if (r.col !== null) indexes.get(r.name)!.columns.push(r.col)
      }
      const list = [...indexes.values()]
      // An INTEGER PRIMARY KEY is the rowid and has no index of its own.
      if (!list.some(i => i.primary)) {
        const pk = (await this.rows<{ name: string }>(SQL.primaryKey, [req.table, req.schema])).map(r => r.name)
        if (pk.length) list.push({ name: 'PRIMARY KEY', columns: pk, unique: true, primary: true })
      }
      return list.sort((a, b) => Number(b.primary) - Number(a.primary)) as IntrospectResult<R>
    }
    const columns = await this.rows<{ name: string, type: string, notnull: number, pk: number, hidden: number }>(SQL.columns, [req.table, req.schema])
    const foreignKeys = await this.rows<{ from: string, table: string, to: string | null, seq: number }>(SQL.foreignKeys, [req.table, req.schema])
    for (const k of foreignKeys) {
      // A foreign key without columns references the primary key.
      if (k.to === null) k.to = (await this.rows<{ name: string }>(SQL.primaryKey, [k.table, req.schema]))[k.seq]?.name ?? null
    }
    // Hidden columns of virtual tables are left out; generated columns are listed.
    return columns.filter(c => c.hidden !== 1).map((c): ColumnInfo => {
      const fk = foreignKeys.find(k => k.from === c.name)
      return {
        name: c.name,
        type: c.type,
        nullable: !c.notnull && !c.pk,
        primaryKey: c.pk > 0,
        // Foreign keys only reference tables of the same schema.
        references: fk?.to ? { schema: req.schema, table: fk.table, column: fk.to } : undefined,
        indexes: [...new Set(indexColumns.filter(i => i.col === c.name && i.origin !== 'pk').map(i => i.name))].sort(),
        comment: null,
      }
    }) as IntrospectResult<R>
  }

  // Gives up a running statement like `cancel`.
  async close(): Promise<void> {
    if (!this.current) await this.request({ op: 'close' }).catch(() => {})
    this.worker.terminate()
    this.current?.reject(new AppError('cancelled', 'Query was cancelled'))
    this.current = undefined
    await this.release()
  }

  private async rows<T>(sql: string, params: string[] = []): Promise<T[]> {
    try {
      return await this.request<T[]>({ op: 'rows', sql, params })
    } catch (e) {
      throw failure(e)
    }
  }
}

// `:memory:` stands for a temporary file per connection, shared by its sessions and removed with the last one:
// a real in-memory database only lives in one connection, and the URI of a shared one (`file:x?mode=memory`)
// is opened as a plain file name unless Deno runs with all permissions.
const memoryFiles = new Map<string, { dir: Promise<string>, sessions: number }>()

async function memoryFile(connectionId: string): Promise<{ path: string, release: () => Promise<void> }> {
  let file = memoryFiles.get(connectionId)
  if (!file) memoryFiles.set(connectionId, file = { dir: mkdtemp(join(tmpdir(), 'colwerk-sqlite-')), sessions: 0 })
  file.sessions++
  const release = async () => {
    if (--file.sessions) return
    memoryFiles.delete(connectionId)
    await rm(await file.dir, { recursive: true, force: true }).catch(() => {})
  }
  return { path: join(await file.dir, 'memory.sqlite'), release }
}

export const sqliteDriver: Driver = {
  async connect(config: ConnectionConfig) {
    const memory = !config.file || config.file === ':memory:'
    const { path, release } = memory ? await memoryFile(config.id) : { path: config.file!, release: async () => {} }
    const name = memory ? 'memory' : path.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, '')
    const session = new SqliteSession({ op: 'open', path, readOnly: !!config.readOnly }, name, release)
    try {
      await session.start()
    } catch (e) {
      session.worker.terminate()
      await release()
      throw failure(e)
    }
    return session
  },
}
