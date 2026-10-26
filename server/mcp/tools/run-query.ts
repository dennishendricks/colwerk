import { z } from 'zod'

export default defineMcpTool({
  name: 'run-query',
  title: 'Run query',
  description: `Runs one read-only SQL query (SELECT or WITH) and returns its rows.

WHEN TO USE: To answer questions from the data.
Only a single SELECT/WITH statement is accepted; it runs in a transaction that is rolled back.
The server enforces a statement timeout of 30 s and the row limit. On large tables filter and aggregate
in SQL instead of fetching raw rows. Write SQL in the connection's dialect (see list-connections).
WHEN NOT TO USE: When the user wants to see, edit or run the query themselves; use open-query.`,
  inputSchema: {
    connectionId: z.string().describe('connectionId from list-connections'),
    sql: z.string().describe('One SELECT or WITH statement'),
    limit: z.number().int().min(1).max(1000).default(100).describe('Maximum number of rows returned (1-1000)'),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler({ connectionId, sql, limit }) {
    const result = await readQuery(connectionId, sql, limit)
    const set = result.resultSets[0]
    return {
      columns: set?.columns ?? [],
      rows: set?.rows ?? [],
      rowCount: set?.rows.length ?? 0,
      durationMs: Math.round(result.durationMs),
      truncated: set?.truncated ?? false,
      ...set?.truncated && { note: `The result has more than ${limit} rows and was cut off. Narrow it down with filters or aggregations.` },
    }
  },
})
