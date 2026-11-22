// Data import: one session reads the source and another writes the target. Batches commit separately, so a
// stopped import keeps the batches written before; ClickHouse writes each batch as one atomic insert without a
// transaction.
import { isAbsolute } from 'node:path'
import { extensionsFor, fileFormat, scanSql } from './file-formats.ts'
import {
  beginSql,
  commitSql,
  existingKeysSql,
  type ImportStrategy,
  rollbackSql,
  strategies,
  truncateSql,
  upsertSql,
} from './import-sql.ts'
import { loadDriver } from './registry.ts'
import { insertSql, maxInsertRows, qualifiedName } from './sql-literals.ts'
import { isReadOnlyStatement, type SplitDialect } from './sql-split.ts'
import { AppError, type CellValue, type ResultColumn, type RowSink, type Session } from './types.ts'
import type { Workbench } from './workbench.ts'

export type ImportSource =
  | { kind: 'file'; path: string }
  | { kind: 'table'; connectionId: string; database?: string; schema: string; table: string }
  | { kind: 'query'; connectionId: string; database?: string; sql: string }

export interface ImportPlan {
  source: ImportSource
  /** Dialect of the source connection (file: duckdb), resolved by the server. */
  sourceDialect: SplitDialect
  target: {
    connectionId: string
    database?: string
    schema: string
    table: string
    dialect: SplitDialect
    create?: string
  }
  /** Source column index → target column with its type (for the literals). */
  columns: { source: number; name: string; type: string }[]
  strategy: ImportStrategy
  keys: string[]
  batchSize: number
  onError: 'stop' | 'skip'
}

export interface ImportProgress {
  read: number
  inserted: number
  updated: number
  failed: number
}

export interface ImportSummary extends ImportProgress {
  cancelled: boolean
  error?: string
  errors: string[]
  durationMs: number
}

/** A private in-memory DuckDB session reading the file; `fn` gets it with the SELECT of the file's rows. */
async function withFileSession<T>(path: string, fn: (session: Session, sql: string) => Promise<T>): Promise<T> {
  const format = isAbsolute(path) ? fileFormat(path) : undefined
  if (!format) throw new AppError('unsupportedFile', `Not a supported data file: ${path}`, { params: { name: path } })
  const session = await (
    await loadDriver('duckdb')
  ).connect({ id: `import-${crypto.randomUUID()}`, name: 'import', dialect: 'duckdb', file: ':memory:' })
  try {
    // Duplicates the loop of core/drivers/lakehouse.ts; both could share a helper later.
    for (const name of extensionsFor(path, format)) {
      try {
        for (const sql of [`install ${name}`, `load ${name}`]) await session.execute(sql, { rowLimit: 1 })
      } catch (e) {
        const detail = (e as Error).message
        throw new AppError('extensionFailed', `The DuckDB extension ${name} could not be loaded: ${detail}`, {
          code: 'EEXTENSION',
          params: { name, detail },
        })
      }
    }
    return await fn(session, `select * from ${scanSql(path, format)}`)
  } finally {
    await session.close()
  }
}

/** The SELECT of a connection source. */
function sourceSql(source: Exclude<ImportSource, { kind: 'file' }>, dialect: SplitDialect): string {
  if (source.kind === 'table') return `select * from ${qualifiedName(dialect, [source.schema, source.table])}`
  const sql = source.sql.trim()
  if (!isReadOnlyStatement(sql, dialect)) {
    throw new AppError('importReadOnly', 'Only a single read-only statement can be imported.')
  }
  return sql
}

/** Columns and the first 20 rows of the source; for a table the declared column types. */
export async function previewImport(
  workbench: Workbench,
  source: ImportSource,
  sourceDialect: SplitDialect,
): Promise<{ columns: ResultColumn[]; rows: CellValue[][] }> {
  let result
  if (source.kind === 'file') {
    result = (await withFileSession(source.path, (s, sql) => s.execute(sql, { rowLimit: 20 }))).resultSets[0]
  } else {
    const tab = `import-preview:${crypto.randomUUID()}`
    try {
      result = (
        await workbench.execute(tab, source.connectionId, sourceSql(source, sourceDialect), 20, 60, source.database)
      ).resultSets[0]
    } finally {
      await workbench.closeTab(tab)
    }
  }
  if (!result) throw new AppError('noResultSet', 'The statement returned no result set.')
  const { columns, rows } = result
  if (source.kind === 'table') {
    const declared = await workbench.introspect(
      source.connectionId,
      { kind: 'columns', schema: source.schema, table: source.table },
      false,
      source.database,
    )
    for (const c of columns) c.type = declared.find((d) => d.name === c.name)?.type ?? c.type
  }
  return { columns, rows }
}

