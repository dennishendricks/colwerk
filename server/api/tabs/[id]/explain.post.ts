const MAX_TIMEOUT = 86_400

export default defineEventHandler(async (event) => {
  const tabId = getRouterParam(event, 'id')!
  const { connectionId, sql, analyze, timeout } = await readBody<{ connectionId: string, sql: string, analyze?: boolean, timeout?: number }>(event)
  if (typeof connectionId !== 'string' || typeof sql !== 'string' || !sql.trim()) {
    throw createError({ statusCode: 400, message: 'connectionId and sql are required' })
  }
  const seconds = Math.min(Math.max(Math.trunc(Number(timeout) || 60), 1), MAX_TIMEOUT)
  return dbCall(() => workbench.explain(tabId, connectionId, sql, analyze === true, seconds))
})
