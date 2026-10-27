import { statementTexts } from '../sql-split.ts'
import { type CellValue, type ColumnInfo, type ConnectionConfig, DbError, type Driver, type IntrospectRequest, type IntrospectResult, type QueryResult, type ResultSet, type RowSink, type SchemaInfo, type Session, type TableInfo, type TransactionState } from '../types.ts'
import { connect, type Connection } from './duckdb-ffi.ts'

function wrap(e: unknown): DbError {
  return e instanceof DbError ? e : new DbError(e instanceof Error ? e.message : String(e))
}

const SQL = {
  schemas: `
    select schema_name as name from duckdb_schemas()
    where database_name = current_database() and schema_name not in ('information_schema', 'pg_catalog')
    order by 1`,
  tables: `
    select table_name as name, 'table' as kind, estimated_size as row_estimate, comment from duckdb_tables()
      where database_name = current_database() and schema_name = $1
    union all
    select view_name, 'view', null, comment from duckdb_views()
      where database_name = current_database() and schema_name = $1 and not internal
    order by 1`,
  columns: `
    select column_name as name, data_type as type, is_nullable as nullable, comment from duckdb_columns()
    where database_name = current_database() and schema_name = $1 and table_name = $2
    order by column_index`,
  constraints: `
    select constraint_type as type, constraint_name as name, constraint_column_names as cols,
           referenced_table as ref_table, referenced_column_names as ref_cols
    from duckdb_constraints()
    where database_name = current_database() and schema_name = $1 and table_name = $2
      and constraint_type in ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')`,
  indexes: `
    select index_name as name, expressions from duckdb_indexes()
    where database_name = current_database() and schema_name = $1 and table_name = $2`,
}

class DuckDBSession implements Session {
  // Statements run one after another: a new statement on the connection invalidates a streaming result,
  // and the connection may only be closed once no native call uses it anymore.
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private conn: Connection) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn)
    this.queue = run.catch(() => {})
    return run
  }

  // Scripts run statement by statement, so every result set is returned and limited on its own.
  execute(sql: string, { rowLimit }: { rowLimit: number }): Promise<QueryResult> {
    return this.serial(async () => {
      const started = performance.now()
      const statements = statementTexts(sql, 'duckdb')
      const resultSets: ResultSet[] = []
      let affectedRows: number | undefined
      for (const [i, statement] of statements.entries()) {
        try {
          const result = await this.conn.query(statement)
          try {
            if (result.rowsChanged) affectedRows = (affectedRows ?? 0) + result.rowsChanged
            // DML reports its count as a single column `Count`, DDL returns nothing; only queries become result sets.
            if (!result.isQuery) continue
            const rows: CellValue[][] = []
            for (let chunk; rows.length <= rowLimit && (chunk = await result.next());) rows.push(...chunk)
            resultSets.push({ columns: result.columns, rows: rows.slice(0, rowLimit), truncated: rows.length > rowLimit })
          } finally {
            result.close()
          }
        } catch (e) {
          const err = wrap(e)
          if (statements.length > 1) err.message = `Statement ${i + 1}: ${err.message}`
          throw err
        }
      }
      return { resultSets, affectedRows: resultSets.length ? undefined : affectedRows, durationMs: performance.now() - started }
    })
  }

  stream(sql: string, sink: RowSink): Promise<void> {
    return this.serial(async () => {
      try {
        const result = await this.conn.query(sql)
        try {
          sink.columns(result.columns)
          for (let chunk; (chunk = await result.next());) await sink.rows(chunk)
        } finally {
          result.close()
        }
      } catch (e) {
        throw wrap(e)
      }
    })
  }

  async cancel(): Promise<void> {
    this.conn.interrupt()
  }

  // The C API does not expose the transaction state. Outside a transaction every statement gets a new
  // transaction id; after a failed statement in a transaction every statement fails until ROLLBACK.
  async transactionState(): Promise<TransactionState | undefined> {
    const id = async () => (await this.rows<{ id: string }>('select txid_current() as id'))[0]!.id
    try {
      return await id() === await id() ? 'open' : 'idle'
    } catch (e) {
      if (wrap(e).message.includes('Current transaction is aborted')) return 'failed'
      throw e
    }
  }

  async introspect<R extends IntrospectRequest>(req: R): Promise<IntrospectResult<R>> {
    try {
      if (req.kind === 'schemas') return await this.rows<SchemaInfo>(SQL.schemas) as IntrospectResult<R>
      if (req.kind === 'tables') {
        const tables = await this.rows<{ name: string, kind: TableInfo['kind'], row_estimate: string | null, comment: string | null }>(SQL.tables, [req.schema])
        return tables.map(({ row_estimate, ...t }): TableInfo => ({
          schema: req.schema,
          ...t,
          rowEstimate: row_estimate === null ? null : Number(row_estimate),
          partitioning: null,
          clustering: null,
        })) as IntrospectResult<R>
      }
      const params = [req.schema, req.table]
      const [columns, constraints, indexes] = await Promise.all([
        this.rows<{ name: string, type: string, nullable: boolean, comment: string | null }>(SQL.columns, params),
        this.rows<{ type: string, name: string, cols: string[], ref_table: string | null, ref_cols: string[] }>(SQL.constraints, params),
        this.rows<{ name: string, expressions: string }>(SQL.indexes, params),
      ])
      return columns.map((c): ColumnInfo => {
        const fk = constraints.find(k => k.type === 'FOREIGN KEY' && k.cols.includes(c.name))
        const refColumn = fk?.ref_table ? fk.ref_cols[fk.cols.indexOf(c.name)] : undefined
        return {
          ...c,
          primaryKey: constraints.some(k => k.type === 'PRIMARY KEY' && k.cols.includes(c.name)),
          // duckdb_constraints() has no referenced schema; DuckDB only allows FKs within one schema.
          references: fk?.ref_table && refColumn ? { schema: req.schema, table: fk.ref_table, column: refColumn } : undefined,
          indexes: [
            ...constraints.filter(k => k.type === 'UNIQUE' && k.cols.includes(c.name)).map(k => k.name),
            // `expressions` looks like "[col_a, col_b]"; expression indexes simply don't match a column.
            ...indexes.filter(i => i.expressions.slice(1, -1).split(', ').includes(c.name)).map(i => i.name),
          ].sort(),
        }
      }) as IntrospectResult<R>
    } catch (e) {
      throw wrap(e)
    }
  }

  // Interrupts a running statement (e.g. when its tab is closed) and closes once it has ended.
  async close(): Promise<void> {
    this.conn.interrupt()
    await this.serial(async () => this.conn.close())
  }

  private rows<T>(sql: string, params: string[] = []): Promise<T[]> {
    return this.serial(async () => {
      const result = await this.conn.query(sql, params)
      try {
        const rows: T[] = []
        for (let chunk; (chunk = await result.next());) {
          for (const row of chunk) rows.push(Object.fromEntries(result.columns.map((c, i) => [c.name, row[i]])) as T)
        }
        return rows
      } finally {
        result.close()
      }
    })
  }
}

export const duckdbDriver: Driver = {
  async connect(config: ConnectionConfig) {
    try {
      // Named in-memory databases keep one shared database per connection across all its sessions.
      const path = !config.file || config.file === ':memory:' ? `:memory:${config.id}` : config.file
      return new DuckDBSession(await connect(path, !!config.readOnly))
    } catch (e) {
      throw wrap(e)
    }
  },
}
