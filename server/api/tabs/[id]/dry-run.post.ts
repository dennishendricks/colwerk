const MAX_TIMEOUT = 86_400

export default defineEventHandler(async (event) => {
  const tabId = getRouterParam(event, 'id')!
  const { connectionId, database, sql, timeout } = await readBody<{
    connectionId: string
    database?: string
    sql: string
    timeout?: number
  }>(event)
  if (typeof connectionId !== 'string' || typeof sql !== 'string' || !sql.trim()) {
    throw createError({ statusCode: 400, message: 'connectionId and sql are required' })
  }
  const seconds = Math.min(Math.max(Math.trunc(Number(timeout) || 60), 1), MAX_TIMEOUT)
  return dbCall(() => workbench.dryRun(tabId, connectionId, sql, seconds, parseDatabase(database)))
})
