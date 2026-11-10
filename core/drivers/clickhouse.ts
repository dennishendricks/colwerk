// ClickHouse through its HTTP interface (node:http/https, no client library). Each statement is one request;
// a `session_id` keeps temporary tables and SET options per Colwerk session.
import { type IncomingMessage, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { splitStatements } from '../sql-split.ts'
import {
  AppError,
  type CellValue,
  type ColumnInfo,
  type ConnectionConfig,
  DbError,
  type Driver,
  type IndexInfo,
  type IntrospectRequest,
  type IntrospectResult,
  type QueryResult,
  type ResultColumn,
  type ResultSet,
  type RowSink,
  type Session,
  type TableInfo,
} from '../types.ts'
import { normalizeValue, STREAM_BATCH } from '../values.ts'
import { tlsOptions } from './tls.ts'

const QUERY_WAS_CANCELLED = '394'

// Output in the unified value model: 64-bit integers and decimals as strings, DateTime in ISO 8601 (UTC, `Z`).
// Errors are written as plain text instead of a JSON row, so they cannot be mistaken for a row.
const SETTINGS = {
  default_format: 'JSONCompactEachRowWithNamesAndTypes',
  output_format_json_quote_64bit_integers: '1',
  output_format_json_quote_decimals: '1',
  output_format_json_quote_denormals: '1',
  date_time_output_format: 'iso',
  http_write_exception_in_output_format: '0',
  // A read stopped at the row limit closes the request; the server then stops the query.
  cancel_http_readonly_queries_on_client_close: '1',
}

// ClickHouse's default `max_session_timeout`; temporary tables and SET options are lost after this idle time.
const SESSION_TIMEOUT = '3600'

interface Endpoint {
  config: ConnectionConfig
  tls: Awaited<ReturnType<typeof tlsOptions>>
}

interface Request {
  queryId?: string
  sessionId?: string
  /** Query parameters, referenced as `{name:Type}` in the SQL. */
  params?: Record<string, string>
}

/** Sends one statement; the response streams. Rejects on HTTP errors with the server's message. */
function send(
  { config, tls }: Endpoint,
  sql: string,
  { queryId, sessionId, params = {} }: Request,
): { response: Promise<IncomingMessage>; abort: () => void } {
  const query = new URLSearchParams({ ...SETTINGS, database: config.database || 'default' })
  if (queryId) query.set('query_id', queryId)
  if (sessionId) {
    query.set('session_id', sessionId)
    query.set('session_timeout', SESSION_TIMEOUT)
  }
  for (const [k, v] of Object.entries(params)) query.set(`param_${k}`, v)
  const request = tls ? httpsRequest : httpRequest
  const req = request({
    method: 'POST',
    host: config.host,
    port: config.port ?? (tls ? 8443 : 8123),
    path: `/?${query}`,
    headers: {
      'X-ClickHouse-User': config.user || 'default',
      'X-ClickHouse-Key': config.password ?? '',
      'Content-Type': 'text/plain; charset=UTF-8',
    },
    timeout: 10_000,
    ...tls,
  })
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    req.on('response', async (res) => {
      // No more socket timeout once the server answers: long statements send their headers late or not at all.
      req.setTimeout(0)
      if (res.statusCode === 200) return resolve(res)
      let text = ''
      try {
        for await (const chunk of res) text += chunk
      } catch {
        // The message read so far is enough.
      }
      reject(serverError(text, res.headers['x-clickhouse-exception-code'] as string | undefined, sql))
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })))
    req.on('error', (e) => reject(wrap(e)))
  })
  req.end(sql)
  return { response, abort: () => req.destroy() }
}

function wrap(e: unknown): DbError {
  if (e instanceof DbError) return e
  const err = e as { message?: string; code?: string }
  return new DbError(err.message ?? String(e), err.code)
}

/** `Code: 62. DB::Exception: Syntax error: failed at position 14 (x): …`; the position counts UTF-8 bytes from 1. */
function serverError(text: string, code: string | undefined, sql: string): DbError {
  const message = text.trim() || `HTTP error${code ? ` ${code}` : ''}`
  // Errors after the response has started carry their code in the text only.
  code ??= /^Code: (\d+)\./.exec(message)?.[1]
  if (code === QUERY_WAS_CANCELLED) return new AppError('cancelled', 'Query was cancelled', { code })
  const at = /failed at position (\d+)/.exec(message)?.[1]
  const position = at
    ? new TextDecoder().decode(new TextEncoder().encode(sql).subarray(0, Number(at) - 1)).length
    : undefined
  return new DbError(message, code, position)
}

/**
 * Reads the response line by line (one JSON array per line): column names, column types, then rows.
 * Stops reading when `onRows` returns false. A line that is no JSON is the server's error text.
 */
