import { previewImport } from '#core'

// Columns and the first rows of an import source.
export default defineEventHandler(async (event) => {
  const source = parseSource((await readBody<{ source?: unknown }>(event)).source)
  return dbCall(async () => previewImport(workbench, source, await sourceDialect(source)))
})
