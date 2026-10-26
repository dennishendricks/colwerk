import { DuckDBBlobValue, type DuckDBConnection, type DuckDBInstance, DuckDBInstanceCache, type Json, JsonDuckDBValueConverter, ResultReturnType } from '@duckdb/node-api'
import { statementTexts } from '../sql-split.ts'
import { type CellValue, type ColumnInfo, type ConnectionConfig, DbError, type Driver, type IntrospectRequest, type IntrospectResult, type QueryResult, type ResultSet, type RowSink, type SchemaInfo, type Session, type TableInfo } from '../types.ts'
import { sqlTimestampToIso, toHex } from '../values.ts'

// One database file can only be opened once per process and configuration; sessions share the instance.
// One cache per access mode: switching a connection to read-only would otherwise collide with the
// read-write instance until it is garbage-collected.
const instances = { readWrite: new DuckDBInstanceCache(), readOnly: new DuckDBInstanceCache() }

function wrap(e: unknown): DbError {
  return e instanceof DbError ? e : new DbError(e instanceof Error ? e.message : String(e))
}

const SQL = {
  schemas: `
    select schema_name as name from duckdb_schemas()
    where database_name = current_database() and schema_name not in ('information_schema', 'pg_catalog')
    order by 1`,
  tables: `
    select table_name as name, 'table' as kind from duckdb_tables()
      where database_name = current_database() and schema_name = $1
    union all
    select view_name, 'view' from duckdb_views()
      where database_name = current_database() and schema_name = $1 and not internal
    order by 1`,
  columns: `
    select column_name as name, data_type as type, is_nullable as nullable from duckdb_columns()
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
  // The session keeps its instance alive: once the instance object is garbage-collected while connections
  // are still open, DuckDB's instance cache spins forever in the next `getOrCreateInstance` for that file.
  constructor(private instance: DuckDBInstance, private conn: DuckDBConnection) {}

  // Scripts run statement by statement, so every result set is returned and limited on its own.
  async execute(sql: string, { rowLimit }: { rowLimit: number }): Promise<QueryResult> {
    const started = performance.now()
    const statements = statementTexts(sql, 'duckdb')
    const resultSets: ResultSet[] = []
    let affectedRows: number | undefined
    for (const [i, statement] of statements.entries()) {
      try {
        const reader = await this.conn.streamAndReadUntil(statement, rowLimit + 1)
        if (reader.rowsChanged) affectedRows = (affectedRows ?? 0) + reader.rowsChanged
        // DML reports its count as a single column `Count`, DDL returns nothing; only queries become result sets.
        if (reader.returnType !== ResultReturnType.QUERY_RESULT) continue
        const types = reader.columnTypes().map(t => t.toString())
        const count = Math.min(reader.currentRowCount, rowLimit)
        const json = reader.getRowsJson().slice(0, count)
        const raw = types.some(t => t === 'BLOB') ? reader.getRows().slice(0, count) : []
        resultSets.push({
          columns: reader.columnNames().map((name, i) => ({ name, type: types[i]! })),
          rows: json.map((row, r) => row.map((v, c) => cell(v, types[c]!, raw[r]?.[c]))),
          truncated: !reader.done || reader.currentRowCount > rowLimit,
        })
      } catch (e) {
        const err = wrap(e)
        if (statements.length > 1) err.message = `Statement ${i + 1}: ${err.message}`
        throw err
      }
    }
    return { resultSets, affectedRows: resultSets.length ? undefined : affectedRows, durationMs: performance.now() - started }
  }

  async stream(sql: string, sink: RowSink): Promise<void> {
    try {
      const result = await this.conn.stream(sql)
      const types = result.columnTypes().map(t => t.toString())
      sink.columns(result.columnNames().map((name, i) => ({ name, type: types[i]! })))
      const hasBlob = types.includes('BLOB')
      for (let chunk = await result.fetchChunk(); chunk?.rowCount; chunk = await result.fetchChunk()) {
        const raw = hasBlob ? chunk.getRows() : []
        await sink.rows(chunk.convertRows(JsonDuckDBValueConverter).map((row, r) => row.map((v, c) => cell(v, types[c]!, raw[r]?.[c]))))
      }
    } catch (e) {
      throw wrap(e)
    }
  }

  async cancel(): Promise<void> {
    this.conn.interrupt()
  }

  async introspect<R extends IntrospectRequest>(req: R): Promise<IntrospectResult<R>> {
    try {
      if (req.kind === 'schemas') return await this.rows<SchemaInfo>(SQL.schemas) as IntrospectResult<R>
      if (req.kind === 'tables') {
        const tables = await this.rows<{ name: string, kind: TableInfo['kind'] }>(SQL.tables, [req.schema])
        return tables.map(t => ({ schema: req.schema, ...t })) as IntrospectResult<R>
      }
      const params = [req.schema, req.table]
      const [columns, constraints, indexes] = await Promise.all([
        this.rows<{ name: string, type: string, nullable: boolean }>(SQL.columns, params),
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

  async close(): Promise<void> {
    this.conn.closeSync()
  }

  private async rows<T>(sql: string, params: string[] = []): Promise<T[]> {
    return (await this.conn.runAndReadAll(sql, params)).getRowObjectsJS() as T[]
  }
}

function cell(json: Json, type: string, raw: unknown): CellValue {
  if (json === null) return null
  if (raw instanceof DuckDBBlobValue) return toHex(raw.bytes)
  if (type.startsWith('TIMESTAMP') && typeof json === 'string') return sqlTimestampToIso(json)
  return json as CellValue
}

export const duckdbDriver: Driver = {
  async connect(config: ConnectionConfig) {
    try {
      // Named in-memory databases keep one shared database per connection across all its sessions.
      const path = !config.file || config.file === ':memory:' ? `:memory:${config.id}` : config.file
      const instance = config.readOnly
        ? await instances.readOnly.getOrCreateInstance(path, { access_mode: 'READ_ONLY' })
        : await instances.readWrite.getOrCreateInstance(path)
      return new DuckDBSession(instance, await instance.connect())
    } catch (e) {
      throw wrap(e)
    }
  },
}
