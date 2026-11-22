import { isAbsolute } from 'node:path'
import { AppError, findImportFile, importPaths, previewConnectionImport, readImport } from '#core'

// Reads the connections of a source's file without saving anything; `path` is the chosen file, else the default one.
export default defineEventHandler(async (event) => {
  const { source, path } = await readBody<{ source?: string; path?: string }>(event)
  const known = importSource(source)
  if (path !== undefined && !(typeof path === 'string' && isAbsolute(path))) {
    throw createError({ statusCode: 400, message: 'path must be absolute' })
  }
  return dbCall(async () => {
    const file = path ?? findImportFile(known)
    if (!file) {
      const missing = importPaths(known)[0]!
      throw new AppError('importNotFound', `File not found: ${missing}`, { params: { path: missing } })
    }
    return previewConnectionImport(await readImport(known, file), await store.list(), file)
  })
})
