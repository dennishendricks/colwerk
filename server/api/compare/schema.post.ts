import { compareSchemas, schemaCompareDialects } from '#core'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ source: unknown; target: unknown }>(event)
  const source = parseSchemaRef(body?.source)
  const target = parseSchemaRef(body?.target)
  const dialect = await compareDialect(source.connectionId, target.connectionId, schemaCompareDialects)
  return dbCall(() => compareSchemas(workbench, dialect, source, target))
})