/**
 * Runs the import and answers with its summary. `progress` is updated while it runs. Errors after the first row
 * was read end up in the summary so that the counts reach the caller; earlier ones (DDL, truncate, opening the
 * source) are thrown.
 */
export async function runImport(
  workbench: Workbench,
  id: string,
  plan: ImportPlan,
  progress: ImportProgress,
  signal: AbortSignal,
): Promise<ImportSummary> {
  const { target, strategy, keys, columns } = plan
  const names = columns.map((c) => c.name)
  if (
    !columns.length ||
    new Set(names).size !== names.length ||
    (strategy === 'upsert' && (!keys.length || keys.some((k) => !names.includes(k)))) ||
    !strategies(target.dialect, !!target.create).includes(strategy)
  ) {
    throw new AppError('importInvalid', 'The import settings are incomplete or not supported by the target.')
  }
  const { dialect } = target
  const table = [target.schema, target.table]
  const targetTab = `import:${id}:target`
  const sourceTab = `import:${id}:source`
  const exec = (sql: string, rowLimit = 1) =>
    workbench.execute(targetTab, target.connectionId, sql, rowLimit, 3600, target.database)
  const started = Date.now()
  const errors: string[] = []
  // Rows of the batch that failed and stopped the import.
  let failedRows = 0

  const keyIndexes = keys.map((k) => names.indexOf(k))
  const keyColumns = keyIndexes.map((i) => columns[i]!)
  const begin = beginSql(dialect)

  /** Writes `rows` (in target column order); returns how many of them replaced an existing row. */
  async function write(rows: CellValue[][]): Promise<number> {
    let existing = 0
    if (strategy === 'upsert') {
      const sql = existingKeysSql(
        dialect,
        table,
        keyColumns,
        rows.map((r) => keyIndexes.map((i) => r[i]!)),
      )
      if (sql) existing = Number((await exec(sql)).resultSets[0]?.rows[0]?.[0] ?? 0)
    }
    await exec(
      strategy === 'upsert' ? upsertSql(dialect, table, columns, keys, rows) : insertSql(dialect, table, columns, rows),
    )
    return existing
  }

  async function writeBatch(batch: CellValue[][]) {
    const rows = batch.map((r) => columns.map((c) => r[c.source] ?? null))
    try {
      if (begin) await exec(begin)
      const existing = await write(rows)
      if (begin) await exec(commitSql(dialect))
      progress.inserted += rows.length - existing
      progress.updated += existing
    } catch (e) {
      if (begin) await exec(rollbackSql(dialect)).catch(() => {})
      if (plan.onError === 'stop') {
        failedRows = rows.length
        throw e
      }
      for (const row of rows) {
        try {
          const existing = await write([row])
          progress.inserted += 1 - existing
          progress.updated += existing
        } catch (rowError) {
          progress.failed++
          if (errors.length < 10) errors.push((rowError as Error).message)
        }
      }
    }
  }

  const n = Math.min(plan.batchSize, maxInsertRows(dialect))
  const pending: CellValue[][] = []
  const sink: RowSink = {
    columns: () => {},
    rows: async (chunk) => {
      signal.throwIfAborted()
      progress.read += chunk.length
      pending.push(...chunk)
      while (pending.length >= n) await writeBatch(pending.splice(0, n))
    },
  }

  const readAll = async (read: (sink: RowSink) => Promise<void>, cancel: () => Promise<void>) => {
    const onAbort = () => void cancel()
    signal.addEventListener('abort', onAbort)
    try {
      await read(sink)
      if (pending.length) await writeBatch(pending.splice(0))
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  let streaming = false
  try {
    if (target.create) await exec(target.create)
    if (strategy === 'truncate') await exec(truncateSql(dialect, table))
    streaming = true
    const { source } = plan
    if (source.kind === 'file') {
      await withFileSession(source.path, (session, sql) =>
        readAll(
          (s) => session.stream(sql, s),
          () => session.cancel(),
        ),
      )
    } else {
      const sql = sourceSql(source, plan.sourceDialect)
      await readAll(
        (s) => workbench.stream(sourceTab, source.connectionId, sql, s, source.database),
        () => workbench.cancel(sourceTab),
      )
    }
    return { ...progress, cancelled: false, errors, durationMs: Date.now() - started }
  } catch (e) {
    if (!streaming) throw e
    progress.failed += failedRows
    const cancelled = signal.aborted
    return {
      ...progress,
      cancelled,
      ...(!cancelled && { error: (e as Error).message }),
      errors,
      durationMs: Date.now() - started,
    }
  } finally {
    await workbench.closeTab(sourceTab)
    await workbench.closeTab(targetTab)
  }
}
