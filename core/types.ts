// Runtime-agnostic contracts shared by drivers, the server layer and (type-only) the UI.

export type Dialect = 'postgres' | 'mysql' | 'mssql' | 'duckdb'

export interface ConnectionConfig {
  id: string
  name: string
  /** Folder in the connection list (one level, empty = top level). */
  folder?: string
  dialect: Dialect
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  ssl?: boolean
  /** TLS: path to the CA certificate (PEM) the server certificate must chain to, instead of the system CAs (self-signed servers). */
  sslCa?: string
  /** TLS: skip certificate verification (encrypted, but open to man-in-the-middle). */
  sslInsecure?: boolean
  /** DuckDB: path to the database file, or `:memory:`. */
  file?: string
  /** DuckDB: open the database file read-only. */
  readOnly?: boolean
}

export interface DriverCapabilities {
  /** A running statement can be aborted from another call. */
  supportsCancel: boolean
  /** The database has a schema level between database and tables. */
  supportsSchemas: boolean
  /** Connections need host/port/user (false for embedded databases such as DuckDB). */
  supportsNetwork: boolean
}

export interface DriverInfo {
  dialect: Dialect
  label: string
  defaultPort?: number
  capabilities: DriverCapabilities
}

export interface DriverStatus extends DriverInfo {
  /** False while the native library still has to be downloaded (DuckDB in packaged builds). */
  installed: boolean
  /** Share downloaded (0–1) while an installation runs and the size is known. */
  installProgress?: number
}

/**
 * Unified value model returned by every driver:
 * - BIGINT and DECIMAL/NUMERIC as string (no precision loss)
 * - timestamps/dates as ISO-8601 string
 * - binary data as hex string with `0x` prefix
 * - everything else as JSON-compatible value (number, string, boolean, null, arrays, objects)
 */
export type CellValue = string | number | boolean | null | CellValue[] | { [key: string]: CellValue }

export interface ResultColumn {
  name: string
  /** Database type name as reported by the driver (informational). */
  type: string
}

export interface ResultSet {
  columns: ResultColumn[]
  rows: CellValue[][]
  /** True when more rows existed than `rowLimit`. */
  truncated: boolean
}

export interface QueryResult {
  /** Every result set with rows, in order; `rowLimit` applies to each. */
  resultSets: ResultSet[]
  /** Rows affected by DML, when the driver reports it and no result set was returned. */
  affectedRows?: number
  durationMs: number
}

export interface ExecuteOptions {
  rowLimit: number
}

export interface SchemaInfo {
  name: string
}

export interface TableInfo {
  schema: string
  name: string
  kind: 'table' | 'view'
  /** Row count from the catalog statistics; null for views or when the statistics are missing. */
  rowEstimate: number | null
  comment: string | null
  /** Partitioning definition (e.g. `RANGE (placed_at)`), null if not partitioned. */
  partitioning: string | null
  /** Index the rows are physically ordered by, null if none. */
  clustering: string | null
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  /** Set when the column is part of a foreign key. */
  references?: { schema: string, table: string, column: string }
  /** Names of indexes the column participates in (excluding the primary key). */
  indexes: string[]
  comment: string | null
}

export type IntrospectRequest =
  | { kind: 'schemas' }
  | { kind: 'tables', schema: string }
  | { kind: 'columns', schema: string, table: string }

export type IntrospectResult<R extends IntrospectRequest> =
  R extends { kind: 'schemas' } ? SchemaInfo[]
    : R extends { kind: 'tables' } ? TableInfo[]
      : ColumnInfo[]

/** Receives a streamed result. `rows` is awaited (backpressure); if it rejects, the statement is aborted. */
export interface RowSink {
  columns(columns: ResultColumn[]): void
  rows(rows: CellValue[][]): Promise<void>
}

/** One dedicated database connection. */
export interface Session {
  execute(sql: string, options: ExecuteOptions): Promise<QueryResult>
  /** Streams every row of the first result set to `sink`, without row limit. */
  stream(sql: string, sink: RowSink): Promise<void>
  /** Aborts the statement currently running in this session (no-op if idle). */
  cancel(): Promise<void>
  introspect<R extends IntrospectRequest>(request: R): Promise<IntrospectResult<R>>
  close(): Promise<void>
}

export interface Driver {
  connect(config: ConnectionConfig): Promise<Session>
}

export class DbError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'DbError'
  }
}
