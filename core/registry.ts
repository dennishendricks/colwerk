import {
  AppError,
  type ConnectionAuth,
  type ConnectionConfig,
  type Dialect,
  type Driver,
  type DriverCapabilities,
  type DriverInfo,
  type DriverStatus,
  isLakehouse,
  type LakehouseDialect,
} from './types.ts'

interface RegistryEntry extends DriverInfo {
  // Driver modules are imported on first use so that e.g. DuckDB's native library is only loaded when needed.
  load: () => Promise<Driver>
}

const entra: ConnectionAuth[] = ['entra-default', 'entra-interactive', 'entra-service-principal']

const registry: Record<Dialect, RegistryEntry> = {
  postgres: {
    dialect: 'postgres',
    label: 'PostgreSQL',
    defaultPort: 5432,
    auths: ['password', ...entra],
    capabilities: {
      supportsCancel: true,
      supportsSchemas: true,
      supportsNetwork: true,
      supportsDatabases: true,
      locksDatabase: false,
      sessionActions: ['cancel', 'terminate'],
    },
    load: () => import('./drivers/postgres.ts').then((m) => m.postgresDriver),
  },
  mysql: {
    dialect: 'mysql',
    label: 'MySQL / MariaDB',
    defaultPort: 3306,
    auths: ['password', ...entra],
    capabilities: {
      supportsCancel: true,
      supportsSchemas: false,
      supportsNetwork: true,
      supportsDatabases: true,
      locksDatabase: false,
      sessionActions: ['cancel', 'terminate'],
    },
    load: () => import('./drivers/mysql.ts').then((m) => m.mysqlDriver),
  },
  mssql: {
    dialect: 'mssql',
    label: 'SQL Server',
    defaultPort: 1433,
    auths: ['password', 'windows', ...entra],
    capabilities: {
      supportsCancel: true,
      supportsSchemas: true,
      supportsNetwork: true,
      supportsDatabases: true,
      locksDatabase: false,
      sessionActions: ['terminate'],
    },
    load: () => import('./drivers/mssql.ts').then((m) => m.mssqlDriver),
  },
  duckdb: {
    dialect: 'duckdb',
    label: 'DuckDB',
    auths: [],
    capabilities: {
      supportsCancel: true,
      supportsSchemas: true,
      supportsNetwork: false,
      supportsDatabases: false,
      locksDatabase: true,
      sessionActions: [],
    },
    load: () =>
      installDuckdb()
        .then(() => import('./drivers/duckdb.ts'))
        .then((m) => m.duckdbDriver),
  },
  sqlite: {
    dialect: 'sqlite',
    label: 'SQLite',
    auths: [],
    capabilities: {
      supportsCancel: true,
      supportsSchemas: true,
      supportsNetwork: false,
      supportsDatabases: false,
      locksDatabase: false,
      sessionActions: [],
    },
    load: () => import('./drivers/sqlite.ts').then((m) => m.sqliteDriver),
  },
  clickhouse: {
    dialect: 'clickhouse',
    label: 'ClickHouse',
    defaultPort: 8123,
    auths: ['password'],
    capabilities: {
      supportsCancel: true,
      supportsSchemas: false,
      supportsNetwork: true,
      supportsDatabases: true,
      locksDatabase: false,
      sessionActions: ['cancel'],
    },
    load: () => import('./drivers/clickhouse.ts').then((m) => m.clickhouseDriver),
  },
  // Lakehouses run on DuckDB: an in-memory database per connection with the format's extensions.
  iceberg: lakehouse('iceberg', 'Apache Iceberg (REST catalog)', ['oauth-client', 'token', 'none'], {
    supportsSchemas: true,
    supportsNetwork: true,
    supportsDatabases: false,
  }),
  delta: lakehouse('delta', 'Delta Lake (folder)', [], {
    supportsSchemas: false,
    supportsNetwork: false,
    supportsDatabases: false,
  }),
  // Databases are the catalogs of the metastore, attached on selection.
  unity: lakehouse('unity', 'Databricks Unity Catalog', ['token'], {
    supportsSchemas: true,
    supportsNetwork: true,
    supportsDatabases: true,
  }),
  // Databases are the lakehouses of the workspace.
  onelake: lakehouse('onelake', 'Microsoft Fabric OneLake', entra, {
    supportsSchemas: true,
    supportsNetwork: true,
    supportsDatabases: true,
  }),
  // Data files and URLs as views of an in-memory DuckDB database.
  files: lakehouse('files', 'Files (DuckDB)', ['none', 's3', 'gcs', 'token'], {
    supportsSchemas: true,
    supportsNetwork: false,
    supportsDatabases: false,
  }),
}

