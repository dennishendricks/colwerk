import { z } from 'zod'

export default defineMcpTool({
  name: 'sample-rows',
  title: 'Sample rows',
  description: `Returns a few rows of a table or view as JSON objects, in no particular order.

WHEN TO USE: To understand what the values of a table look like (formats, codes, typical ranges).
WHEN NOT TO USE: For analyses, counts or anything that needs all rows; use run-query with filters and aggregations.`,
  inputSchema: {
    connectionId: z.string().describe('connectionId from list-connections'),
    schema: z.string().describe('Schema name from list-schemas'),
    table: z.string().describe('Table or view name from list-tables'),
    limit: z.number().int().min(1).max(50).default(10).describe('Number of rows (1-50)'),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler({ connectionId, schema, table, limit }) {
    const { dialect } = await connectionOf(connectionId)
    await tableOf(connectionId, schema, table)
    const sql = `select * from ${quoteIdent(schema, dialect)}.${quoteIdent(table, dialect)}`
    const set = (await readQuery(connectionId, sql, limit)).resultSets[0]
    return {
      rows: set?.rows.map(row => Object.fromEntries(set.columns.map((c, i) => [c.name, row[i]]))) ?? [],
    }
  },
})
