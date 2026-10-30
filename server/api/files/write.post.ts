import { rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

// Writes a query file (.sql) to a path chosen in the native save dialog (`/api/dialog`). Written next to
// the target and renamed, so a failed write leaves an existing file untouched.
export default defineEventHandler(async (event) => {
  const { path, sql } = await readBody<{ path?: string, sql?: string }>(event)
  if (typeof path !== 'string' || !isAbsolute(path)) throw createError({ statusCode: 400, message: 'path must be an absolute path' })
  if (typeof sql !== 'string') throw createError({ statusCode: 400, message: 'sql is required' })
  const part = `${path}.part`
  try {
    await writeFile(part, sql)
    await rename(part, path)
  } catch (e) {
    await rm(part, { force: true })
    throw createError({ statusCode: 400, message: (e as Error).message })
  }
  return { ok: true }
})
