import pg from 'pg'
import Cursor from 'pg-cursor'
import { statementTexts } from '../sql-split.ts'
import { type ColumnInfo, type ConnectionConfig, DbError, type Driver, type IntrospectRequest, type IntrospectResult, type QueryResult, type ResultSet, type RowSink, type Session, type TableInfo } from '../types.ts'
import { normalizeValue, sqlTimestampToIso, STREAM_BATCH } from '../values.ts'
import { tlsOptions } from './tls.ts'

const OID = { date: 1082, timestamp: 1114, timestamptz: 1184, dateArray: 1182, timestampArray: 1115, timestamptzArray: 1185, textArray: 1009 }

type Nested = string | null | Nested[]
const mapNested = (v: Nested, fn: (s: string) => string): Nested => Array.isArray(v) ? v.map(x => mapNested(x, fn)) : v === null ? null : fn(v)
// Date/timestamp arrays are parsed as text arrays, not into JS Date (which would apply the local zone).
const parseTextArray = pg.types.getTypeParser(OID.textArray) as (v: string) => Nested

const types: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
    if (oid === OID.timestamp || oid === OID.timestamptz) return sqlTimestampToIso
    if (oid === OID.date) return (v: string) => v
    if (oid === OID.timestampArray || oid === OID.timestamptzArray) return (v: string) => mapNested(parseTextArray(v), sqlTimestampToIso)
    if (oid === OID.dateArray) return parseTextArray
    return pg.types.getTypeParser(oid, format)
  }) as pg.CustomTypesConfig['getTypeParser'],
}

const DML = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY'])

async function clientConfig(c: ConnectionConfig): Promise<pg.ClientConfig> {
  return {
    host: c.host,
    port: c.port ?? 5432,
    database: c.database,
    user: c.user,
    password: c.password,
    ssl: await tlsOptions(c),
    application_name: 'colwerk',
    connectionTimeoutMillis: 10_000,
    types,
  }
}

function wrap(e: unknown): DbError {
  if (e instanceof DbError) return e
  const err = e as { message?: string, code?: string, position?: string }
  const pos = err.position ? ` (position ${err.position})` : ''
  return new DbError(`${err.message ?? String(e)}${pos}`, err.code)
}

const SQL = {
  schemas: `
    select nspname as name from pg_namespace
    where nspname not like 'pg\\_%' and nspname <> 'information_schema'
    order by nspname`,
  tables: `
    select c.relname as name, case when c.relkind in ('v', 'm') then 'view' else 'table' end as kind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm', 'f')
    order by c.relname`,
  columns: `
    select a.attname as name,
      format_type(a.atttypid, a.atttypmod) as type,
      not a.attnotnull as nullable,
      exists (select 1 from pg_constraint p
              where p.conrelid = c.oid and p.contype = 'p' and a.attnum = any (p.conkey)) as pk,
      (select json_build_object('schema', fn.nspname, 'table', fc.relname, 'column', fa.attname)
         from pg_constraint f
         join pg_class fc on fc.oid = f.confrelid
         join pg_namespace fn on fn.oid = fc.relnamespace
         join pg_attribute fa on fa.attrelid = f.confrelid
                             and fa.attnum = f.confkey[array_position(f.conkey, a.attnum)]
        where f.conrelid = c.oid and f.contype = 'f' and a.attnum = any (f.conkey)
        limit 1) as ref,
      coalesce((select array_agg(ic.relname::text order by ic.relname)
                  from pg_index i join pg_class ic on ic.oid = i.indexrelid
                 where i.indrelid = c.oid and not i.indisprimary
                   and a.attnum = any (i.indkey::int2[])), '{}') as indexes
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped
    order by a.attnum`,
}

class PostgresSession implements Session {
  private typeNames = new Map<number, string>()

  constructor(private client: pg.Client, private config: ConnectionConfig, private pid: number) {}

