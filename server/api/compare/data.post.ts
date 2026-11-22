import { compareData, dataCompareDialects } from '#core'

// Answers when the comparison is finished; `/api/compare/<id>/cancel` stops it.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: unknown; source: unknown; target: unknown; keys?: unknown; path?: unknown }>(event)
  if (typeof body?.id !== 'string' || !body.id) throw createError({ statusCode: 400, message: 'id is required' })
  const source = parseTableRef(body.source)
  const target = parseTableRef(body.target)
  const request = { id: body.id, source, target, keys: parseKeys(body.keys), path: parsePath(body.path) }
  const dialect = await compareDialect(source.connectionId, target.connectionId, dataCompareDialects)
  const controller = new AbortController()
  runningCompares.set(request.id, controller)
  try {
    return await dbCall(() => compareData(workbench, dialect, request, controller.signal))
  } finally {
    runningCompares.delete(request.id)
  }
})
