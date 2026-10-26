import { open, rename, rm } from 'node:fs/promises'
import { createExporter, DbError, type ExportFormat, type RowSink } from '#core'

// The server writes exports directly to the path chosen in the native save dialog (`/api/dialog`):
// the desktop window does not save browser downloads. The file is written next to the target and
// renamed at the end, so a failed or cancelled export leaves an existing file untouched.
const running = new Map<AbortController, string>()

/** Runs `produce` into the file at `path`; resolves once it is written completely. */
export async function writeExport(tabId: string, format: ExportFormat, path: string, produce: (sink: RowSink) => Promise<void>): Promise<void> {
  const aborted = new AbortController()
  running.set(aborted, tabId)
  const part = `${path}.part`
  const file = await open(part, 'w')
  const exporter = createExporter(format, async (chunk) => {
    await file.write(chunk)
  })
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
    if (!hasColumns) throw new DbError('The statement returned no result set.')
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
    if (tab === tabId) controller.abort(new DbError('Export was cancelled', 'ECANCEL'))
  }
}

export function parseFormat(value: unknown): ExportFormat {
  if (value === 'csv' || value === 'parquet') return value
  throw createError({ statusCode: 400, message: 'format must be csv or parquet' })
}
