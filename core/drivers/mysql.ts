import mysql from 'mysql2'
import type { Connection, ConnectionOptions, FieldPacket, ResultSetHeader, TypeCast } from 'mysql2'
import { splitStatements } from '../sql-split.ts'
import { AppError, type ColumnInfo, type ConnectionConfig, DbError, type Driver, type IndexInfo, type IntrospectRequest, type IntrospectResult, type QueryResult, type ResultColumn, type RowSink, type Session, type TableInfo, type TransactionState } from '../types.ts'
import { normalizeValue, sqlTimestampToIso, STREAM_BATCH } from '../values.ts'
import { tlsOptions } from './tls.ts'

const ER_QUERY_INTERRUPTED = 1317
// mysql2 maps type ids to names and vice versa in one object.
const typeNames = mysql.Types as unknown as Record<number, string>

// The session runs with time_zone '+00:00', so TIMESTAMP values are UTC; DATETIME has no zone.
const typeCast: TypeCast = (field, next) => {
  if (field.type === 'TIMESTAMP' || field.type === 'TIMESTAMP2') {
    const v = field.string()
    return v === null ? null : `${sqlTimestampToIso(v)}Z`
  }
  if (field.type === 'DATETIME' || field.type === 'DATETIME2') {
    const v = field.string()
    return v === null ? null : sqlTimestampToIso(v)
  }
  return next()
}

async function options(c: ConnectionConfig): Promise<ConnectionOptions> {
  return {
    host: c.host,
    port: c.port ?? 3306,
    database: c.database,
    user: c.user,
    password: c.password,
    ssl: await tlsOptions(c),
    connectTimeout: 10_000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    dateStrings: true,
    multipleStatements: true,
    typeCast,
  }
}

function resultColumns(fields: FieldPacket[]): ResultColumn[] {
  return fields.map(f => ({ name: f.name, type: typeNames[f.columnType ?? -1] ?? String(f.columnType) }))
}

/** `sql`: the text that was sent, to locate a syntax error in it. */
function wrap(e: unknown, sql?: string): DbError {
  if (e instanceof DbError) return e
  const err = e as { message?: string, code?: string }
  const message = err.message ?? String(e)
  return new DbError(message, err.code, sql === undefined ? undefined : syntaxErrorPosition(sql, message))
}

/**
 * Syntax errors quote the rest of the script from the error on ("… near 'x;\nselect 2' at line 1"),
 * without trailing whitespace and cut after 80 characters (MariaDB appends "..."). The line number
 * counts from the failing statement only, so the quoted text is looked up instead.
 */
function syntaxErrorPosition(sql: string, message: string): number | undefined {
  const near = /near '([\s\S]*)' at line \d+$/.exec(message)?.[1]
  if (near === undefined) return undefined
  const rest = sql.trimEnd()
  if (rest.endsWith(near)) return rest.length - near.length
  const at = sql.indexOf(near.replace(/\.\.\.$/, ''))
  return at === -1 ? undefined : at
}

async function connect(config: ConnectionConfig): Promise<Connection> {
  const conn = mysql.createConnection(await options(config))
  return new Promise((resolve, reject) => {
    conn.connect((err) => {
      if (err) return reject(wrap(err))
      // An idle connection may be dropped by the server; surface it on the next call instead of crashing.
      conn.on('error', () => {})
      resolve(conn)
    })
  })
}

const SQL = {
  // information_schema only lists the databases the login has privileges on.
  databases: `
    select schema_name as name from information_schema.schemata
    where schema_name not in ('information_schema', 'mysql', 'performance_schema', 'sys')
    order by schema_name`,
  schemas: `
    select schema_name as name from information_schema.schemata
    where (database() is null or schema_name = database())
      and schema_name not in ('information_schema', 'mysql', 'performance_schema', 'sys')
    order by schema_name`,
  tables: `
    select t.table_name as name, if(t.table_type = 'VIEW', 'view', 'table') as kind,
      if(t.table_type = 'VIEW', null, t.table_rows) as row_estimate,
      -- Views carry the comment 'VIEW'.
      nullif(if(t.table_type = 'VIEW', '', t.table_comment), '') as comment,
      (select concat(p.partition_method, ' (', p.partition_expression, ')') from information_schema.partitions p
        where p.table_schema = t.table_schema and p.table_name = t.table_name and p.partition_method is not null
        limit 1) as partitioning
    from information_schema.tables t where t.table_schema = ? order by t.table_name`,
  columns: `
    select c.column_name as name, c.column_type as type, c.is_nullable = 'YES' as nullable,
      c.column_key = 'PRI' as pk,
      k.referenced_table_schema as ref_schema, k.referenced_table_name as ref_table, k.referenced_column_name as ref_column,
      (select group_concat(distinct s.index_name order by s.index_name separator '\\n')
         from information_schema.statistics s
        where s.table_schema = c.table_schema and s.table_name = c.table_name
          and s.column_name = c.column_name and s.index_name <> 'PRIMARY') as idx,
      nullif(c.column_comment, '') as comment
    from information_schema.columns c
    left join information_schema.key_column_usage k
      on k.table_schema = c.table_schema and k.table_name = c.table_name
     and k.column_name = c.column_name and k.referenced_table_name is not null
    where c.table_schema = ? and c.table_name = ?
    order by c.ordinal_position`,
  indexes: `
    select index_name as name, group_concat(column_name order by seq_in_index separator '\\n') as cols,
      non_unique = 0 as is_unique
    from information_schema.statistics where table_schema = ? and table_name = ?
    group by index_name, non_unique
    order by index_name = 'PRIMARY' desc, index_name`,
  routines: `
    select routine_name as name, lower(routine_type) as kind from information_schema.routines
    where routine_schema = ? order by routine_name`,
  // A function and a procedure may share a name.
  routineTypes: `
    select routine_type as type from information_schema.routines
    where routine_schema = ? and routine_name = ? order by routine_type`,
}

