import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

// Reads a query file (.sql) at a path chosen in the native open dialog (`/api/dialog`).
export default defineEventHandler(async (event) => {
  const { path } = await readBody<{ path?: string }>(event)
  if (typeof path !== 'string' || !isAbsolute(path)) throw createError({ statusCode: 400, message: 'path must be an absolute path' })
  try {
    return { sql: await readFile(path, 'utf8') }
  } catch (e) {
    throw createError({ statusCode: 400, message: (e as Error).message })
  }
})
