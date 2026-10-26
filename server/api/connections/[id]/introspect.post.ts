import type { IntrospectRequest } from '#core'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { request, refresh } = await readBody<{ request: IntrospectRequest, refresh?: boolean }>(event)
  if (!['schemas', 'tables', 'columns'].includes(request?.kind)) throw createError({ statusCode: 400, message: 'Invalid request' })
  return dbCall(() => workbench.introspect(id, request, refresh === true))
})
