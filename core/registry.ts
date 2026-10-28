import { DbError, type Dialect, type Driver, type DriverInfo, type DriverStatus } from './types.ts'

interface RegistryEntry extends DriverInfo {
  // Driver modules are imported on first use so that e.g. DuckDB's native library is only loaded when needed.
  load: () => Promise<Driver>
}

const registry: Record<Dialect, RegistryEntry> = {
  postgres: {
    dialect: 'postgres',
    label: 'PostgreSQL',
    defaultPort: 5432,
    capabilities: { supportsCancel: true, supportsSchemas: true, supportsNetwork: true, supportsDatabases: true },
    load: () => import('./drivers/postgres.ts').then(m => m.postgresDriver),
  },
  mysql: {
    dialect: 'mysql',
    label: 'MySQL / MariaDB',
    defaultPort: 3306,
    capabilities: { supportsCancel: true, supportsSchemas: false, supportsNetwork: true, supportsDatabases: true },
    load: () => import('./drivers/mysql.ts').then(m => m.mysqlDriver),
  },
  mssql: {
    dialect: 'mssql',
    label: 'SQL Server',
    defaultPort: 1433,
    capabilities: { supportsCancel: true, supportsSchemas: true, supportsNetwork: true, supportsDatabases: true },
    load: () => import('./drivers/mssql.ts').then(m => m.mssqlDriver),
  },
  duckdb: {
    dialect: 'duckdb',
    label: 'DuckDB',
    capabilities: { supportsCancel: true, supportsSchemas: true, supportsNetwork: false, supportsDatabases: false },
    load: () => prepareDuckdb().then(() => import('./drivers/duckdb.ts')).then(m => m.duckdbDriver),
  },
}

/**
 * Packaged builds do not embed DuckDB's native library: the launcher downloads it on request (launcher/native.ts)
 * and offers this hook through globalThis, because the bundled server does not share module instances with it.
 * Without the hook (running from source) the library comes from node_modules.
 */
interface DuckdbHook {
  installed(): Promise<boolean>
  install(onProgress: (fraction: number) => void): Promise<void>
}

const duckdbHook = () => (globalThis as { dbmDuckdb?: DuckdbHook }).dbmDuckdb

/** Fails unless DuckDB's native library is in place. Call before importing the driver. */
async function prepareDuckdb(): Promise<void> {
  if (await duckdbHook()?.installed() === false) {
    throw new DbError('The DuckDB driver is not installed. Open the connection in Colwerk and choose "Datenbanktreiber laden".', 'ENODRIVER')
  }
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

let installing: { progress?: number, done: Promise<void> } | undefined

export async function driverStatus(): Promise<DriverStatus[]> {
  const duckdb = await duckdbHook()?.installed() ?? true
  return drivers.map(d => d.dialect === 'duckdb' ? { ...d, installed: duckdb, installProgress: installing?.progress } : { ...d, installed: true })
}

/** Downloads the native library of a driver that is not installed yet; concurrent calls share the download. */
export function installDriver(dialect: Dialect): Promise<void> {
  const hook = duckdbHook()
  if (dialect !== 'duckdb' || !hook) return Promise.resolve()
  if (!installing) {
    const state: { progress?: number } = {}
    const done = hook.install(fraction => (state.progress = fraction))
      .catch((e) => {
        throw new DbError(`Download of the DuckDB driver failed: ${(e as Error).message}`)
      })
      .finally(() => (installing = undefined))
    installing = Object.assign(state, { done })
  }
  return installing.done
}
