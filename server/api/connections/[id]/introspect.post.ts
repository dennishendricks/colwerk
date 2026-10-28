import type { IntrospectRequest } from '#core'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { request, refresh, database } = await readBody<{ request: IntrospectRequest, refresh?: boolean, database?: string }>(event)
  if (!['databases', 'schemas', 'tables', 'columns', 'indexes', 'routines', 'ddl'].includes(request?.kind)) throw createError({ statusCode: 400, message: 'Invalid request' })
  const db = parseDatabase(database)
  // A bare string would be sent as text/html.
  if (request.kind === 'ddl') return { ddl: await dbCall(() => workbench.introspect(id, request, false, db)) }
  return dbCall(() => workbench.introspect(id, request, refresh === true, db))
})
