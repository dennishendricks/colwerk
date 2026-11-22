import { open, rename, rm } from 'node:fs/promises'
import { AppError, createExporter, type ExportFormat, type ExportOptions, exportFormats, type RowSink } from '#core'

// The server writes exports directly to the path chosen in the native save dialog (`/api/dialog`):
// the desktop window does not save browser downloads. The file is written next to the target and
// renamed at the end, so a failed or cancelled export leaves an existing file untouched.
const running = new Map<AbortController, string>()

/** Runs `produce` into the file at `path`; resolves once it is written completely. */
export async function writeExport(
  tabId: string,
  format: ExportFormat,
  path: string,
  produce: (sink: RowSink) => Promise<void>,
  options?: ExportOptions,
): Promise<void> {
  const aborted = new AbortController()
  running.set(aborted, tabId)
  const part = `${path}.part`
  const file = await open(part, 'w')
  const exporter = createExporter(
    format,
    async (chunk) => {
      await file.write(chunk)
    },
    options,
  )
  let hasColumns = false
  let ok = false
  try {
    await produce({
      columns: (columns) => {
        exporter.columns(columns)
        hasColumns = true
      },
      rows: (rows) => {
        aborted.signal.throwIfAborted()
        return exporter.rows(rows)
      },
    })
    if (!hasColumns) throw new AppError('noResultSet', 'The statement returned no result set.')
    aborted.signal.throwIfAborted()
    await exporter.finish()
    ok = true
  } finally {
    running.delete(aborted)
    await exporter.dispose()
    await file.close()
    await (ok ? rename(part, path) : rm(part, { force: true }))
  }
}

/** Aborts every running export of a tab; its statement is cancelled by the caller. */
export function cancelExports(tabId: string) {
  for (const [controller, tab] of running) {
    if (tab === tabId) controller.abort(new AppError('exportCancelled', 'Export was cancelled', { code: 'ECANCEL' }))
  }
}

export function parseFormat(value: unknown): ExportFormat {
  const format = exportFormats.find((f) => f === value)
  if (format) return format
  throw createError({ statusCode: 400, message: `format must be one of ${exportFormats.join(', ')}` })
}

/** Target table (1-3 parts) and rows per statement of an INSERT export. */
export function parseInsertOptions(body: unknown, dialect: ExportOptions['dialect']): ExportOptions {
  const { table, batchSize } = (body ?? {}) as { table?: unknown; batchSize?: unknown }
  if (
    !Array.isArray(table) ||
    table.length < 1 ||
    table.length > 3 ||
    !table.every((p) => typeof p === 'string' && p)
  ) {
    throw createError({
      statusCode: 400,
      message: 'The target table for INSERT statements is missing',
      data: { key: 'insertTableRequired' },
    })
  }
  const size = Number.isInteger(batchSize) ? (batchSize as number) : 100
  return { dialect, table, batchSize: Math.min(Math.max(size, 1), 10_000) }
}
