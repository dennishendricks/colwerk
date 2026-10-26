import { z } from 'zod'

export default defineMcpTool({
  name: 'list-schemas',
  title: 'List schemas',
  description: `Lists the schemas of a connection with the number of tables and views in each.

WHEN TO USE: To get an overview of a database before looking for tables.
For MySQL/MariaDB a schema is a database.`,
  inputSchema: {
    connectionId: z.string().describe('connectionId from list-connections'),
    database: z.string().optional().describe('One of the connection\'s databases from list-connections; defaults to all'),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler({ connectionId, database }) {
    const connection = await connectionOf(connectionId)
    let schemas = await dbCall(() => workbench.introspect(connectionId, { kind: 'schemas' }))
    if (database !== undefined) {
      const databases = databasesOf(connection, schemas)
      if (!databases.includes(database)) {
        throw createError({ statusCode: 404, message: `Database '${database}' is not available through this connection. Available: ${databases.join(', ') || 'none'}.` })
      }
      if (connection.dialect === 'mysql') schemas = schemas.filter(s => s.name === database)
    }
    return {
      schemas: await Promise.all(schemas.map(async ({ name }) => {
        const tables = await dbCall(() => workbench.introspect(connectionId, { kind: 'tables', schema: name }))
        return { name, tables: tables.filter(t => t.kind === 'table').length, views: tables.filter(t => t.kind === 'view').length }
      })),
    }
  },
})
