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
  return ownMcpSessions(connection) ? `mcp:${connection.id}` : connection.id
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
  if (!isSelectStatement(sql, dialect)) {
    throw createError({ statusCode: 400, message: 'Only a single SELECT or WITH statement is allowed.' })
  }
  const tabId = `mcp:${crypto.randomUUID()}`
  try {
    return await dbCall(async () => {
      const id = sessionId(connection)
      await workbench.execute(tabId, id, GUARD[dialect], 1, QUERY_TIMEOUT_SECONDS)
      return workbench.execute(tabId, id, sql, rowLimit, QUERY_TIMEOUT_SECONDS)
    })
  } finally {
    await workbench.closeTab(tabId)
  }
}
