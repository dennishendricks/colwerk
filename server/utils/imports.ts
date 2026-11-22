import { isAbsolute } from 'node:path'
import type { ImportProgress, ImportSource, SplitDialect } from '#core'
import { sqlDialect } from '#core'

// Running imports by id: their progress for GET /api/imports/<id> and the controller that cancels them.
const jobs = new Map<string, { progress: ImportProgress; abort: AbortController }>()

export function startJob(id: string) {
  if (jobs.has(id)) throw createError({ statusCode: 409, message: 'An import with this id is already running' })
  const job = { progress: { read: 0, inserted: 0, updated: 0, failed: 0 }, abort: new AbortController() }
  jobs.set(id, job)
  return job
}

export const progressOf = (id: string) => jobs.get(id)?.progress

export function cancelJob(id: string) {
  jobs.get(id)?.abort.abort(new Error('Import was cancelled'))
}

export function finishJob(id: string) {
  jobs.delete(id)
}

/** The source of a request body, checked for its shape. */
export function parseSource(value: unknown): ImportSource {
  const s = (value ?? {}) as Record<string, unknown>
  const strings = (...keys: string[]) => keys.every((k) => typeof s[k] === 'string' && s[k] !== '')
  const valid =
    (s.kind === 'file' && strings('path') && isAbsolute(s.path as string)) ||
    (s.kind === 'table' && strings('connectionId', 'schema', 'table')) ||
    (s.kind === 'query' && strings('connectionId', 'sql'))
  if (!valid) throw createError({ statusCode: 400, message: 'Invalid import source' })
  return { ...s, database: parseDatabase(s.database) } as ImportSource
}

/** Dialect of the source's SQL: DuckDB reads files. */
export async function sourceDialect(source: ImportSource): Promise<SplitDialect> {
  return source.kind === 'file' ? 'duckdb' : sqlDialect((await store.get(source.connectionId)).dialect)
}
