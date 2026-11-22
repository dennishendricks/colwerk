import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { decodeText } from '#core'

// Reads a query file (.sql, .sqlplan) at a path chosen in the native open dialog (`/api/dialog`).
export default defineEventHandler(async (event) => {
  const { path } = await readBody<{ path?: string }>(event)
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw createError({ statusCode: 400, message: 'path must be an absolute path' })
  }
  try {
    return { sql: decodeText(new Uint8Array(await readFile(path))) }
  } catch (e) {
    throw createError({ statusCode: 400, message: (e as Error).message })
  }
})
