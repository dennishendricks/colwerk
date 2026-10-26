import type { Dialect, Driver, DriverInfo } from './types.ts'

interface RegistryEntry extends DriverInfo {
  // Driver modules are imported on first use so that e.g. DuckDB's native addon is only loaded when needed.
  load: () => Promise<Driver>
}

const registry: Record<Dialect, RegistryEntry> = {
  postgres: {
    dialect: 'postgres',
    label: 'PostgreSQL',
    defaultPort: 5432,
    capabilities: { supportsCancel: true, supportsSchemas: true, supportsNetwork: true },
    load: () => import('./drivers/postgres.ts').then(m => m.postgresDriver),
  },
  mysql: {
    dialect: 'mysql',
    label: 'MySQL / MariaDB',
    defaultPort: 3306,
    capabilities: { supportsCancel: true, supportsSchemas: false, supportsNetwork: true },
    load: () => import('./drivers/mysql.ts').then(m => m.mysqlDriver),
  },
  mssql: {
    dialect: 'mssql',
    label: 'SQL Server',
    defaultPort: 1433,
    capabilities: { supportsCancel: true, supportsSchemas: true, supportsNetwork: true },
    load: () => import('./drivers/mssql.ts').then(m => m.mssqlDriver),
  },
  duckdb: {
    dialect: 'duckdb',
    label: 'DuckDB',
    capabilities: { supportsCancel: true, supportsSchemas: true, supportsNetwork: false },
    load: () => prepareDuckdb().then(() => import('./drivers/duckdb.ts')).then(m => m.duckdbDriver),
  },
}

/** Runs the launcher's hook that puts DuckDB's native library in place (compiled binaries only). Call before importing `@duckdb/node-api`. */
export async function prepareDuckdb(): Promise<void> {
  await (globalThis as { dbmPrepareDuckdb?: () => Promise<void> }).dbmPrepareDuckdb?.()
}

export const drivers: DriverInfo[] = Object.values(registry).map(({ load: _, ...info }) => info)

const loaded = new Map<Dialect, Promise<Driver>>()

export function loadDriver(dialect: Dialect): Promise<Driver> {
  const entry = registry[dialect]
  if (!entry) return Promise.reject(new Error(`Unknown dialect: ${dialect}`))
  let driver = loaded.get(dialect)
  if (!driver) {
    driver = entry.load()
    driver.catch(() => loaded.delete(dialect))
    loaded.set(dialect, driver)
  }
  return driver
}
