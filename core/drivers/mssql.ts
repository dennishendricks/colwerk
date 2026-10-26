import sql from 'mssql'
import { splitStatements, statementTexts } from '../sql-split.ts'
import { type CellValue, type ColumnInfo, type ConnectionConfig, DbError, type Driver, type IntrospectRequest, type IntrospectResult, type QueryResult, type ResultColumn, type ResultSet, type RowSink, type SchemaInfo, type Session, type TableInfo } from '../types.ts'
import { normalizeValue, STREAM_BATCH } from '../values.ts'
import { tlsOptions } from './tls.ts'

type ColumnMeta = sql.IColumnMetadata[string]

function wrap(e: unknown): DbError {
  if (e instanceof DbError) return e
  const err = e as { message?: string, code?: string, number?: number, lineNumber?: number }
  const line = err.lineNumber ? ` (line ${err.lineNumber})` : ''
  return new DbError(`${err.message ?? String(e)}${line}`, err.code ?? (err.number ? String(err.number) : undefined))
}

function typeName(col: ColumnMeta): string {
  const name = String((col.type as { declaration?: string }).declaration ?? '')
  if (['varchar', 'nvarchar', 'char', 'nchar', 'varbinary', 'binary'].includes(name)) {
    return `${name}(${col.length > 8000 || col.length < 0 ? 'max' : col.length})`
  }
  if (name === 'decimal' || name === 'numeric') return `${name}(${col.precision},${col.scale})`
  return name
}

// tedious delivers temporal values as Date in UTC (useUTC). Types without zone drop the trailing `Z`.
function cell(value: unknown, type: string): CellValue {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString()
    if (type === 'date') return iso.slice(0, 10)
    if (type === 'time') return iso.slice(11, -1)
    if (type === 'datetimeoffset') return iso
    return iso.slice(0, -1)
  }
  // DECIMAL/NUMERIC/MONEY arrive as JS numbers (see README: known limitations); keep the unified string form.
  if (typeof value === 'number' && /^(decimal|numeric|money|smallmoney)/.test(type)) return String(value)
  return normalizeValue(value)
}

const SQL = {
  schemas: `
    select name from sys.schemas
    where name not in ('sys', 'INFORMATION_SCHEMA', 'guest') and schema_id < 16384
    order by name`,
  tables: `
    select o.name, case o.type when 'V' then 'view' else 'table' end as kind,
      (select sum(p.rows) from sys.partitions p
        where p.object_id = o.object_id and p.index_id in (0, 1) and o.type = 'U') as row_estimate,
      (select cast(e.value as nvarchar(max)) from sys.extended_properties e
        where e.class = 1 and e.major_id = o.object_id and e.minor_id = 0 and e.name = 'MS_Description') as comment,
      (select top 1 ps.name + ' (' + pc.name + ')' from sys.indexes i
         join sys.partition_schemes ps on ps.data_space_id = i.data_space_id
         join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id and ic.partition_ordinal > 0
         join sys.columns pc on pc.object_id = ic.object_id and pc.column_id = ic.column_id
        where i.object_id = o.object_id and i.index_id in (0, 1)) as partitioning,
      (select i.name from sys.indexes i where i.object_id = o.object_id and i.type = 1) as clustering
    from sys.objects o where o.schema_id = schema_id(@schema) and o.type in ('U', 'V')
    order by o.name`,
  columns: `
    select c.name,
      type_name(c.user_type_id) + case
        when type_name(c.user_type_id) in ('varchar', 'char', 'varbinary', 'binary')
          then '(' + case c.max_length when -1 then 'max' else cast(c.max_length as varchar) end + ')'
        when type_name(c.user_type_id) in ('nvarchar', 'nchar')
          then '(' + case c.max_length when -1 then 'max' else cast(c.max_length / 2 as varchar) end + ')'
        when type_name(c.user_type_id) in ('decimal', 'numeric')
          then '(' + cast(c.precision as varchar) + ',' + cast(c.scale as varchar) + ')'
        else '' end as type,
      c.is_nullable as nullable,
      cast(case when pk.column_id is null then 0 else 1 end as bit) as pk,
      fk.ref_schema, fk.ref_table, fk.ref_column,
      ix.idx,
      (select cast(e.value as nvarchar(max)) from sys.extended_properties e
        where e.class = 1 and e.major_id = c.object_id and e.minor_id = c.column_id and e.name = 'MS_Description') as comment
    from sys.columns c
    outer apply (
      select top 1 ic.column_id from sys.index_columns ic
      join sys.indexes i on i.object_id = ic.object_id and i.index_id = ic.index_id
      where i.is_primary_key = 1 and ic.object_id = c.object_id and ic.column_id = c.column_id) pk
    outer apply (
      select top 1 schema_name(o.schema_id) as ref_schema, o.name as ref_table, rc.name as ref_column
      from sys.foreign_key_columns f
      join sys.objects o on o.object_id = f.referenced_object_id
      join sys.columns rc on rc.object_id = f.referenced_object_id and rc.column_id = f.referenced_column_id
      where f.parent_object_id = c.object_id and f.parent_column_id = c.column_id) fk
    outer apply (
      select string_agg(i.name, char(10)) within group (order by i.name) as idx
      from sys.index_columns ic
      join sys.indexes i on i.object_id = ic.object_id and i.index_id = ic.index_id
      where ic.object_id = c.object_id and ic.column_id = c.column_id
        and i.is_primary_key = 0 and i.name is not null) ix
    where c.object_id = object_id(quotename(@schema) + '.' + quotename(@table))
    order by c.column_id`,
}

