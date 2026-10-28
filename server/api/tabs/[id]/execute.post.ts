const MAX_ROW_LIMIT = 100_000
const MAX_TIMEOUT = 86_400

export default defineEventHandler(async (event) => {
  const tabId = getRouterParam(event, 'id')!
  const { connectionId, database, sql, rowLimit, timeout } = await readBody<{ connectionId: string, database?: string, sql: string, rowLimit?: number, timeout?: number }>(event)
  if (typeof connectionId !== 'string' || typeof sql !== 'string' || !sql.trim()) {
    throw createError({ statusCode: 400, message: 'connectionId and sql are required' })
  }
  const limit = Math.min(Math.max(Math.trunc(Number(rowLimit) || 200), 1), MAX_ROW_LIMIT)
  const seconds = Math.min(Math.max(Math.trunc(Number(timeout) || 60), 1), MAX_TIMEOUT)
  const db = parseDatabase(database)
  const executedAt = new Date().toISOString()
  try {
    const result = await dbCall(() => workbench.execute(tabId, connectionId, sql, limit, seconds, db))
    const { durationMs, affectedRows, resultSets } = result
    recordHistory({ connectionId, sql, executedAt, durationMs, rowCount: resultSets.at(-1)?.rows.length, affectedRows })
    return result
  } catch (e) {
    recordHistory({ connectionId, sql, executedAt, durationMs: Date.now() - Date.parse(executedAt), error: (e as Error).message })
    throw e
  }
})