class MysqlSession implements Session {
  private running = false
  private stopReason: 'limit' | 'cancel' | null = null

  constructor(private conn: Connection, private config: ConnectionConfig) {}

  execute(sql: string, { rowLimit }: { rowLimit: number }): Promise<QueryResult> {
    const started = performance.now()
    this.running = true
    this.stopReason = null
    // `KILL QUERY` would also drop the statements after the truncated one, so scripts read the rest and discard it.
    const single = splitStatements(sql, 'mysql').length <= 1
    const sets: { columns: ResultColumn[], rows: unknown[][], truncated: boolean }[] = []
    let affectedRows: number | undefined
    let limitKill: Promise<void> = Promise.resolve()

    return new Promise<QueryResult>((resolve, reject) => {
      const query = this.conn.query({ sql, rowsAsArray: true })
      query.on('fields', (f: FieldPacket[] | undefined) => {
        // A new result set starts (undefined for statements without rows).
        if (f) sets.push({ columns: resultColumns(f), rows: [], truncated: false })
      })
      query.on('result', (row: unknown[] | ResultSetHeader) => {
        if (!Array.isArray(row)) {
          affectedRows = (affectedRows ?? 0) + row.affectedRows
          return
        }
        const set = sets.at(-1)!
        if (set.rows.length < rowLimit) {
          set.rows.push(row)
        } else if (!set.truncated) {
          set.truncated = true
          if (!single) return
          // Enough rows: abort the statement on the server instead of streaming the rest.
          this.stopReason = 'limit'
          limitKill = this.kill().catch(() => {})
        }
      })
      query.on('error', (err: { errno?: number }) => {
        if (err.errno === ER_QUERY_INTERRUPTED && this.stopReason === 'limit') return
        this.running = false
        reject(err.errno === ER_QUERY_INTERRUPTED ? new AppError('cancelled', 'Query was cancelled', { code: 'ER_QUERY_INTERRUPTED' }) : wrap(err, sql))
      })
      query.on('end', async () => {
        if (!this.running) return
        // The kill must not reach the server after the next statement has started.
        await limitKill
        this.running = false
        resolve({
          resultSets: sets.map(s => ({ ...s, rows: s.rows.map(r => r.map(normalizeValue)) })),
          affectedRows: sets.length ? undefined : affectedRows,
          durationMs: performance.now() - started,
        })
      })
    })
  }

  stream(sql: string, sink: RowSink): Promise<void> {
    this.running = true
    this.stopReason = null
    let resultSets = 0
    let batch: unknown[][] = []
    let pending: Promise<void> = Promise.resolve()
    let failed: unknown

    // Pauses reading from the socket until the sink has taken the batch; a failing sink kills the query.
    const flush = () => {
      if (!batch.length || failed) return
      const rows = batch.map(r => r.map(normalizeValue))
      batch = []
      this.conn.pause()
      pending = sink.rows(rows).then(() => this.conn.resume(), (e) => {
        failed = e
        this.stopReason = 'cancel'
        this.conn.resume()
        return this.kill().catch(() => {})
      })
    }

    return new Promise<void>((resolve, reject) => {
      const query = this.conn.query({ sql, rowsAsArray: true })
      query.on('fields', (f: FieldPacket[] | undefined) => {
        if (!f) return
        flush()
        if (++resultSets === 1) sink.columns(resultColumns(f))
      })
      query.on('result', (row: unknown[] | ResultSetHeader) => {
        if (!Array.isArray(row) || resultSets !== 1 || failed) return
        batch.push(row)
        if (batch.length >= STREAM_BATCH) flush()
      })
      query.on('error', (err: { errno?: number }) => {
        this.running = false
        reject(failed ?? (err.errno === ER_QUERY_INTERRUPTED ? new AppError('cancelled', 'Query was cancelled', { code: 'ER_QUERY_INTERRUPTED' }) : wrap(err)))
      })
      query.on('end', async () => {
        if (!this.running) return
        flush()
        await pending
        this.running = false
        if (failed) reject(failed)
        else resolve()
      })
    })
  }

