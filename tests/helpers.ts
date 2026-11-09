import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConnectionConfig } from '../core/types.ts'

/** Connections to the databases from docker-compose.yml. */
export const testConnections: Record<'postgres' | 'mysql' | 'mssql' | 'clickhouse', ConnectionConfig> = {
  postgres: {
    id: 'pg',
    name: 'pg',
    dialect: 'postgres',
    host: '127.0.0.1',
    port: 55432,
    database: 'dbm',
    user: 'dbm',
    password: 'dbm',
  },
  mysql: {
    id: 'my',
    name: 'my',
    dialect: 'mysql',
    host: '127.0.0.1',
    port: 53306,
    database: 'dbm',
    user: 'dbm',
    password: 'dbm',
  },
  mssql: {
    id: 'ms',
    name: 'ms',
    dialect: 'mssql',
    host: '127.0.0.1',
    port: 51433,
    database: 'dbm',
    user: 'sa',
    password: 'Dbm_Passw0rd!',
  },
  clickhouse: {
    id: 'ch',
    name: 'ch',
    dialect: 'clickhouse',
    host: '127.0.0.1',
    port: 58123,
    database: 'dbm',
    user: 'dbm',
    password: 'dbm',
  },
}

/** Skips the test when the docker-compose service is not reachable. */
export async function reachable(config: ConnectionConfig): Promise<boolean> {
  try {
    const socket = await Bun.connect({ hostname: config.host!, port: config.port!, socket: { data() {} } })
    socket.end()
    return true
  } catch {
    return false
  }
}

export const tempDir = () => mkdtemp(join(tmpdir(), 'colwerk-test-'))
