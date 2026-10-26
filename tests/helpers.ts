import type { ConnectionConfig, Dialect } from '../core/types.ts'

/** Connections to the databases from docker-compose.yml. */
export const testConnections: Record<Exclude<Dialect, 'duckdb'>, ConnectionConfig> = {
  postgres: { id: 'pg', name: 'pg', dialect: 'postgres', host: '127.0.0.1', port: 55432, database: 'dbm', user: 'dbm', password: 'dbm' },
  mysql: { id: 'my', name: 'my', dialect: 'mysql', host: '127.0.0.1', port: 53306, database: 'dbm', user: 'dbm', password: 'dbm' },
  mssql: { id: 'ms', name: 'ms', dialect: 'mssql', host: '127.0.0.1', port: 51433, database: 'dbm', user: 'sa', password: 'Dbm_Passw0rd!' },
}

/** Skips the test when the docker-compose service is not reachable. */
export async function reachable(config: ConnectionConfig): Promise<boolean> {
  try {
    const conn = await Deno.connect({ hostname: config.host!, port: config.port! })
    conn.close()
    return true
  } catch {
    return false
  }
}