  async cancel(): Promise<void> {
    if (!this.running) return
    this.stopReason = 'cancel'
    await this.kill()
  }

  private async kill() {
    const killer = await connect(this.config)
    try {
      await killer.promise().query(`kill query ${Number(this.conn.threadId)}`)
    } finally {
      killer.destroy()
    }
  }

  // MariaDB only; MySQL has no such variable, the query fails and the state stays unknown.
  async transactionState(): Promise<TransactionState | undefined> {
    const [rows] = await this.conn.promise().query({ sql: 'select @@in_transaction', rowsAsArray: true })
    return Number((rows as unknown[][])[0]![0]) ? 'open' : 'idle'
  }

  async introspect<R extends IntrospectRequest>(req: R): Promise<IntrospectResult<R>> {
    const db = this.conn.promise()
    try {
      if (req.kind === 'databases') return (await db.query(SQL.databases))[0] as IntrospectResult<R>
      if (req.kind === 'schemas') return (await db.query(SQL.schemas))[0] as IntrospectResult<R>
      if (req.kind === 'tables') {
        const [rows] = await db.query(SQL.tables, [req.schema])
        type Row = Pick<TableInfo, 'name' | 'kind' | 'comment' | 'partitioning'> & { row_estimate: string | number | null }
        return (rows as Row[]).map(({ row_estimate, ...r }): TableInfo => ({
          schema: req.schema,
          ...r,
          rowEstimate: row_estimate === null ? null : Number(row_estimate),
          clustering: null,
        })) as IntrospectResult<R>
      }
      if (req.kind === 'indexes') {
        const [rows] = await db.query(SQL.indexes, [req.schema, req.table])
        return (rows as { name: string, cols: string | null, is_unique: string | number }[]).map((r): IndexInfo => ({
          name: r.name,
          // Functional indexes (MySQL 8) have no column name.
          columns: r.cols ? r.cols.split('\n') : [],
          unique: Number(r.is_unique) === 1,
          primary: r.name === 'PRIMARY',
        })) as IntrospectResult<R>
      }
      if (req.kind === 'routines') return (await db.query(SQL.routines, [req.schema]))[0] as IntrospectResult<R>
      if (req.kind === 'ddl') {
        const types = req.object === 'routine'
          ? ((await db.query(SQL.routineTypes, [req.schema, req.name]))[0] as { type: string }[]).map(r => r.type)
          : [req.object.toUpperCase()]
        if (!types.length) throw new AppError('objectNotFound', `${req.schema}.${req.name} not found`, { params: { name: `${req.schema}.${req.name}` } })
        const ddl: string[] = []
        for (const type of types) {
          // The statement's text is in the column `Create Table`, `Create View`, `Create Function` or `Create Procedure`.
          const [rows] = await db.query(`show create ${type} ??.??`, [req.schema, req.name])
          const row = (rows as Record<string, string>[])[0]!
          ddl.push(`${row[`Create ${type[0]}${type.slice(1).toLowerCase()}`]};`)
        }
        return ddl.join('\n\n') as IntrospectResult<R>
      }
      const [rows] = await db.query(SQL.columns, [req.schema, req.table])
      const seen = new Set<string>()
      return (rows as Record<string, string | number | null>[])
        // A column in several foreign keys appears once per key; keep the first.
        .filter(r => !seen.has(r.name as string) && seen.add(r.name as string))
        .map((r): ColumnInfo => ({
          name: r.name as string,
          type: r.type as string,
          nullable: Number(r.nullable) === 1,
          primaryKey: Number(r.pk) === 1,
          references: r.ref_table
            ? { schema: r.ref_schema as string, table: r.ref_table as string, column: r.ref_column as string }
            : undefined,
          indexes: r.idx ? String(r.idx).split('\n') : [],
          comment: r.comment as string | null,
        })) as IntrospectResult<R>
    } catch (e) {
      throw wrap(e)
    }
  }

  async close(): Promise<void> {
    await this.conn.promise().end().catch(() => this.conn.destroy())
  }
}

export const mysqlDriver: Driver = {
  async connect(config) {
    const conn = await connect(config)
    try {
      await conn.promise().query(`set time_zone = '+00:00'`)
    } catch (e) {
      conn.destroy()
      throw wrap(e)
    }
    return new MysqlSession(conn, config)
  },
}