class MssqlSession implements Session {
  private current: sql.Request | null = null
  private stopReason: 'limit' | 'cancel' | null = null

  constructor(private pool: sql.ConnectionPool) {}

  // `GO` is a client-side separator: the batches are sent one after another (variables do not survive a `GO`).
  async execute(text: string, { rowLimit }: { rowLimit: number }): Promise<QueryResult> {
    const started = performance.now()
    this.stopReason = null
    const batches = statementTexts(text, 'mssql', { semicolons: false })
    const resultSets: ResultSet[] = []
    let affectedRows: number | undefined
    for (const [i, batch] of batches.entries()) {
      try {
        const n = await this.runBatch(batch, rowLimit, resultSets)
        if (n !== undefined) affectedRows = (affectedRows ?? 0) + n
      } catch (e) {
        const err = wrap(e)
        if (batches.length > 1) err.message = `Batch ${i + 1}: ${err.message}`
        throw err
      }
    }
    return { resultSets, affectedRows: resultSets.length ? undefined : affectedRows, durationMs: performance.now() - started }
  }

  /** Runs one batch, appends its result sets and resolves with the affected rows. */
  private runBatch(text: string, rowLimit: number, resultSets: ResultSet[]): Promise<number | undefined> {
    if (this.stopReason === 'cancel') return Promise.reject(new DbError('Query was cancelled', 'ECANCEL'))
    const request = new sql.Request(this.pool)
    request.stream = true
    request.arrayRowMode = true
    this.current = request
    this.stopReason = null
    // Cancelling would also drop the statements after the truncated one, so batches with several
    // statements read the rest and discard it. Statements are counted at `;`, which is optional in T-SQL.
    const single = splitStatements(text, 'mssql').length <= 1
    const sets: { columns: ResultColumn[], rows: unknown[][], truncated: boolean }[] = []
    let affectedRows: number | undefined
    let error: unknown

    return new Promise<number | undefined>((resolve, reject) => {
      request.on('recordset', (cols: ColumnMeta[]) => {
        sets.push({ columns: cols.map(c => ({ name: c.name, type: typeName(c) })), rows: [], truncated: false })
      })
      request.on('row', (row: unknown[]) => {
        const set = sets.at(-1)!
        if (set.rows.length < rowLimit) {
          set.rows.push(row)
        } else if (!set.truncated) {
          set.truncated = true
          if (!single) return
          this.stopReason = 'limit'
          request.cancel()
        }
      })
      request.on('rowsaffected', (n: number) => (affectedRows = (affectedRows ?? 0) + n))
      request.on('error', (e: { code?: string }) => {
        if (e.code === 'ECANCEL' && this.stopReason === 'limit') return
        error ??= e.code === 'ECANCEL' ? new DbError('Query was cancelled', 'ECANCEL') : e
      })
      request.on('done', () => {
        this.current = null
        if (error) return reject(wrap(error))
        for (const s of sets) {
          resultSets.push({ ...s, rows: s.rows.map(r => r.map((v, i) => cell(v, s.columns[i]!.type))) })
        }
        resolve(affectedRows)
      })
      request.batch(text)
    })
  }

