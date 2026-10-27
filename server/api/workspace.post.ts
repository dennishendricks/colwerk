import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultDataDir } from '#core'

// A file instead of localStorage: the app's origin (port) changes with every start.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ tabs?: unknown }>(event)
  if (!Array.isArray(body?.tabs)) throw createError({ statusCode: 400, message: 'tabs is required' })
  const dir = defaultDataDir()
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'workspace.json')
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(body), { mode: 0o600 })
  await rename(tmp, file)
  return { ok: true }
})
