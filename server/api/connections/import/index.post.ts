import { isAbsolute } from 'node:path'
import { previewImport, readImport } from '#core'

// Imports the selected connections (`keys`, see ImportCandidate.key) of a source's file; the file is read again,
// so that passwords and SSH secrets never pass through the UI. `passwords` holds those the user typed in.
export default defineEventHandler(async (event) => {
  const { source, path, keys, passwords } = await readBody<{
    source?: string
    path?: string
    keys?: string[]
    passwords?: Record<string, string>
  }>(event)
  const known = importSource(source)
  if (typeof path !== 'string' || !isAbsolute(path) || !Array.isArray(keys)) {
    throw createError({ statusCode: 400, message: 'path (absolute) and keys are required' })
  }
  const result = await dbCall(() => readImport(known, path))
  const { items } = previewImport(result, await store.list(), path)
  const imported: string[] = []
  const failed: { name: string; message: string }[] = []
  for (const [i, c] of result.candidates.entries()) {
    if (!keys.includes(c.key) || items[i]!.duplicate) continue
    try {
      await store.save(
        parseConnection({
          ...c.config,
          id: undefined,
          password: passwords?.[c.key] || c.config.password || '',
          sshSecret: c.config.sshSecret,
        }),
      )
      imported.push(c.key)
    } catch (e) {
      failed.push({ name: c.config.name, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return { imported: imported.length, failed }
})
