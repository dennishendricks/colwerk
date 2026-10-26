import { type ConnectionSummary, type Dialect, isSelectStatement, type QueryResult, type SchemaInfo, type TableInfo } from '#core'

// Shared by the tools in server/mcp/tools. Every tool except open-query only reads.

/** Statement timeout for queries run by an MCP client. */
const QUERY_TIMEOUT_SECONDS = 30

export async function connectionOf(connectionId: string): Promise<ConnectionSummary> {
  const config = (await store.list()).find(c => c.id === connectionId)
  if (!config) throw createError({ statusCode: 404, message: `Unknown connectionId '${connectionId}'. Call list-connections for valid ids.` })
  return config
}

/** MySQL schemas are databases; every other connection is bound to the one database it was configured with. */
export function databasesOf(connection: ConnectionSummary, schemas?: SchemaInfo[]): string[] {
  if (connection.dialect === 'mysql' && schemas) return schemas.map(s => s.name)
  const database = connection.database ?? connection.file
  return database ? [database] : []
}

export async function tableOf(connectionId: string, schema: string, table: string): Promise<TableInfo> {
  await connectionOf(connectionId)
  const tables = await dbCall(() => workbench.introspect(connectionId, { kind: 'tables', schema }))
  const info = tables.find(t => t.name === table)
  if (!info) throw createError({ statusCode: 404, message: `Table '${table}' not found in schema '${schema}'. Call list-tables for valid names.` })
  return info
}

export function quoteIdent(name: string, dialect: Dialect): string {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`
  return `"${name.replaceAll('"', '""')}"`
}

// Opens a transaction that is never committed: closing the session rolls back whatever the statement
// changed. Second line of defence behind `isSelectStatement`, which is a text heuristic.
const GUARD: Record<Dialect, string> = {
  postgres: 'begin read only',
  mysql: 'start transaction read only',
  mssql: 'set implicit_transactions on',
  duckdb: 'begin transaction',
}

/** Runs one SELECT/WITH statement in a session of its own, closed afterwards. */
export async function readQuery(connectionId: string, sql: string, rowLimit: number): Promise<QueryResult> {
  const { dialect } = await connectionOf(connectionId)
  if (!isSelectStatement(sql, dialect)) throw createError({ statusCode: 400, message: 'Only a single SELECT or WITH statement is allowed.' })
  const tabId = `mcp:${crypto.randomUUID()}`
  try {
    return await dbCall(async () => {
      await workbench.execute(tabId, connectionId, GUARD[dialect], 1, QUERY_TIMEOUT_SECONDS)
      return workbench.execute(tabId, connectionId, sql, rowLimit, QUERY_TIMEOUT_SECONDS)
    })
  } finally {
    await workbench.closeTab(tabId)
  }
}
