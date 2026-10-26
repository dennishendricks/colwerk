import { isAbsolute } from 'node:path'
import { type CellValue, isReadOnlyStatement, type ResultColumn } from '#core'

// Two scopes: with `rows` the rows already shown in the grid are encoded as they are; otherwise
// the statement runs again in the tab's session and its full result is written (no row limit).
// Answers once the file at `path` is complete.
export default defineEventHandler(async (event) => {
  const tabId = getRouterParam(event, 'id')!
  const body = await readBody<{ format: string, path?: string, connectionId?: string, sql?: string, columns?: ResultColumn[], rows?: CellValue[][] }>(event)
  const format = parseFormat(body.format)
  const { path } = body
  if (typeof path !== 'string' || !isAbsolute(path)) throw createError({ statusCode: 400, message: 'path must be an absolute path' })
  if (Array.isArray(body.rows) && Array.isArray(body.columns)) {
    const { columns, rows } = body
    await dbCall(() => writeExport(tabId, format, path, async (sink) => {
      sink.columns(columns)
      await sink.rows(rows)
    }))
    return { ok: true }
  }
  const { connectionId, sql } = body
  if (typeof connectionId !== 'string' || typeof sql !== 'string' || !sql.trim()) {
    throw createError({ statusCode: 400, message: 'connectionId and sql, or columns and rows are required' })
  }
  // Running the statement again must not repeat side effects (DML with RETURNING/OUTPUT, scripts).
  if (!isReadOnlyStatement(sql, (await store.get(connectionId)).dialect)) {
    throw createError({ statusCode: 400, message: 'The full result can only be exported for a single read-only statement' })
  }
  await dbCall(() => writeExport(tabId, format, path, sink => workbench.stream(tabId, connectionId, sql, sink)))
  return { ok: true }
})