function lakehouse(
  dialect: LakehouseDialect,
  label: string,
  auths: ConnectionAuth[],
  capabilities: Pick<DriverCapabilities, 'supportsSchemas' | 'supportsNetwork' | 'supportsDatabases'>,
): RegistryEntry {
  return {
    dialect,
    label,
    auths,
    capabilities: { ...capabilities, supportsCancel: true, locksDatabase: false, sessionActions: [] },
    load: () =>
      installDuckdb()
        .then(() => import('./drivers/lakehouse.ts'))
        .then((m) => m.lakehouseDriver(dialect)),
  }
}

/**
 * Packaged builds embed DuckDB's native library, which the launcher unpacks at the first start of a build
 * (launcher/native.ts); it offers this hook through globalThis, because the bundled server does not share module
 * instances with it. Without the hook (running from source) the library comes from node_modules.
 */
interface DuckdbHook {
  installed(): Promise<boolean>
  install(): Promise<void>
}

const duckdbHook = () => (globalThis as { colwerkDuckdb?: DuckdbHook }).colwerkDuckdb

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

/** Adds data files or URLs to a files connection as views (see lakehouse.ts). */
export async function addFileSources(config: ConnectionConfig, sources: string[]) {
  await installDuckdb()
  return (await import('./drivers/lakehouse.ts')).addFileSources(config, sources)
}

let installing: Promise<void> | undefined
const installingExtensions = new Map<LakehouseDialect, Promise<void>>()

export async function driverStatus(): Promise<DriverStatus[]> {
  // DuckDB itself is always available; installed extensions can only be looked up once its library is unpacked.
  const duckdb = (await duckdbHook()?.installed()) ?? true
  const lakehouse = await import('./drivers/lakehouse.ts')
  return Promise.all(
    drivers.map(async (d): Promise<DriverStatus> => {
      if (!isLakehouse(d.dialect) || !lakehouse.EXTENSIONS[d.dialect].length) return { ...d, installed: true }
      const installed =
        duckdb &&
        !installingExtensions.has(d.dialect) &&
        !(await lakehouse.missingExtensions(d.dialect).catch(() => [d.dialect])).length
      return { ...d, installed }
    }),
  )
}

/**
 * Unpacks DuckDB's native library unless it is in place, and for lakehouses downloads the DuckDB extensions they
 * need; concurrent calls share the work.
 */
export async function installDriver(dialect: Dialect): Promise<void> {
  if (dialect !== 'duckdb' && !isLakehouse(dialect)) return
  await installDuckdb()
  if (!isLakehouse(dialect)) return
  let done = installingExtensions.get(dialect)
  if (!done) {
    done = import('./drivers/lakehouse.ts')
      .then((m) => m.installExtensions(dialect))
      .finally(() => installingExtensions.delete(dialect))
    installingExtensions.set(dialect, done)
  }
  await done
}

/** Waits until DuckDB's native library is in place, unpacking it if needed. Call before importing the driver. */
function installDuckdb(): Promise<void> {
  const hook = duckdbHook()
  if (!hook) return Promise.resolve()
  installing ??= hook
    .installed()
    .then(async (installed) => {
      if (!installed) await hook.install()
    })
    .catch((e) => {
      throw new AppError('driverUnpackFailed', `Unpacking the DuckDB driver failed: ${(e as Error).message}`, {
        params: { detail: (e as Error).message },
      })
    })
    .finally(() => (installing = undefined))
  return installing
}
