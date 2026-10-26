import { z } from 'zod'

export default defineMcpTool({
  name: 'list-tables',
  title: 'List tables',
  description: `Lists the tables and views of a schema with estimated row counts and comments.

WHEN TO USE: To find the tables relevant for a question. Use describe-table for their columns.
rowEstimate comes from the catalog statistics and may be outdated; it is null for views.`,
  inputSchema: {
    connectionId: z.string().describe('connectionId from list-connections'),
    schema: z.string().describe('Schema name from list-schemas'),
    filter: z.string().optional().describe('Only names containing this text (case-insensitive)'),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler({ connectionId, schema, filter }) {
    await connectionOf(connectionId)
    const schemas = await dbCall(() => workbench.introspect(connectionId, { kind: 'schemas' }))
    if (!schemas.some(s => s.name === schema)) {
      throw createError({ statusCode: 404, message: `Schema '${schema}' not found. Call list-schemas for valid names.` })
    }
    const tables = await dbCall(() => workbench.introspect(connectionId, { kind: 'tables', schema }))
    const needle = filter?.toLowerCase()
    return {
      tables: tables
        .filter(t => !needle || t.name.toLowerCase().includes(needle))
        .map(t => ({ name: t.name, type: t.kind, rowEstimate: t.rowEstimate, comment: t.comment })),
    }
  },
})
