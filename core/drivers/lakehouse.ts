// Lakehouse formats through DuckDB and its extensions. Every connection gets an in-memory DuckDB database of its
// own, in which the format's catalog is attached (Iceberg REST, Unity Catalog) or its Delta tables are exposed as
// views (Delta folders, OneLake lakehouses). The SQL is DuckDB's.
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  AppError,
  type ConnectionConfig,
  type DatabaseInfo,
  DbError,
  type Driver,
  type IntrospectRequest,
  type IntrospectResult,
  type LakehouseDialect,
  type QueryResult,
  type RowSink,
  type TableInfo,
} from '../types.ts'
import { connect, type Connection } from './duckdb-native.ts'
import { DuckDBSession } from './duckdb.ts'
import { entraToken } from './entra.ts'
import { extensionsFor, fileFormat, isRemote, scanSql } from '../file-formats.ts'

/** Extensions each format needs; installed from DuckDB's extension repository into `~/.duckdb/extensions`. */
export const EXTENSIONS: Record<LakehouseDialect, string[]> = {
  iceberg: ['httpfs', 'avro', 'iceberg'],
  delta: ['delta'],
  unity: ['httpfs', 'azure', 'delta', 'unity_catalog'],
  onelake: ['azure', 'delta'],
  // files: excel/httpfs per source, see `Lake.extensions`.
  files: [],
}

const lit = (value: string) => `'${value.replaceAll("'", "''")}'`
const ident = (name: string) => `"${name.replaceAll('"', '""')}"`

/** A Delta table exposed as a view. */
interface LakeTable {
  schema: string
  name: string
  location: string
  /** Table function the view selects from. */
  scan: string
}

/** What a format adds to a DuckDB session. */
interface Lake {
  /**
   * Statements that set up the session (secrets, ATTACH, USE). Asked for before every call: when they change
   * (a renewed access token), they run again, so they must be repeatable.
   */
  setup(): Promise<string[]>
  /** Name of the attached catalog that becomes the session's current database. */
  catalog?: string
  /** Delta tables to expose as views, for formats without a catalog DuckDB can attach. */
  tables?(): Promise<LakeTable[]>
  /** Further extensions the session needs; one that cannot be loaded is logged, and the views needing it are left out. */
  extensions?(): string[]
  /** The views of `tables()` stay listed as views (files) instead of tables (Delta). */
  views?: boolean
  /** Databases to switch between (supportsDatabases). */
  databases?(): Promise<DatabaseInfo[]>
}

function wrap(e: unknown): DbError {
  return e instanceof DbError ? e : new DbError(e instanceof Error ? e.message : String(e))
}

async function check(res: Response, service: string): Promise<Response> {
  if (res.ok) return res
  throw new DbError(`${service}: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`, `HTTP${res.status}`)
}

// Iceberg REST catalog: one warehouse, attached as database `iceberg`; namespaces are its schemas.
function iceberg(c: ConnectionConfig): Lake {
  return {
    catalog: 'iceberg',
    async setup() {
      const options: string[] = []
      if (c.auth === 'oauth-client') {
        options.push(`client_id ${lit(c.clientId ?? '')}`, `client_secret ${lit(c.password ?? '')}`)
        if (c.oauthServerUri) options.push(`oauth2_server_uri ${lit(c.oauthServerUri)}`)
        if (c.oauthScope) options.push(`oauth2_scope ${lit(c.oauthScope)}`)
      } else if (c.auth === 'token') {
        options.push(`token ${lit(c.password ?? '')}`)
      }
      return [
        ...(options.length ? [`create or replace secret colwerk_iceberg (type iceberg, ${options.join(', ')})`] : []),
        `attach if not exists ${lit(c.database ?? '')} as iceberg (type iceberg, endpoint ${lit(c.host ?? '')}, ${
          options.length ? 'secret colwerk_iceberg' : `authorization_type 'none'`
        })`,
      ]
    },
  }
}

