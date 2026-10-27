import type { IntrospectRequest } from '#core'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { request, refresh } = await readBody<{ request: IntrospectRequest, refresh?: boolean }>(event)
  if (!['schemas', 'tables', 'columns', 'indexes', 'routines', 'ddl'].includes(request?.kind)) throw createError({ statusCode: 400, message: 'Invalid request' })
  // A bare string would be sent as text/html.
  if (request.kind === 'ddl') return { ddl: await dbCall(() => workbench.introspect(id, request)) }
  return dbCall(() => workbench.introspect(id, request, refresh === true))
})