async function readResult(
  res: IncomingMessage,
  sql: string,
  onColumns: (columns: ResultColumn[]) => void,
  onRows: (rows: CellValue[][]) => Promise<boolean>,
): Promise<boolean> {
  const decoder = new TextDecoder()
  let buffer = ''
  let names: string[] | undefined
  let columns = false
  let failure: string | undefined
  let batch: CellValue[][] = []

  const flush = async () => {
    const rows = batch
    batch = []
    return !rows.length || (await onRows(rows))
  }

  try {
    for await (const chunk of res) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true })
      if (failure !== undefined) continue
      let eol: number
      while ((eol = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, eol)
        buffer = buffer.slice(eol + 1)
        let values: unknown[]
        try {
          values = JSON.parse(line)
        } catch {
          failure = line
          break
        }
        if (!names) {
          names = values as string[]
        } else if (!columns) {
          onColumns(names.map((name, i) => ({ name, type: String(values[i]) })))
          columns = true
        } else {
          batch.push(values.map(normalizeValue))
          if (batch.length >= STREAM_BATCH && !(await flush())) return false
        }
      }
    }
  } catch (e) {
    // After an error the server breaks off the response.
    if (failure === undefined) throw wrap(e)
  }
  if (failure !== undefined) throw serverError(failure + buffer, undefined, sql)
  return flush()
}

const SQL = {
  databases: `
    select name from system.databases
    where name not in ('system', 'information_schema', 'INFORMATION_SCHEMA')
    order by name`,
  tables: `
    select name, engine in ('View', 'MaterializedView', 'LiveView', 'WindowView') as is_view, total_rows as row_estimate,
      comment, partition_key, sorting_key
    from system.tables where database = {schema:String} and not is_temporary
    order by name`,
  columns: `
    select name, type, is_in_primary_key as pk, comment from system.columns
    where database = {schema:String} and table = {table:String}
    order by position`,
  primaryKey: `select primary_key from system.tables where database = {schema:String} and name = {table:String}`,
  skippingIndexes: `
    select name, expr from system.data_skipping_indices
    where database = {schema:String} and table = {table:String}
    order by name`,
  // SQL user-defined functions belong to no database.
  routines: `select name, 'function' as kind from system.functions where origin = 'SQLUserDefined' order by name`,
  tableDdl: `select create_table_query from system.tables where database = {schema:String} and name = {name:String}`,
  routineDdl: `select create_query from system.functions where origin = 'SQLUserDefined' and name = {name:String}`,
}

// Identifiers of an expression, e.g. of a data skipping index.
const identifiers = (expr: string): string[] => expr.match(/[A-Za-z_]\w*/g) ?? []

class ClickHouseSession implements Session {
  private readonly sessionId = crypto.randomUUID()
  private running?: { queryId: string; abort: () => void }

  constructor(private endpoint: Endpoint) {}

  /** Runs `sql` in the session; `onRows` returning false stops reading (the query is then killed). */
  private async run(
    sql: string,
    onColumns: (columns: ResultColumn[]) => void,
    onRows: (rows: CellValue[][]) => Promise<boolean>,
    params?: Record<string, string>,
  ): Promise<{ written: number }> {
    const queryId = crypto.randomUUID()
    const { response, abort } = send(this.endpoint, sql, { queryId, sessionId: this.sessionId, params })
    this.running = { queryId, abort }
    try {
      const res = await response
      const summary = JSON.parse(String(res.headers['x-clickhouse-summary'] ?? '{}')) as { written_rows?: string }
      if (!(await readResult(res, sql, onColumns, onRows))) {
        abort()
        // The session stays locked until the query has ended on the server.
        await this.kill(queryId)
      }
      return { written: Number(summary.written_rows ?? 0) }
    } finally {
      this.running = undefined
    }
  }

  async execute(sql: string, { rowLimit }: { rowLimit: number }): Promise<QueryResult> {
    const started = performance.now()
    const ranges = splitStatements(sql, 'clickhouse')
    const resultSets: ResultSet[] = []
    let affectedRows: number | undefined
    for (const [i, { from, to }] of ranges.entries()) {
      const statement = sql.slice(from, to)
      let set: ResultSet | undefined
      try {
        const { written } = await this.run(
          statement,
          (columns) => resultSets.push((set = { columns, rows: [], truncated: false, statement: { from, to } })),
          async (rows) => {
            const room = rowLimit - set!.rows.length
            set!.rows.push(...rows.slice(0, room))
            set!.truncated = rows.length > room
            return !set!.truncated
          },
        )
        if (!set) affectedRows = (affectedRows ?? 0) + written
      } catch (e) {
        const err = wrap(e)
        if (err.position !== undefined) err.position += from
        if (ranges.length > 1) err.message = `Statement ${i + 1}: ${err.message}`
        throw err
      }
    }
    return {
      resultSets,
      affectedRows: resultSets.length ? undefined : affectedRows,
      durationMs: performance.now() - started,
    }
  }

