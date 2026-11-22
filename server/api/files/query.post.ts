import { isAbsolute } from 'node:path'
import { addFileSources, AppError } from '#core'
import { isRemote } from '~~/core/file-formats.ts'

// Adds data files and URLs to a files connection (the one given, otherwise the first; none yet: one is created) as
// views of its in-memory database, and saves them with the connection. Files that cannot be read are reported, not saved.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ sources?: unknown; connectionId?: unknown; name?: unknown }>(event)
  const sources = body.sources
  if (!Array.isArray(sources) || !sources.length || !sources.every((s) => typeof s === 'string')) {
    throw createError({ statusCode: 400, message: 'sources must be a non-empty array of strings' })
  }
  for (const source of sources as string[]) {
    if (!isAbsolute(source) && !isRemote(source)) {
      throw createError({
        statusCode: 400,
        message: `Not an absolute path or URL: ${source}`,
        data: { key: 'invalidSource', params: { source } },
      })
    }
  }
  let id: string
  if (typeof body.connectionId === 'string') {
    id = body.connectionId
    if ((await store.get(id)).dialect !== 'files') {
      throw createError({ statusCode: 400, message: 'Not a files connection' })
    }
  } else {
    const existing = (await store.list()).find((c) => c.dialect === 'files')
    id = existing?.id ?? crypto.randomUUID()
    if (!existing) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      await store.save({ id, name: name || 'Files', dialect: 'files', auth: 'none', sources: [] })
    }
  }
  const config = await store.get(id)
  const { added, failed } = await dbCall(() => addFileSources(config, sources as string[]))
  const known = new Set(config.sources)
  const fresh = added.map((a) => a.source).filter((s) => !known.has(s))
  if (fresh.length) {
    // undefined keeps the stored secrets.
    await store.save({
      ...config,
      sources: [...(config.sources ?? []), ...fresh],
      password: undefined,
      sshSecret: undefined,
    })
  }
  await workbench.introspect(id, { kind: 'schemas' }, true).catch(() => {})
  return {
    connectionId: id,
    added,
    failed: failed.map(({ source, error }) => ({
      source,
      message: error.message,
      ...(error instanceof AppError && { key: error.key, params: error.params }),
    })),
  }
})
