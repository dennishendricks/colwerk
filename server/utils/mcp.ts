import { AsyncLocalStorage } from 'node:async_hooks'
import {
  AppError,
  type ConnectionSummary,
  type Dialect,
  isSelectStatement,
  ownMcpSessions,
  type QueryResult,
  type SchemaInfo,
  type SplitDialect,
  sqlDialect,
  type TableInfo,
} from '#core'

// Shared by the tools in server/mcp/tools. Every tool except open-query only reads.

// Sandboxed DuckDB sessions read the file as of their opening; they are closed once no MCP request runs anymore,
// so the next request sees the editor's changes and the file is not held.
const sandboxes = new Set<string>()
let running = 0
const client = new AsyncLocalStorage<string>()

/** Runs one MCP request of `clientName` (server/mcp/index.ts). */
export async function mcpRequest<T>(clientName: string, next: () => Promise<T>): Promise<T> {
  running++
  try {
    return await client.run(clientName, next)
  } finally {
    if (--running === 0) {
      const ids = [...sandboxes]
      sandboxes.clear()
      await Promise.all(ids.map((id) => workbench.closeConnection(id)))
    }
  }
}

/** Statement timeout for queries run by an MCP client. */
const QUERY_TIMEOUT_SECONDS = 30

export async function connectionOf(connectionId: string): Promise<ConnectionSummary> {
  const config = (await store.list()).find((c) => c.id === connectionId)
  if (!config) {
    throw createError({
      statusCode: 404,
      message: `Unknown connectionId '${connectionId}'. Call list-connections for valid ids.`,
    })
  }
  return config
}

/** Workbench id of the connection's MCP sessions (see ownMcpSessions); call inside dbCall. */
export function sessionId(connection: ConnectionSummary): string {
  if (workbench.isDisconnected(connection.id)) {
    throw new AppError('disconnected', 'The connection is disconnected.', { code: 'EDISCONNECTED' })
  }
  if (!ownMcpSessions(connection)) return connection.id
  const id = `mcp:${connection.id}`
  if (connection.dialect === 'duckdb') sandboxes.add(id)
  return id
}

// Details a tool call adds to its audit entry while it runs (readQuery fills in the SQL and row count).
const auditing = new AsyncLocalStorage<{ sql?: string; rowCount?: number }>()

/** Runs a tool call and records it in the audit log (server/utils/audit.ts), also when it fails. Never records result rows. */
export async function audited<T>(
  tool: string,
  connectionId: string | undefined,
  fn: () => Promise<T>,
  sql?: string,
): Promise<T> {
  const details: { sql?: string; rowCount?: number } = { sql }
  const at = new Date().toISOString()
  const started = performance.now()
  let failure: { message: string; timeout: boolean } | undefined
  try {
    return await auditing.run(details, fn)
  } catch (e) {
    const code = (e as { data?: { code?: string } }).data?.code ?? (e as { code?: string }).code
    failure = { message: (e as Error).message, timeout: code === 'ETIMEOUT' }
    throw e
  } finally {
    const connection = connectionId
      ? (await store.list().catch(() => [])).find((c) => c.id === connectionId)
      : undefined
    recordAudit({
      at,
      client: client.getStore() ?? 'unknown',
      tool,
      connectionId,
      connectionName: connection?.name,
      ...details,
      durationMs: Math.round(performance.now() - started),
      status: !failure ? 'ok' : failure.timeout ? 'timeout' : 'error',
      error: failure?.message.slice(0, 1000),
    })
  }
}

/** MySQL schemas are databases; every other connection is bound to the one database it was configured with. */
export function databasesOf(connection: ConnectionSummary, schemas?: SchemaInfo[]): string[] {
  if (connection.dialect === 'mysql' && schemas) return schemas.map((s) => s.name)
  const database = connection.database ?? connection.file
  return database ? [database] : []
}

export async function tableOf(connectionId: string, schema: string, table: string): Promise<TableInfo> {
  const connection = await connectionOf(connectionId)
  const tables = await dbCall(() => workbench.introspect(sessionId(connection), { kind: 'tables', schema }))
  const info = tables.find((t) => t.name === table)
  if (!info) {
    throw createError({
      statusCode: 404,
      message: `Table '${table}' not found in schema '${schema}'. Call list-tables for valid names.`,
    })
  }
  return info
}

export function quoteIdent(name: string, dialect: Dialect): string {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`
  return `"${name.replaceAll('"', '""')}"`
}

// Opens a transaction that is never committed: closing the session rolls back whatever the statement
// changed (SQLite: the session's connection refuses writes). Second line of defence behind `isSelectStatement`,
// which is a text heuristic.
// ClickHouse has no transactions: `readonly = 2` refuses writes for the rest of the session but still accepts the
// settings Colwerk sends with every request.
const GUARD: Record<SplitDialect, string> = {
  postgres: 'begin read only',
  mysql: 'start transaction read only',
  mssql: 'set implicit_transactions on',
  duckdb: 'begin transaction',
  sqlite: 'pragma query_only = on',
  clickhouse: 'set readonly = 2',
}

/** Runs one SELECT/WITH statement in a session of its own, closed afterwards. */
export async function readQuery(connectionId: string, sql: string, rowLimit: number): Promise<QueryResult> {
  const connection = await connectionOf(connectionId)
  const dialect = sqlDialect(connection.dialect)
  const details = auditing.getStore()
  // Before the check, so that refused SQL is logged too.
  if (details) details.sql = sql
  if (!isSelectStatement(sql, dialect)) {
    throw createError({ statusCode: 400, message: 'Only a single SELECT or WITH statement is allowed.' })
  }
  const tabId = `mcp:${crypto.randomUUID()}`
  try {
    const result = await dbCall(async () => {
      const id = sessionId(connection)
      await workbench.execute(tabId, id, GUARD[dialect], 1, QUERY_TIMEOUT_SECONDS)
      return workbench.execute(tabId, id, sql, rowLimit, QUERY_TIMEOUT_SECONDS)
    })
    if (details) details.rowCount = result.resultSets[0]?.rows.length ?? 0
    return result
  } finally {
    await workbench.closeTab(tabId)
  }
}
