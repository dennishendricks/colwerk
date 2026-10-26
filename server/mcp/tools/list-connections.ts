import { drivers, type SchemaInfo } from '#core'

const PROBE_TIMEOUT_MS = 5000

// Reuses the metadata session and its cache: a connection counts as reachable once its schemas were read.
async function probe(connectionId: string): Promise<SchemaInfo[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No response within ${PROBE_TIMEOUT_MS / 1000} s`)), PROBE_TIMEOUT_MS)
  })
  try {
    return await Promise.race([workbench.introspect(connectionId, { kind: 'schemas' }), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export default defineMcpTool({
  name: 'list-connections',
  title: 'List connections',
  description: `Lists the database connections configured in Colwerk, with their databases and whether they are reachable.

WHEN TO USE: Always call this first. Every other tool needs a connectionId from this list.
Write SQL in the dialect given in "dialect": postgres (PostgreSQL), mysql (MySQL/MariaDB), mssql (SQL Server, T-SQL), duckdb (DuckDB).
Names are not unique; identify a connection by connectionId.`,
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler() {
    const connections = await store.list()
    return {
      connections: await Promise.all(connections.map(async (c) => {
        const base = {
          connectionId: c.id,
          name: c.name,
          folder: c.folder ?? null,
          dialect: c.dialect,
          dialectLabel: drivers.find(d => d.dialect === c.dialect)?.label ?? c.dialect,
          readOnly: c.readOnly === true,
        }
        try {
          return { ...base, databases: databasesOf(c, await probe(c.id)), status: 'connected' }
        } catch (e) {
          return { ...base, databases: databasesOf(c), status: 'unreachable', error: (e as Error).message }
        }
      })),
    }
  },
})
