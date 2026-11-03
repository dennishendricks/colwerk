// Runtime-agnostic contracts shared by drivers, the server layer and (type-only) the UI.

export type Dialect = 'postgres' | 'mysql' | 'mssql' | 'duckdb' | 'sqlite'

/** Marking colors for connections, e.g. red for production. */
export const connectionColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export type ConnectionColor = typeof connectionColors[number]

/**
 * Login of a network connection (default `password`):
 * - `windows`: SQL Server Windows login over NTLM with `domain`, `user` and `password`
 * - `entra-default`: Microsoft Entra token from the environment (Azure CLI `az login`, Azure PowerShell, azd, environment variables)
 * - `entra-interactive`: Microsoft Entra login in the system browser (with MFA); `user` is the account to suggest
 * - `entra-service-principal`: Microsoft Entra application with `clientId`, `tenantId` and the client secret in `password`
 */
export const connectionAuths = [
  'password',
  'windows',
  'entra-default',
  'entra-interactive',
  'entra-service-principal',
] as const
export type ConnectionAuth = typeof connectionAuths[number]

/** SQL Server: order of day, month and year when strings are converted to dates. */
export const dateFormats = ['mdy', 'dmy', 'ymd', 'ydm', 'myd', 'dym'] as const
export type DateFormat = typeof dateFormats[number]

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
  /** Network databases: how the login is authenticated (see ConnectionAuth); undefined = `password`. */
  auth?: ConnectionAuth
  /** SQL Server Windows login: domain of the account. */
  domain?: string
  /** Entra: directory (tenant) ID; optional except for service principals. */
  tenantId?: string
  /** Entra: application (client) ID; optional except for service principals. */
  clientId?: string
  /** PostgreSQL, MySQL: Unix socket (PostgreSQL: its directory; MySQL on Windows: named pipe) instead of host and port. */
  socket?: string
  /** PostgreSQL: `search_path` of the session. */
  searchPath?: string
  /** SQL Server: named instance, resolved through the SQL Server Browser service instead of the port. */
  instanceName?: string
  /** SQL Server: request read-only access (ApplicationIntent=ReadOnly), e.g. for readable Availability Group replicas. */
  readOnlyIntent?: boolean
  /** SQL Server: MultiSubnetFailover=True for faster reconnects to Availability Group listeners. */
  multiSubnetFailover?: boolean
  /** SQL Server: login retries on transient errors (driver default 3), e.g. while Azure SQL serverless resumes. */
  connectRetries?: number
  /** SQL Server: session language (`SET LANGUAGE`), e.g. `Deutsch`. */
  language?: string
  /** SQL Server: session date format (`SET DATEFORMAT`). */
  dateFormat?: DateFormat
  ssl?: boolean
  /** TLS: path to the CA certificate (PEM) the server certificate must chain to, instead of the system CAs (self-signed servers). */
  sslCa?: string
  /** TLS: skip certificate verification (encrypted, but open to man-in-the-middle). */
  sslInsecure?: boolean
  /** SQL Server TLS: TDS 8.0 strict encryption (TLS before the login handshake, required by some SQL Server 2022 / Azure setups). */
  sslStrict?: boolean
  /** SQL Server TLS: host name the server certificate must be issued for, when connecting through an IP address or alias. */
  sslServerName?: string
  /** DuckDB, SQLite: path to the database file, or `:memory:`. */
  file?: string
  /** DuckDB, SQLite: open the database file read-only. */
  readOnly?: boolean
  /** DuckDB: create a new database file in the storage format of DuckDB 1.4, so that DuckDB 1.x can open it. */
  v1Storage?: boolean
  /** Marks the connection in the UI (connection list, tabs, query toolbar). */
  color?: ConnectionColor
  /** Ask before running statements that may write (UI only; the database itself is not restricted). */
  confirmWrites?: boolean
}