  // The extended protocol (cursor) accepts one statement only, so scripts run statement by statement,
  // each reading at most `rowLimit + 1` rows. Every statement commits on its own (no implicit transaction).
  async execute(sql: string, { rowLimit }: { rowLimit: number }): Promise<QueryResult> {
    const started = performance.now()
    const statements = statementTexts(sql, 'postgres')
    const resultSets: ResultSet[] = []
    let affectedRows: number | undefined
    for (const [i, statement] of statements.entries()) {
      try {
        const { rows: read, result } = await this.readCursor(statement, rowLimit + 1)
        const fields = result.fields ?? []
        if (fields.length) {
          const truncated = read.length > rowLimit
          const rows = truncated ? read.slice(0, rowLimit) : read
          await this.resolveTypeNames(fields.map(f => f.dataTypeID))
          resultSets.push({
            columns: fields.map(f => ({ name: f.name, type: this.typeNames.get(f.dataTypeID) ?? String(f.dataTypeID) })),
            rows: rows.map(r => r.map(normalizeValue)),
            truncated,
          })
        } else if (result.command && DML.has(result.command)) {
          affectedRows = (affectedRows ?? 0) + (result.rowCount ?? 0)
        }
      } catch (e) {
        const err = wrap(e)
        if (statements.length > 1) err.message = `Statement ${i + 1}: ${err.message}`
        throw err
      }
    }
    return { resultSets, affectedRows: resultSets.length ? undefined : affectedRows, durationMs: performance.now() - started }
  }

  async stream(sql: string, sink: RowSink): Promise<void> {
    const cursor = this.client.query(new Cursor<unknown[]>(sql, undefined, { rowMode: 'array' }))
    const read = () => new Promise<{ rows: unknown[][], result: pg.QueryResult }>((resolve, reject) => {
      cursor.read(STREAM_BATCH, (err, rows, result) => err ? reject(err) : resolve({ rows, result }))
    })
    try {
      let first = true
      for (;;) {
        const { rows, result } = await read()
        if (first) {
          first = false
          // Type names come from the cache only: the client is blocked by the open cursor. Columns of a
          // query run before in this session (the usual case for an export) are always cached.
          const fields = result.fields ?? []
          if (fields.length) sink.columns(fields.map(f => ({ name: f.name, type: this.typeNames.get(f.dataTypeID) ?? String(f.dataTypeID) })))
        }
        if (!rows.length) break
        await sink.rows(rows.map(r => r.map(normalizeValue)))
      }
    } catch (e) {
      throw wrap(e)
    } finally {
      await new Promise(resolve => cursor.close(resolve))
    }
  }

  private readCursor(sql: string, maxRows: number) {
    const cursor = this.client.query(new Cursor<unknown[]>(sql, undefined, { rowMode: 'array' }))
    return new Promise<{ rows: unknown[][], result: pg.QueryResult }>((resolve, reject) => {
      cursor.read(maxRows, (err, rows, result) => {
        cursor.close(() => err ? reject(err) : resolve({ rows, result }))
      })
    })
  }

  private async resolveTypeNames(oids: number[]) {
    const missing = [...new Set(oids)].filter(o => !this.typeNames.has(o))
    if (!missing.length) return
    const res = await this.client.query<{ oid: number, name: string }>(
      'select oid::int as oid, format_type(oid, null) as name from pg_type where oid = any ($1)', [missing])
    for (const r of res.rows) this.typeNames.set(r.oid, r.name)
  }

  async cancel(): Promise<void> {
    const killer = new pg.Client(await clientConfig(this.config))
    try {
      await killer.connect()
      await killer.query('select pg_cancel_backend($1)', [this.pid])
    } catch (e) {
      throw wrap(e)
    } finally {
      await killer.end().catch(() => {})
    }
  }

  async introspect<R extends IntrospectRequest>(req: R): Promise<IntrospectResult<R>> {
    try {
      if (req.kind === 'schemas') {
        return (await this.client.query(SQL.schemas)).rows as IntrospectResult<R>
      }
      if (req.kind === 'tables') {
        const res = await this.client.query<{ name: string, kind: TableInfo['kind'] }>(SQL.tables, [req.schema])
        return res.rows.map(r => ({ schema: req.schema, ...r })) as IntrospectResult<R>
      }
      const res = await this.client.query(SQL.columns, [req.schema, req.table])
      return res.rows.map((r): ColumnInfo => ({
        name: r.name,
        type: r.type,
        nullable: r.nullable,
        primaryKey: r.pk,
        references: r.ref ?? undefined,
        indexes: r.indexes,
      })) as IntrospectResult<R>
    } catch (e) {
      throw wrap(e)
    }
  }

  async close(): Promise<void> {
    await this.client.end().catch(() => {})
  }
}

export const postgresDriver: Driver = {
  async connect(config) {
    const client = new pg.Client(await clientConfig(config))
    try {
      await client.connect()
      const { rows } = await client.query<{ pid: number }>('select pg_backend_pid() as pid')
      // An idle connection may be dropped by the server; surface it on the next call instead of crashing.
      client.on('error', () => {})
      return new PostgresSession(client, config, rows[0]!.pid)
    } catch (e) {
      await client.end().catch(() => {})
      throw wrap(e)
    }
  },
}
