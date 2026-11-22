const MAX_TIMEOUT = 86_400
const MAX_STATEMENTS = 10_000

export default defineEventHandler(async (event) => {
  const tabId = getRouterParam(event, 'id')!
  const { connectionId, database, statements, timeout } = await readBody<{
    connectionId: string
    database?: string
    statements: string[]
    timeout?: number
  }>(event)
  if (
    typeof connectionId !== 'string' ||
    !Array.isArray(statements) ||
    !statements.length ||
    statements.length > MAX_STATEMENTS ||
    statements.some((s) => typeof s !== 'string' || !s.trim())
  ) {
    throw createError({ statusCode: 400, message: 'connectionId and statements are required' })
  }
  const seconds = Math.min(Math.max(Math.trunc(Number(timeout) || 60), 1), MAX_TIMEOUT)
  const db = parseDatabase(database)
  const executedAt = new Date().toISOString()
  const sql = statements.map((s) => `${s};`).join('\n')
  try {
    const result = await dbCall(() => workbench.applyEdits(tabId, connectionId, statements, seconds, db))
    recordHistory({ connectionId, sql, executedAt, durationMs: result.durationMs, affectedRows: result.affectedRows })
    return result
  } catch (e) {
    recordHistory({
      connectionId,
      sql,
      executedAt,
      durationMs: Date.now() - Date.parse(executedAt),
      error: (e as Error).message,
    })
    throw e
  }
})
