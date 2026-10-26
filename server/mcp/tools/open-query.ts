import { z } from 'zod'

export default defineMcpTool({
  name: 'open-query',
  title: 'Open query in editor',
  description: `Opens a query in a new tab of the Colwerk editor so the user can review, change and run it.
The query is not run.

WHEN TO USE: When the user wants to see or keep working on a query, or when the query is long or complex.`,
  inputSchema: {
    connectionId: z.string().describe('connectionId from list-connections'),
    sql: z.string().describe('The SQL to open'),
    title: z.string().optional().describe('Tab title'),
    description: z.string().optional().describe('Explanation, inserted as a comment above the SQL'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async handler({ connectionId, sql, title, description }) {
    const connection = await connectionOf(connectionId)
    const comment = description ? `${description.trim().split('\n').map(line => `-- ${line}`.trimEnd()).join('\n')}\n` : ''
    if (!openQuery({ connectionId, sql: comment + sql, title })) {
      throw createError({ statusCode: 409, message: 'No Colwerk editor window is open.' })
    }
    return `Opened the query in a new editor tab for connection '${connection.name}'. It has not been run.`
  },
})
