import { z } from 'zod'

export default defineMcpTool({
  name: 'describe-table',
  title: 'Describe table',
  description: `Describes the structure of a table or view: columns with data type, nullability, primary key,
foreign keys (target schema, table and column), indexes and comments; the table's indexes with key columns, uniqueness and primary flag;
plus partitioning and clustering if present.

WHEN TO USE: Before writing a query against a table, to get column names, types and join paths right.`,
  inputSchema: {
    connectionId: z.string().describe('connectionId from list-connections'),
    schema: z.string().describe('Schema name from list-schemas'),
    table: z.string().describe('Table or view name from list-tables'),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler({ connectionId, schema, table }) {
    const info = await tableOf(connectionId, schema, table)
    const [columns, indexes] = await Promise.all([
      dbCall(() => workbench.introspect(connectionId, { kind: 'columns', schema, table })),
      dbCall(() => workbench.introspect(connectionId, { kind: 'indexes', schema, table })),
    ])
    return {
      schema,
      table,
      type: info.kind,
      rowEstimate: info.rowEstimate,
      comment: info.comment,
      partitioning: info.partitioning,
      clustering: info.clustering,
      columns: columns.map(c => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        primaryKey: c.primaryKey,
        references: c.references ?? null,
        indexes: c.indexes,
        comment: c.comment,
      })),
      indexes,
    }
  },
})