  stream(text: string, sink: RowSink): Promise<void> {
    const request = new sql.Request(this.pool)
    request.stream = true
    request.arrayRowMode = true
    this.current = request
    this.stopReason = null
    let types: string[] | undefined
    let active = false
    let batch: unknown[][] = []
    let pending: Promise<void> = Promise.resolve()
    let failed: unknown
    let error: unknown

    // Pauses the request until the sink has taken the batch; a failing sink cancels the request.
    const flush = () => {
      if (!batch.length || failed) return
      const rows = batch.map(r => r.map((v, i) => cell(v, types![i]!)))
      batch = []
      request.pause()
      pending = sink.rows(rows).then(() => void request.resume(), (e) => {
        failed = e
        request.resume()
        request.cancel()
      })
    }

    return new Promise<void>((resolve, reject) => {
      request.on('recordset', (cols: ColumnMeta[]) => {
        flush()
        // Only the first result set is streamed; later ones are drained.
        active = !types
        if (!active) return
        const columns = cols.map(c => ({ name: c.name, type: typeName(c) }))
        types = columns.map(c => c.type)
        sink.columns(columns)
      })
      request.on('row', (row: unknown[]) => {
        if (!active || failed) return
        batch.push(row)
        if (batch.length >= STREAM_BATCH) flush()
      })
      request.on('error', (e: { code?: string }) => {
        error ??= e.code === 'ECANCEL' ? new DbError('Query was cancelled', 'ECANCEL') : e
      })
      request.on('done', async () => {
        flush()
        await pending
        this.current = null
        if (failed) reject(failed)
        else if (error) reject(wrap(error))
        else resolve()
      })
      request.batch(text)
    })
  }

  // Also between two batches, when no request is running: the next batch is not started.
  async cancel(): Promise<void> {
    this.stopReason = 'cancel'
    this.current?.cancel()
  }

  async introspect<R extends IntrospectRequest>(req: R): Promise<IntrospectResult<R>> {
    try {
      const request = this.pool.request()
      if (req.kind === 'schemas') return [...(await request.query<SchemaInfo>(SQL.schemas)).recordset] as IntrospectResult<R>
      request.input('schema', sql.NVarChar, req.schema)
      if (req.kind === 'tables') {
        // sum() of bigint arrives as string.
        const { recordset } = await request.query<Omit<TableInfo, 'schema' | 'rowEstimate'> & { row_estimate: string | null }>(SQL.tables)
        return recordset.map(({ row_estimate, ...r }): TableInfo => ({
          schema: req.schema,
          ...r,
          rowEstimate: row_estimate === null ? null : Number(row_estimate),
        })) as IntrospectResult<R>
      }
      request.input('table', sql.NVarChar, req.table)
      const { recordset } = await request.query(SQL.columns)
      return recordset.map((r): ColumnInfo => ({
        name: r.name,
        type: r.type,
        nullable: r.nullable,
        primaryKey: r.pk,
        references: r.ref_table ? { schema: r.ref_schema, table: r.ref_table, column: r.ref_column } : undefined,
        indexes: r.idx ? String(r.idx).split('\n') : [],
        comment: r.comment,
      })) as IntrospectResult<R>
    } catch (e) {
      throw wrap(e)
    }
  }

  async close(): Promise<void> {
    await this.pool.close().catch(() => {})
  }
}

export const mssqlDriver: Driver = {
  async connect(config: ConnectionConfig) {
    const tls = await tlsOptions(config)
    // A pool of exactly one long-lived connection: session state (temp tables, transactions) survives between calls.
    const pool = new sql.ConnectionPool({
      server: config.host ?? 'localhost',
      port: config.port ?? 1433,
      database: config.database,
      user: config.user,
      password: config.password,
      connectionTimeout: 10_000,
      requestTimeout: 0,
      options: {
        encrypt: !!tls,
        trustServerCertificate: tls ? !tls.rejectUnauthorized : false,
        cryptoCredentialsDetails: tls?.ca ? { ca: tls.ca } : undefined,
        appName: 'colwerk',
      },
      pool: { min: 1, max: 1, idleTimeoutMillis: 2_147_483_647 },
    })
    // An idle connection may be dropped by the server; surface it on the next call instead of crashing.
    pool.on('error', () => {})
    try {
      await pool.connect()
      return new MssqlSession(pool)
    } catch (e) {
      await pool.close().catch(() => {})
      throw wrap(e)
    }
  },
}