export interface DriverCapabilities {
  /** A running statement can be aborted from another call. */
  supportsCancel: boolean
  /** The database has a schema level between database and tables. */
  supportsSchemas: boolean
  /** Connections need host/port/user (false for embedded databases such as DuckDB and SQLite). */
  supportsNetwork: boolean
  /** The server holds several databases a connection can switch between (the configured one is the default). */
  supportsDatabases: boolean
  /** An open session locks the database for other processes (embedded databases such as DuckDB); the UI offers to disconnect. */
  locksDatabase: boolean
}

export interface DriverInfo {
  dialect: Dialect
  label: string
  defaultPort?: number
  /** Logins the driver supports (network databases only); the first is the default. */
  auths: ConnectionAuth[]
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
 * - geometries (DuckDB, PostGIS, MySQL) as WKT, prefixed with `SRID=…;` when the value carries an SRID
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
  /** Transaction state of the session after the statement; undefined if the driver cannot tell. */
  transaction?: TransactionState
}

/** `failed`: a statement failed inside the transaction, only `ROLLBACK` is accepted (Postgres, DuckDB, SQL Server `XACT_STATE() = -1`). */
export type TransactionState = 'idle' | 'open' | 'failed'

export interface ExecuteOptions {
  rowLimit: number
}

export interface DatabaseInfo {
  name: string
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
  references?: { schema: string; table: string; column: string }
  /** Names of indexes the column participates in (excluding the primary key). */
  indexes: string[]
  comment: string | null
}

export interface IndexInfo {
  name: string
  /** Key columns in index order (expressions of expression indexes where the database reports them). */
  columns: string[]
  unique: boolean
  primary: boolean
}

export interface RoutineInfo {
  name: string
  kind: 'function' | 'procedure'
}

export type IntrospectRequest =
  /** Databases the login has access to. */
  | { kind: 'databases' }
  | { kind: 'schemas' }
  | { kind: 'tables'; schema: string }
  | { kind: 'columns'; schema: string; table: string }
  | { kind: 'indexes'; schema: string; table: string }
  | { kind: 'routines'; schema: string }
  /** Source of a table, view or routine (all overloads of the name); never cached. */
  | { kind: 'ddl'; schema: string; name: string; object: 'table' | 'view' | 'routine' }

export type IntrospectResult<R extends IntrospectRequest> = R extends { kind: 'databases' } ? DatabaseInfo[]
  : R extends { kind: 'schemas' } ? SchemaInfo[]
  : R extends { kind: 'tables' } ? TableInfo[]
  : R extends { kind: 'columns' } ? ColumnInfo[]
  : R extends { kind: 'indexes' } ? IndexInfo[]
  : R extends { kind: 'routines' } ? RoutineInfo[]
  : string

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
  /** Whether the session is inside a transaction; undefined if the driver cannot tell. Called between statements only. */
  transactionState(): Promise<TransactionState | undefined>
  introspect<R extends IntrospectRequest>(request: R): Promise<IntrospectResult<R>>
  close(): Promise<void>
}

export interface Driver {
  connect(config: ConnectionConfig): Promise<Session>
}

export class DbError extends Error {
  /** Transaction state after a failed `execute`, set by the workbench. */
  transaction?: TransactionState

  /** `position`: 0-based character offset of the error in the SQL passed to `Session.execute`, if the database reports it. */
  constructor(message: string, readonly code?: string, public position?: number) {
    super(message)
    this.name = 'DbError'
  }
}

/**
 * A DbError raised by Colwerk itself rather than the database. `key` names its text in the UI's locale files
 * (`errors.<key>`, filled with `params`); `message` stays English for logs, the history and MCP clients.
 */
export class AppError extends DbError {
  readonly params?: Record<string, string | number>

  constructor(
    readonly key: string,
    message: string,
    options: { code?: string; params?: Record<string, string | number> } = {},
  ) {
    super(message, options.code)
    this.params = options.params
  }
}
