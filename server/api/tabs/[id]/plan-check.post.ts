export default defineEventHandler(async (event) => {
  const tabId = getRouterParam(event, 'id')!
  const { connectionId, database, sql } = await readBody<{ connectionId: string; database?: string; sql: string }>(
    event,
  )
  if (typeof connectionId !== 'string' || typeof sql !== 'string' || !sql.trim()) {
    throw createError({ statusCode: 400, message: 'connectionId and sql are required' })
  }
  return { warnings: await dbCall(() => workbench.planWarnings(tabId, connectionId, sql, parseDatabase(database))) }
})
