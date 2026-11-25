import { isAbsolute } from 'node:path'
import { type CellValue, type ExportOptions, isReadOnlyStatement, type ResultColumn, sqlDialect } from '#core'

// Two scopes: with `rows` the rows already shown in the grid are encoded as they are; otherwise
// the statement runs again in the tab's session and its full result is written (no row limit).
// INSERT statements are written in the dialect of the connection the result came from.
// Answers once the file at `path` is complete.
export default defineEventHandler(async (event) => {
  const tabId = getRouterParam(event, 'id')!
  const body = await readBody<{
    format: string
    path?: string
    connectionId?: string
    database?: string
    sql?: string
    columns?: ResultColumn[]
    rows?: CellValue[][]
    insert?: { table: string[]; batchSize: number }
    /** Mask PII columns (core/masking.ts); the connection's column lists apply if `connectionId` is given. */
    mask?: boolean
  }>(event)
  const format = parseFormat(body.format)
  const { path } = body
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw createError({ statusCode: 400, message: 'path must be an absolute path' })
  }
  const { connectionId, sql } = body
  let options: ExportOptions | undefined
  if (format === 'insert') {
    if (typeof connectionId !== 'string') throw createError({ statusCode: 400, message: 'connectionId is required' })
    options = parseInsertOptions(body.insert, sqlDialect((await store.get(connectionId)).dialect))
  }
  // CSV as chosen in the settings dialog.
  const csv = format === 'csv' ? (await getSettings()).csv : undefined
  const mask =
    body.mask === true
      ? await maskOptions(typeof connectionId === 'string' ? await store.get(connectionId) : undefined)
      : undefined
  if (Array.isArray(body.rows) && Array.isArray(body.columns)) {
    const { columns, rows } = body
    const masked = await dbCall(() =>
      writeExport(
        tabId,
        format,
        path,
        async (sink) => {
          sink.columns(columns)
          await sink.rows(rows)
        },
        options,
        csv,
        mask,
      ),
    )
    return { ok: true, masked }
  }
  if (typeof connectionId !== 'string' || typeof sql !== 'string' || !sql.trim()) {
    throw createError({ statusCode: 400, message: 'connectionId and sql, or columns and rows are required' })
  }
  // Running the statement again must not repeat side effects (DML with RETURNING/OUTPUT, scripts).
  if (!isReadOnlyStatement(sql, sqlDialect((await store.get(connectionId)).dialect))) {
    throw createError({
      statusCode: 400,
      message: 'The full result can only be exported for a single read-only statement',
    })
  }
  const database = parseDatabase(body.database)
  const masked = await dbCall(() =>
    writeExport(
      tabId,
      format,
      path,
      (sink) => workbench.stream(tabId, connectionId, sql, sink, database),
      options,
      csv,
      mask,
    ),
  )
  return { ok: true, masked }
})