  async stream(sql: string, sink: RowSink): Promise<void> {
    let failed: unknown
    await this.run(
      sql,
      (columns) => sink.columns(columns),
      (rows) =>
        sink.rows(rows).then(
          () => true,
          (e) => {
            failed = e
            return false
          },
        ),
    )
    if (failed) throw failed
  }

  async cancel(): Promise<void> {
    if (this.running) await this.kill(this.running.queryId)
  }

  /** Stops a query of this session through a request outside of it (the session is locked while the query runs). */
  private async kill(queryId: string): Promise<void> {
    const { response } = send(this.endpoint, 'kill query where query_id = {id:String} sync', {
      params: { id: queryId },
    })
    const res = await response
    res.resume()
  }

  // Transactions are experimental in ClickHouse and off by default.
  async transactionState(): Promise<undefined> {
    return undefined
  }

  async introspect<R extends IntrospectRequest>(req: R): Promise<IntrospectResult<R>> {
    if (req.kind === 'databases') return (await this.rows<{ name: string }>(SQL.databases)) as IntrospectResult<R>
    // Databases have no schemas: the only one is the database itself.
    if (req.kind === 'schemas') return [{ name: this.endpoint.config.database || 'default' }] as IntrospectResult<R>
    if (req.kind === 'tables') {
      const rows = await this.rows<{
        name: string
        is_view: number
        row_estimate: string | null
        comment: string
        partition_key: string
        sorting_key: string
      }>(SQL.tables, { schema: req.schema })
      return rows.map((t): TableInfo => ({
        schema: req.schema,
        name: t.name,
        kind: t.is_view ? 'view' : 'table',
        rowEstimate: t.is_view || t.row_estimate === null ? null : Number(t.row_estimate),
        comment: t.comment || null,
        partitioning: t.partition_key || null,
        clustering: t.sorting_key ? `ORDER BY (${t.sorting_key})` : null,
      })) as IntrospectResult<R>
    }
    if (req.kind === 'routines') return (await this.rows<{ name: string }>(SQL.routines)) as IntrospectResult<R>
    if (req.kind === 'ddl') {
      const sql = req.object === 'routine' ? SQL.routineDdl : SQL.tableDdl
      const ddl = await this.rows<Record<string, string>>(sql, { schema: req.schema, name: req.name })
      if (!ddl.length) {
        throw new AppError('objectNotFound', `${req.schema}.${req.name} not found`, {
          params: { name: `${req.schema}.${req.name}` },
        })
      }
      return ddl.map((r) => `${Object.values(r)[0]};`).join('\n\n') as IntrospectResult<R>
    }
    const params = { schema: req.schema, table: req.table }
    const skipping = await this.rows<{ name: string; expr: string }>(SQL.skippingIndexes, params)
    if (req.kind === 'indexes') {
      // The primary key orders the data and is not unique.
      const [table] = await this.rows<{ primary_key: string }>(SQL.primaryKey, params)
      return [
        ...(table?.primary_key
          ? [{ name: 'PRIMARY KEY', columns: table.primary_key.split(', '), unique: false, primary: true }]
          : []),
        ...skipping.map((i): IndexInfo => ({ name: i.name, columns: [i.expr], unique: false, primary: false })),
      ] as IntrospectResult<R>
    }
    const columns = await this.rows<{ name: string; type: string; pk: number; comment: string }>(SQL.columns, params)
    return columns.map((c): ColumnInfo => ({
      name: c.name,
      type: c.type,
      nullable: /^(LowCardinality\()?Nullable\(/.test(c.type),
      primaryKey: c.pk === 1,
      indexes: skipping.filter((i) => identifiers(i.expr).includes(c.name)).map((i) => i.name),
      comment: c.comment || null,
    })) as IntrospectResult<R>
  }

  async close(): Promise<void> {
    await this.cancel().catch(() => {})
  }

  /** Rows as objects, outside of the session (introspection must not wait for a running statement). */
  private async rows<T>(sql: string, params?: Record<string, string>): Promise<T[]> {
    const out: T[] = []
    let names: string[] = []
    const res = await send(this.endpoint, sql, { params }).response
    await readResult(
      res,
      sql,
      (columns) => (names = columns.map((c) => c.name)),
      async (rows) => {
        for (const row of rows) out.push(Object.fromEntries(names.map((n, i) => [n, row[i]])) as T)
        return true
      },
    )
    return out
  }
}

export const clickhouseDriver: Driver = {
  async connect(config) {
    const session = new ClickHouseSession({ config, tls: await tlsOptions(config) })
    // Checks address and login.
    await session.execute('select 1', { rowLimit: 1 })
    return session
  },
}
