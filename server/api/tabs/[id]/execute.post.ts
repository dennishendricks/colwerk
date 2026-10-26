const MAX_ROW_LIMIT = 100_000
const MAX_TIMEOUT = 86_400

export default defineEventHandler(async (event) => {
  const tabId = getRouterParam(event, 'id')!
  const { connectionId, sql, rowLimit, timeout } = await readBody<{ connectionId: string, sql: string, rowLimit?: number, timeout?: number }>(event)
  if (typeof connectionId !== 'string' || typeof sql !== 'string' || !sql.trim()) {
    throw createError({ statusCode: 400, message: 'connectionId and sql are required' })
  }
  const limit = Math.min(Math.max(Math.trunc(Number(rowLimit) || 200), 1), MAX_ROW_LIMIT)
  const seconds = Math.min(Math.max(Math.trunc(Number(timeout) || 60), 1), MAX_TIMEOUT)
  return dbCall(() => workbench.execute(tabId, connectionId, sql, limit, seconds))
})