// Folder of Delta tables (each subfolder with a `_delta_log`) or a single table, on the local file system.
function delta(c: ConnectionConfig): Lake {
  const root = c.file ?? ''
  const isTable = (dir: string) => existsSync(join(dir, '_delta_log'))
  return {
    setup: async () => [],
    async tables() {
      if (isTable(root))
        return [{ schema: 'main', name: basename(root), location: root, scan: `delta_scan(${lit(root)})` }]
      return (await readdir(root, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && isTable(join(root, e.name)))
        .map((e) => {
          const location = join(root, e.name)
          return { schema: 'main', name: e.name, location, scan: `delta_scan(${lit(location)})` }
        })
    },
  }
}

// Unity Catalog (Databricks or open source): the selected catalog is attached under its own name.
function unity(c: ConnectionConfig): Lake {
  return {
    catalog: c.database && unityAlias(c.database),
    async setup() {
      const options = [`token ${lit(c.password ?? '')}`, `endpoint ${lit(c.host ?? '')}`]
      if (c.region) options.push(`aws_region ${lit(c.region)}`)
      const catalog = c.database
      return [
        `create or replace secret colwerk_unity (type unity_catalog, ${options.join(', ')})`,
        ...(catalog
          ? [
              `attach if not exists ${lit(catalog)} as ${ident(unityAlias(catalog))} (type unity_catalog, secret colwerk_unity)`,
            ]
          : []),
      ]
    },
    async databases() {
      const names: string[] = []
      let page = ''
      do {
        const url = new URL('/api/2.1/unity-catalog/catalogs', c.host)
        if (page) url.searchParams.set('page_token', page)
        const res = await check(
          await fetch(url, { headers: { Authorization: `Bearer ${c.password}` } }),
          'Unity Catalog',
        )
        const body = (await res.json()) as { catalogs?: { name: string }[]; next_page_token?: string }
        names.push(...(body.catalogs ?? []).map((x) => x.name))
        page = body.next_page_token ?? ''
      } while (page)
      return names.sort().map((name) => ({ name }))
    },
  }
}

// Names DuckDB reserves for its own databases; such catalogs (e.g. Databricks' `system`) get a suffix.
const RESERVED = new Set(['system', 'temp', 'main', 'memory'])
const unityAlias = (catalog: string) => (RESERVED.has(catalog.toLowerCase()) ? `${catalog}_catalog` : catalog)

const ONELAKE = 'onelake.dfs.fabric.microsoft.com'
const STORAGE_SCOPE = 'https://storage.azure.com/.default'

// OneLake (Microsoft Fabric): the Delta tables in `Tables` of a lakehouse, read with the connection's Entra login.
// Lakehouses with schemas keep their tables in `Tables/<schema>/<table>`.
function onelake(c: ConnectionConfig): Lake {
  const workspace = c.host ?? ''
  // A lakehouse is addressed by name (with the item type as suffix) or by its ID.
  const item = (name: string) => (/\.lakehouse$|^[0-9a-f-]{36}$/i.test(name) ? name : `${name}.Lakehouse`)

  /** Entries of a directory of the workspace (ADLS Gen2 API, which OneLake implements). */
  async function list(directory?: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const token = await entraToken(c, STORAGE_SCOPE)
    const entries: { name: string; isDirectory: boolean }[] = []
    let continuation = ''
    do {
      const url = new URL(`https://${ONELAKE}/${encodeURIComponent(workspace)}`)
      url.searchParams.set('resource', 'filesystem')
      url.searchParams.set('recursive', 'false')
      if (directory) url.searchParams.set('directory', directory)
      if (continuation) url.searchParams.set('continuation', continuation)
      const res = await check(
        await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-ms-version': '2023-11-03' } }),
        'OneLake',
      )
      const body = (await res.json()) as { paths?: { name: string; isDirectory?: string }[] }
      entries.push(...(body.paths ?? []).map((p) => ({ name: p.name, isDirectory: p.isDirectory === 'true' })))
      continuation = res.headers.get('x-ms-continuation') ?? ''
    } while (continuation)
    return entries
  }

  return {
    async setup() {
      const token = await entraToken(c, STORAGE_SCOPE)
      return [
        `create or replace secret colwerk_onelake (type azure, provider access_token, access_token ${lit(token)}, account_name 'onelake')`,
      ]
    },
    async tables() {
      if (!c.database) return []
      const location = (path: string) => `abfss://${workspace}@${ONELAKE}/${path}`
      const dirs = (await list(`${item(c.database)}/Tables`)).filter((d) => d.isDirectory)
      const found = await Promise.all(
        dirs.map(async (dir): Promise<LakeTable[]> => {
          const name = basename(dir.name)
          const children = await list(dir.name)
          if (children.some((ch) => basename(ch.name) === '_delta_log')) {
            return [
              { schema: 'main', name, location: location(dir.name), scan: `delta_scan(${lit(location(dir.name))})` },
            ]
          }
          return children
            .filter((ch) => ch.isDirectory)
            .map((ch) => ({
              schema: name,
              name: basename(ch.name),
              location: location(ch.name),
              scan: `delta_scan(${lit(location(ch.name))})`,
            }))
        }),
      )
      return found.flat()
    },
    async databases() {
      return (await list())
        .filter((e) => e.isDirectory && /\.lakehouse$/i.test(e.name))
        .map((e) => ({ name: e.name.replace(/\.lakehouse$/i, '') }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
  }
}

/** The DuckDB secret of a files connection's credential, as statements. */
export function fileSecrets(c: ConnectionConfig): string[] {
  const secret = (options: string[]) => [`create or replace secret colwerk_files (${options.join(', ')})`]
  if (c.auth === 's3') {
    const options = [
      'type s3',
      `key_id ${lit(c.user ?? '')}`,
      `secret ${lit(c.password ?? '')}`,
      `region ${lit(c.region ?? 'us-east-1')}`,
    ]
    if (c.host) {
      options.push(`endpoint ${lit(c.host.replace(/^https?:\/\//i, '').replace(/\/+$/, ''))}`, `url_style 'path'`)
      if (/^http:\/\//i.test(c.host)) options.push('use_ssl false')
    }
    return secret(options)
  }
  if (c.auth === 'gcs') return secret(['type gcs', `key_id ${lit(c.user ?? '')}`, `secret ${lit(c.password ?? '')}`])
  if (c.auth === 'token') return secret(['type http', `bearer_token ${lit(c.password ?? '')}`])
  return []
}

/**
 * View names of data files and URLs: the file name without extension, lower case, other characters as `_`; names
 * starting with a digit get a `t_` prefix, duplicates a number (`_2`, `_3`, ...) in list order.
 */
export function viewNames(sources: string[]): string[] {
  const seen = new Map<string, number>()
  return sources.map((source) => {
    const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? decodeURIComponent(new URL(source).pathname) : source
    let name = (path.split(/[\\/]/).pop() ?? '')
      .replace(/\.[a-z0-9]+(\.(?:gz|zst))?$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (!name || /^\d/.test(name)) name = `t_${name}`
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return n > 1 ? `${name}_${n}` : name
  })
}

// Data files and URLs, each a view in schema `main`; the sources are those saved with the connection.
function files(c: ConnectionConfig): Lake {
  const sources = c.sources ?? []
  const known = sources.flatMap((s) => {
    const format = fileFormat(s)
    return format ? [{ source: s, format }] : []
  })
  return {
    views: true,
    extensions: () => [
      ...new Set([
        ...(c.auth && c.auth !== 'none' ? ['httpfs'] : []),
        ...known.flatMap((s) => extensionsFor(s.source, s.format)),
      ]),
    ],
    setup: async () => fileSecrets(c),
    async tables() {
      const names = viewNames(known.map((s) => s.source))
      return known.map((s, i) => ({
        schema: 'main',
        name: names[i]!,
        location: s.source,
        scan: scanSql(s.source, s.format),
      }))
    },
  }
}

const LAKES: Record<LakehouseDialect, (c: ConnectionConfig) => Lake> = { iceberg, delta, unity, onelake, files }

class LakehouseSession extends DuckDBSession {
  private applied = ''
  // Views over Delta tables, listed as tables: `schema\0name`.
  private lakeTables = new Set<string>()

  constructor(
    conn: Connection,
    private lake: Lake,
  ) {
    super(conn)
  }

  /** Runs the setup statements when they have changed since the last call. */
  async prepare(): Promise<void> {
    const statements = await this.lake.setup()
    const key = statements.join(';\n')
    if (key === this.applied) return
    for (const sql of statements) await this.rows(sql)
    if (!this.applied && this.lake.catalog) await this.use(this.lake.catalog)
    this.applied = key
  }

  /**
   * Makes the catalog the current database. `USE <catalog>` needs a schema `main`, which catalogs rarely have, so
   * one of its schemas is chosen (`default` if there is one). An empty catalog leaves the session as it is.
   */
  private async use(catalog: string): Promise<void> {
    const [schema] = await this.rows<{ name: string }>(
      `select schema_name as name from duckdb_schemas()
       where database_name = $1 and schema_name <> 'information_schema'
       order by schema_name <> 'main', schema_name <> 'default', schema_name limit 1`,
      [catalog],
    )
    if (schema) await this.rows(`use ${ident(catalog)}.${ident(schema.name)}`)
  }

  /**
   * Creates a view for every Delta table that has none yet (creating a view reads the table's log). A table that
   * cannot be read is left out instead of failing the connection.
   */
  async discover(): Promise<void> {
    if (!this.lake.tables) return
    const tables = await this.lake.tables()
    const existing = new Set(
      (
        await this.rows<{ schema: string; name: string }>(
          `select schema_name as schema, view_name as name from duckdb_views()
           where database_name = current_database() and not internal`,
        )
      ).map((v) => `${v.schema}\0${v.name}`),
    )
    for (const t of tables) {
      const key = `${t.schema}\0${t.name}`
      if (!existing.has(key)) {
        try {
          if (t.schema !== 'main') await this.rows(`create schema if not exists ${ident(t.schema)}`)
          await this.rows(`create view if not exists ${ident(t.schema)}.${ident(t.name)} as select * from ${t.scan}`)
        } catch (e) {
          console.warn(`${t.location} left out: ${(e as Error).message}`)
          continue
        }
      }
      if (!this.lake.views) this.lakeTables.add(key)
    }
  }

  /** Whether the instance has views of an earlier discovery (it is shared by all sessions of the connection). */
  async discovered(): Promise<boolean> {
    const [row] = await this.rows<{ n: string }>(
      'select count(*) as n from duckdb_views() where database_name = current_database() and not internal',
    )
    return Number(row?.n) > 0
  }

  override async execute(sql: string, options: { rowLimit: number }): Promise<QueryResult> {
    await this.prepare().catch((e) => Promise.reject(wrap(e)))
    return super.execute(sql, options)
  }

  override async stream(sql: string, sink: RowSink): Promise<void> {
    await this.prepare().catch((e) => Promise.reject(wrap(e)))
    return super.stream(sql, sink)
  }

  override async introspect<R extends IntrospectRequest>(req: R): Promise<IntrospectResult<R>> {
    try {
      await this.prepare()
      if (req.kind === 'databases' && this.lake.databases) return (await this.lake.databases()) as IntrospectResult<R>
      // Listing schemas or tables also picks up Delta tables created since.
      if (req.kind === 'schemas' || req.kind === 'tables') await this.discover()
    } catch (e) {
      throw wrap(e)
    }
    // Tables of an attached catalog are loaded on first use; until then DuckDB lists them with a placeholder column.
    const table =
      req.kind === 'columns'
        ? { schema: req.schema, name: req.table }
        : req.kind === 'ddl' && req.object === 'table'
          ? { schema: req.schema, name: req.name }
          : undefined
    if (this.lake.catalog && table) {
      await this.rows(`describe ${ident(this.lake.catalog)}.${ident(table.schema)}.${ident(table.name)}`).catch(
        () => {},
      )
    }
    if (req.kind === 'ddl' && req.object === 'table' && this.lakeTables.has(`${req.schema}\0${req.name}`)) {
      return super.introspect({ ...req, object: 'view' })
    }
    const result = await super.introspect(req)
    if (req.kind !== 'tables') return result
    return (result as TableInfo[]).map((t) =>
      this.lakeTables.has(`${t.schema}\0${t.name}`) ? { ...t, kind: 'table' } : t,
    ) as IntrospectResult<R>
  }
}

/** Name of the in-memory database of a connection (and database), shared by its sessions. */
export const lakePath = (c: ConnectionConfig) => `:memory:lakehouse:${c.id}:${c.database ?? ''}`

export function lakehouseDriver(dialect: LakehouseDialect): Driver {
  return {
    async connect(config) {
      // One in-memory database per connection and database, shared by its sessions: views and secrets are set up
      // once; a session closing last drops it.
      const conn = await connect(lakePath(config), false, false)
      const lake = LAKES[dialect](config)
      const session = new LakehouseSession(conn, lake)
      try {
        await loadExtensions(conn, EXTENSIONS[dialect])
        for (const name of lake.extensions?.() ?? []) {
          await loadExtensions(conn, [name]).catch((e) => console.warn((e as Error).message))
        }
        await session.prepare()
        if (!(await session.discovered())) await session.discover()
        return session
      } catch (e) {
        await session.close()
        throw wrap(e)
      }
    },
  }
}

/** Installs (once, from DuckDB's extension repository) and loads the extensions. */
async function loadExtensions(conn: Connection, names: string[]): Promise<void> {
  for (const name of names) {
    try {
      for (const sql of [`install ${name}`, `load ${name}`]) (await conn.query(sql)).close()
    } catch (e) {
      const detail = (e as Error).message
      throw new AppError('extensionFailed', `The DuckDB extension ${name} could not be loaded: ${detail}`, {
        code: 'EEXTENSION',
        params: { name, detail },
      })
    }
  }
}

/** Extensions of `dialect` that are not installed yet. */
export async function missingExtensions(dialect: LakehouseDialect): Promise<string[]> {
  const conn = await connect(':memory:colwerk-extensions', false, false)
  try {
    const result = await conn.query(`select extension_name from duckdb_extensions() where installed`)
    const installed = new Set<string>()
    try {
      for (let chunk; (chunk = await result.next());) for (const [name] of chunk) installed.add(String(name))
    } finally {
      result.close()
    }
    return EXTENSIONS[dialect].filter((name) => !installed.has(name))
  } finally {
    conn.close()
  }
}

/** Downloads the extensions of `dialect`. */
export async function installExtensions(dialect: LakehouseDialect): Promise<void> {
  const conn = await connect(':memory:colwerk-extensions', false, false)
  try {
    await loadExtensions(conn, EXTENSIONS[dialect])
  } finally {
    conn.close()
  }
}

/**
 * Creates the views of new sources in the connection's in-memory database (shared with its open sessions; without
 * one, they are created again from the saved sources on the next connect). Returns the sources read, with their
 * view names, and the errors of the others.
 */
export async function addFileSources(config: ConnectionConfig, sources: string[]) {
  const added: { source: string; name: string }[] = []
  const failed: { source: string; error: DbError }[] = []
  const conn = await connect(lakePath(config), false, false)
  try {
    let remoteError: DbError | undefined
    if ((config.auth && config.auth !== 'none') || sources.some(isRemote)) {
      try {
        await loadExtensions(conn, ['httpfs'])
        for (const sql of fileSecrets(config)) (await conn.query(sql)).close()
      } catch (e) {
        remoteError = wrap(e)
      }
    }
    const accepted = [...(config.sources ?? [])]
    for (const source of sources) {
      const existing = accepted.indexOf(source)
      if (existing >= 0) {
        added.push({ source, name: viewNames(accepted)[existing]! })
        continue
      }
      const format = fileFormat(source)
      if (!format) {
        failed.push({
          source,
          error: new AppError('unsupportedFile', `Not a supported data file: ${source}`, { params: { name: source } }),
        })
        continue
      }
      try {
        if (remoteError && isRemote(source)) throw remoteError
        await loadExtensions(conn, extensionsFor(source, format))
        const name = viewNames([...accepted, source]).at(-1)!
        // DuckDB binds the file now, so read errors surface here.
        const sql = `create view if not exists main.${ident(name)} as select * from ${scanSql(source, format)}`
        ;(await conn.query(sql)).close()
        accepted.push(source)
        added.push({ source, name })
      } catch (e) {
        failed.push({ source, error: wrap(e) })
      }
    }
  } finally {
    conn.close()
  }
  return { added, failed }
}
