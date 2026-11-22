import { isAbsolute } from 'node:path'
import type { SchemaRef, SplitDialect, TableRef } from '#core'

/** Data compares in progress by id, to cancel them. */
export const runningCompares = new Map<string, AbortController>()

/** The engine of both connections, which must be the same and one of `supported`. */
export async function compareDialect(
  sourceId: string,
  targetId: string,
  supported: readonly SplitDialect[],
): Promise<SplitDialect> {
  const [source, target] = await Promise.all([store.get(sourceId), store.get(targetId)])
  if (source.dialect !== target.dialect) {
    throw createError({
      statusCode: 400,
      message: 'Both connections must use the same database engine.',
      data: { key: 'compareDialects' },
    })
  }
  if (!(supported as readonly string[]).includes(source.dialect)) {
    throw createError({
      statusCode: 400,
      message: 'Comparing is not available for this database engine.',
      data: { key: 'compareUnsupported' },
    })
  }
  return source.dialect as SplitDialect
}

const text = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value) throw createError({ statusCode: 400, message: `${name} is required` })
  return value
}

export function parseSchemaRef(value: unknown): SchemaRef {
  const b = (value ?? {}) as Record<string, unknown>
  return {
    connectionId: text(b.connectionId, 'connectionId'),
    database: parseDatabase(b.database),
    schema: text(b.schema, 'schema'),
  }
}

export const parseTableRef = (value: unknown): TableRef => ({
  ...parseSchemaRef(value),
  table: text((value as Record<string, unknown> | undefined)?.table, 'table'),
})

export function parseKeys(keys: unknown): string[] | undefined {
  if (keys === undefined) return undefined
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) {
    throw createError({ statusCode: 400, message: 'keys must be a list of column names' })
  }
  return keys
}

export function parsePath(path: unknown): string | undefined {
  if (path === undefined) return undefined
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw createError({ statusCode: 400, message: 'path must be an absolute path' })
  }
  return path
}
