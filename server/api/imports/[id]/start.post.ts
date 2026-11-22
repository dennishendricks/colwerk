import { type ImportPlan, isLakehouse, runImport, sqlDialect } from '#core'

// Answers with the summary once the import is done; the progress is reported by GET /api/imports/<id>. May run
// long, like exports.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<
    Partial<Pick<ImportPlan, 'columns' | 'strategy' | 'keys' | 'batchSize' | 'onError'>> & {
      source?: unknown
      target?: { connectionId?: string; database?: string; schema?: string; table?: string; create?: string }
    }
  >(event)
  const source = parseSource(body.source)
  const { connectionId, schema, table, create } = body.target ?? {}
  if (typeof connectionId !== 'string' || typeof schema !== 'string' || typeof table !== 'string' || !table) {
    throw createError({ statusCode: 400, message: 'target requires connectionId, schema and table' })
  }
  if (create !== undefined && typeof create !== 'string') {
    throw createError({ statusCode: 400, message: 'create must be a string' })
  }
  const config = await store.get(connectionId)
  if (isLakehouse(config.dialect) || config.readOnly) {
    throw createError({ statusCode: 400, message: 'Invalid import target', data: { key: 'importTargetInvalid' } })
  }
  if (
    !Array.isArray(body.columns) ||
    !Array.isArray(body.keys) ||
    !['append', 'truncate', 'upsert'].includes(body.strategy!)
  ) {
    throw createError({ statusCode: 400, message: 'columns, keys and strategy are required' })
  }
  const plan: ImportPlan = {
    source,
    sourceDialect: await sourceDialect(source),
    target: {
      connectionId,
      database: parseDatabase(body.target?.database),
      schema,
      table,
      dialect: sqlDialect(config.dialect),
      create,
    },
    columns: body.columns,
    strategy: body.strategy!,
    keys: body.keys,
    batchSize: Math.min(10_000, Math.max(1, Math.floor(Number(body.batchSize)) || 500)),
    onError: body.onError === 'skip' ? 'skip' : 'stop',
  }
  const job = startJob(id)
  try {
    return await dbCall(() => runImport(workbench, id, plan, job.progress, job.abort.signal))
  } finally {
    finishJob(id)
  }
})
