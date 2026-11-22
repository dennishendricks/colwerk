import { drivers, loadDriver } from './registry.ts'
import { writingStatement } from './sql-guard.ts'
import { openTunnel, type Tunnel } from './ssh-tunnel.ts'
import { isReadOnlyStatement, splitStatements } from './sql-split.ts'
import {
  AppError,
  type CellValue,
  type ConnectionConfig,
  DbError,
  type IntrospectRequest,
  type IntrospectResult,
  type QueryResult,
  type RowSink,
  type ServerSession,
  type Session,
  type SessionAction,
  sqlDialect,
} from './types.ts'

// Error codes meaning the connection itself is gone; the session is dropped and reopened on next use.
const CONNECTION_LOST = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNCLOSED',
  'PROTOCOL_CONNECTION_LOST',
  '57P01',
  '08006',
  '08003',
])

const PLAN_ROW_LIMIT = 10_000
const SHOWPLAN_COLUMN = 'Microsoft SQL Server 2005 XML Showplan'
const MONITOR_TIMEOUT = 15
const monitorTab = (connectionId: string) => `monitor:${connectionId}`

interface TabSession {
  connectionId: string
  database?: string
  session: Promise<Session>
  busy: boolean
}

/**
 * Owns all open database sessions:
 * - one dedicated session per editor tab (so transactions and session state stay per tab)
 * - one metadata session per connection and database, used serially for introspection
 * - an introspection cache, filled lazily
 *
 * `database` switches to another database of the server; undefined is the one configured in the connection.
 */
export class Workbench {
  private tabs = new Map<string, TabSession>()
  // Keyed by connection and database (metaKey).
  private meta = new Map<string, { connectionId: string; session: Promise<Session>; queue: Promise<unknown> }>()
  private cache = new Map<string, Promise<unknown>>()
  // Connections the user disconnected: no sessions are opened until `connect` (frees DuckDB's file lock for other tools).
  private disconnected = new Set<string>()

  // SSH tunnels by connection, shared by its sessions and closed with the last one.
  private tunnels = new Map<string, { refs: number; tunnel: Promise<Tunnel> }>()

  /** `saveHostKey` records the host key of an SSH server on the first connect. */
  constructor(
    private resolveConfig: (connectionId: string) => Promise<ConnectionConfig>,
    private saveHostKey: (connectionId: string, fingerprint: string) => Promise<void> = async () => {},
  ) {}

  async test(config: ConnectionConfig): Promise<void> {
    const session = await this.connectSession(config, `test:${crypto.randomUUID()}`, false)
    await session.close()
  }

  /** Read-only connections: refuses scripts with a statement that may write, before anything runs. */
  private async refuseWrites(connectionId: string, sql: string): Promise<void> {
    const config = await this.resolveConfig(connectionId)
    if (!config.readOnly) return
    const statement = writingStatement(sql, sqlDialect(config.dialect))
    if (!statement) return
    const err = new AppError('readOnly', 'The connection is read-only: the statement may change data or structures.', {
      code: 'EREADONLY',
    })
    err.position = statement.from
    throw err
  }

  /**
   * Cancels the statement when it has not finished after `timeoutSeconds` (connecting does not count).
   * Result and error carry the session's transaction state: a failed statement can leave a transaction open.
   */
  async execute(
    tabId: string,
    connectionId: string,
    sql: string,
    rowLimit: number,
    timeoutSeconds: number,
    database?: string,
  ): Promise<QueryResult> {
    await this.refuseWrites(connectionId, sql)
    return this.runTab(tabId, connectionId, database, async (s) => {
      const transaction = () => s.transactionState().catch(() => undefined)
      try {
        return {
          ...(await withTimeout(s, timeoutSeconds, () => s.execute(sql, { rowLimit }))),
          transaction: await transaction(),
        }
      } catch (err) {
        if (err instanceof DbError && !CONNECTION_LOST.has(err.code ?? '')) err.transaction = await transaction()
        throw err
      }
    })
  }

  /**
   * The execution plan of exactly one statement as text (on SQL Server as Showplan XML, `format: 'showplan'`), in
   * the tab's session (same session state as `execute`). `analyze` runs the statement, so it is only accepted for
   * read-only statements and not on SQLite or ClickHouse.
   */
  async explain(
    tabId: string,
    connectionId: string,
    sql: string,
    analyze: boolean,
    timeoutSeconds: number,
    database?: string,
  ): Promise<{ plan: string; durationMs: number; format?: 'showplan' }> {
    const dialect = sqlDialect((await this.resolveConfig(connectionId)).dialect)
    // Checked here, not only in the UI: Postgres and DuckDB would run a second statement as such.
    const ranges = splitStatements(sql, dialect)
    if (ranges.length !== 1) throw new AppError('explainSingle', 'Only a single statement can be explained.')
    const statement = sql.slice(ranges[0]!.from, ranges[0]!.to)
    if (analyze && (dialect === 'sqlite' || dialect === 'clickhouse' || !isReadOnlyStatement(statement, dialect))) {
      throw new AppError(
        'analyzeReadOnly',
        'ANALYZE executes the statement and is only available for read-only statements.',
      )
    }
    return this.runTab(tabId, connectionId, database, async (s) => {
      const started = performance.now()
      const run = (text: string) => withTimeout(s, timeoutSeconds, () => s.execute(text, { rowLimit: PLAN_ROW_LIMIT }))
      if (dialect === 'mssql') {
        // SHOWPLAN_XML must be alone in its batch; while it is on, statements return plans instead of running, so a
        // session that cannot switch it off again is dropped. STATISTICS XML runs the statement and sends the actual
        // plan as a result set after its rows: as one batch of several statements the driver reads past the row
        // limit instead of cancelling, which would lose the plan.
        const option = analyze ? 'statistics xml' : 'showplan_xml'
        let result: QueryResult
        try {
          if (analyze) {
            result = await withTimeout(s, timeoutSeconds, () =>
              s.execute(`set statistics xml on;\n${statement}\n;\nset statistics xml off`, { rowLimit: 1 }),
            )
          } else {
            await run('set showplan_xml on')
            result = await run(statement)
          }
        } finally {
          await s.execute(`set ${option} off`, { rowLimit: 1 }).catch(() => this.closeTab(tabId))
        }
        const xml = result.resultSets.find((set) => set.columns[0]?.name === SHOWPLAN_COLUMN)?.rows[0]?.[0]
        if (typeof xml !== 'string') throw new AppError('planMissing', 'SQL Server returned no execution plan.')
        return { plan: xml, durationMs: performance.now() - started, format: 'showplan' }
      }
      const prefix = {
        postgres: analyze ? 'explain (analyze, buffers, format text)' : 'explain (format text)',
        duckdb: analyze ? 'explain analyze' : 'explain',
        mysql: analyze ? 'analyze format=json' : 'explain format=json',
        sqlite: 'explain query plan',
        clickhouse: 'explain indexes = 1',
      }[dialect]
      const result = await run(`${prefix} ${statement}`)
      // The plan is in the last column (Postgres and ClickHouse: one row per line, DuckDB: explain_value, MySQL: one
      // JSON document, SQLite: one row per step, indented below its parent step).
      const depth = new Map<unknown, number>()
      const line = (r: CellValue[]) => {
        if (dialect !== 'sqlite') return String(r.at(-1))
        depth.set(r[0], (depth.get(r[1]) ?? -1) + 1)
        return `${'  '.repeat(depth.get(r[0])!)}${r.at(-1)}`
      }
      const plan = result.resultSets.map((set) => set.rows.map(line).join('\n')).join('\n\n')
      return {
        plan: dialect === 'mysql' ? JSON.stringify(JSON.parse(plan), null, 2) : plan,
        durationMs: performance.now() - started,
      }
    })
  }

  /** Streams the full result through the tab's session (same session state as `execute`). */
  async stream(tabId: string, connectionId: string, sql: string, sink: RowSink, database?: string): Promise<void> {
    await this.refuseWrites(connectionId, sql)
    return this.runTab(tabId, connectionId, database, (s) => s.stream(sql, sink))
  }

  private async runTab<T>(
    tabId: string,
    connectionId: string,
    database: string | undefined,
    fn: (s: Session) => Promise<T>,
  ): Promise<T> {
    let tab = this.tabs.get(tabId)
    if (tab && (tab.connectionId !== connectionId || tab.database !== database)) {
      await this.closeTab(tabId)
      tab = undefined
    }
    if (!tab) {
      tab = { connectionId, database, session: this.open(connectionId, database), busy: false }
      tab.session.catch(() => this.tabs.delete(tabId))
      this.tabs.set(tabId, tab)
    }
    if (tab.busy) throw new AppError('busy', 'A statement is already running in this tab.')
    tab.busy = true
    try {
      return await fn(await tab.session)
    } catch (e) {
      if (CONNECTION_LOST.has((e as DbError).code ?? '')) await this.closeTab(tabId)
      throw e
    } finally {
      tab.busy = false
    }
  }

  async cancel(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (tab?.busy) await (await tab.session).cancel()
  }

  /**
   * The server's sessions, in a session of its own per connection: the metadata session may be waiting on the very
   * locks the monitor is there to look into.
   */
  sessions(connectionId: string): Promise<ServerSession[]> {
    return this.runTab(monitorTab(connectionId), connectionId, undefined, (s) =>
      withTimeout(s, MONITOR_TIMEOUT, async () => {
        if (!s.sessions) throw new AppError('sessionsUnsupported', 'The database has no session monitor.')
        return s.sessions()
      }),
    )
  }

  /** Cancels the running statement of a server session, or terminates it (monitor session, see `sessions`). */
  stopSession(connectionId: string, id: string, action: SessionAction): Promise<void> {
    return this.runTab(monitorTab(connectionId), connectionId, undefined, (s) =>
      withTimeout(s, MONITOR_TIMEOUT, async () => {
        if (!s.stopSession) throw new AppError('sessionsUnsupported', 'The database has no session monitor.')
        return s.stopSession(id, action)
      }),
    )
  }

  closeMonitor(connectionId: string): Promise<void> {
    return this.closeTab(monitorTab(connectionId))
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    this.tabs.delete(tabId)
    await tab.session.then(
      (s) => s.close(),
      () => {},
    )
  }

  introspect<R extends IntrospectRequest>(
    connectionId: string,
    request: R,
    refresh = false,
    database?: string,
  ): Promise<IntrospectResult<R>> {
    // DDL is fetched on demand and must reflect the current definition.
    if (request.kind === 'ddl') return this.runMeta(connectionId, database, (s) => s.introspect(request))
    const key = JSON.stringify([
      connectionId,
      database ?? null,
      request.kind,
      'schema' in request ? request.schema : '',
      'table' in request ? request.table : '',
    ])
    if (refresh) this.invalidate(connectionId, request, database)
    let result = this.cache.get(key) as Promise<IntrospectResult<R>> | undefined
    if (!result) {
      result = this.runMeta(connectionId, database, (s) => s.introspect(request))
      result.catch(() => this.cache.delete(key))
      this.cache.set(key, result)
    }
    return result
  }

  /** Runs `fn` on the metadata session of the connection (serially with introspection), e.g. for catalog queries. */
  metadata<T>(connectionId: string, database: string | undefined, fn: (s: Session) => Promise<T>): Promise<T> {
    return this.runMeta(connectionId, database, fn)
  }

  /** Closes every session of a connection and drops its cache (after edit/delete). */
  async closeConnection(connectionId: string): Promise<void> {
    this.invalidate(connectionId)
    const closing: Promise<void>[] = []
    for (const [key, meta] of this.meta) {
      if (meta.connectionId !== connectionId) continue
      this.meta.delete(key)
      closing.push(
        meta.session.then(
          (s) => s.close(),
          () => {},
        ),
      )
    }
    for (const [tabId, tab] of this.tabs) {
      if (tab.connectionId === connectionId) closing.push(this.closeTab(tabId))
    }
    await Promise.all(closing)
  }

  /** Closes every session of a connection and keeps it closed until `connect`. */
  async disconnect(connectionId: string): Promise<void> {
    this.disconnected.add(connectionId)
    await this.closeConnection(connectionId)
  }

  connect(connectionId: string): void {
    this.disconnected.delete(connectionId)
  }

  isDisconnected(connectionId: string): boolean {
    return this.disconnected.has(connectionId)
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...new Set([...this.meta.values(), ...this.tabs.values()].map((s) => s.connectionId))].map((id) =>
        this.closeConnection(id),
      ),
    )
  }

  /** Drops cached entries of a connection; with a request only that entry and everything below it, in the request's database. */
  private invalidate(connectionId: string, request?: IntrospectRequest, database?: string) {
    const prefix = JSON.stringify([connectionId]).slice(0, -1)
    for (const key of this.cache.keys()) {
      if (!key.startsWith(prefix)) continue
      const [, db, kind, schema, table] = JSON.parse(key) as [string, string | null, string, string, string]
      if (request && db !== (database ?? null)) continue
      const below =
        !request ||
        request.kind === 'schemas' ||
        (request.kind === 'databases' && kind === 'databases') ||
        (request.kind === 'tables' && schema === request.schema) ||
        // Refreshing a table (its columns) also drops its indexes and foreign keys.
        (request.kind === 'columns' &&
          (kind === 'columns' || kind === 'indexes' || kind === 'foreignKeys') &&
          schema === request.schema &&
          table === request.table) ||
        (request.kind === 'indexes' && kind === 'indexes' && schema === request.schema && table === request.table) ||
        (request.kind === 'routines' && kind === 'routines' && schema === request.schema) ||
        (request.kind === 'foreignKeys' && kind === 'foreignKeys' && schema === request.schema)
      if (below) this.cache.delete(key)
    }
  }

  private async open(connectionId: string, database?: string): Promise<Session> {
    if (this.disconnected.has(connectionId)) {
      throw new AppError('disconnected', 'The connection is disconnected.', { code: 'EDISCONNECTED' })
    }
    const config = await this.resolveConfig(connectionId)
    return this.connectSession({ ...config, database: database ?? config.database }, connectionId, true)
  }

  /** Opens the session, through the connection's SSH tunnel if it has one. */
  private async connectSession(config: ConnectionConfig, tunnelKey: string, saveHostKey: boolean): Promise<Session> {
    const driver = await loadDriver(config.dialect)
    if (!config.ssh) return driver.connect(config)
    const { tunnel, release } = await this.acquireTunnel(tunnelKey, config, saveHostKey)
    try {
      const session = await driver.connect({
        ...config,
        host: '127.0.0.1',
        port: tunnel.port,
        // The server certificate is still issued for the original host name.
        sslServerName: config.sslServerName ?? config.host,
      })
      return releasing(session, release)
    } catch (e) {
      release()
      // A refused forward only shows up in the driver as a reset connection.
      throw tunnel.forwardError ?? e
    }
  }

  private async acquireTunnel(key: string, config: ConnectionConfig, saveHostKey: boolean) {
    let entry = this.tunnels.get(key)
    if (!entry) {
      const target = {
        host: config.host ?? 'localhost',
        port:
          config.port ??
          (config.dialect === 'clickhouse' && config.ssl
            ? 8443
            : drivers.find((d) => d.dialect === config.dialect)!.defaultPort!),
      }
      const created: { refs: number; tunnel: Promise<Tunnel> } = {
        refs: 0,
        tunnel: openTunnel(
          config,
          target,
          (fingerprint) => saveHostKey && void this.saveHostKey(key, fingerprint).catch(() => {}),
          () => this.tunnels.get(key) === created && this.tunnels.delete(key),
        ),
      }
      entry = created
      this.tunnels.set(key, created)
      created.tunnel.catch(() => this.tunnels.get(key) === created && this.tunnels.delete(key))
    }
    const used = entry
    used.refs++
    let released = false
    const release = () => {
      if (released) return
      released = true
      if (--used.refs > 0) return
      if (this.tunnels.get(key) === used) this.tunnels.delete(key)
      used.tunnel.then(
        (t) => t.close(),
        () => {},
      )
    }
    try {
      return { tunnel: await used.tunnel, release }
    } catch (e) {
      release()
      throw e
    }
  }

  private runMeta<T>(connectionId: string, database: string | undefined, fn: (s: Session) => Promise<T>): Promise<T> {
    const key = JSON.stringify([connectionId, database ?? null])
    let meta = this.meta.get(key)
    if (!meta) {
      const session = this.open(connectionId, database)
      meta = { connectionId, session, queue: Promise.resolve() }
      session.catch(() => this.meta.delete(key))
      this.meta.set(key, meta)
    }
    const { session } = meta
    const run = meta.queue.then(async () => {
      try {
        return await fn(await session)
      } catch (e) {
        if (CONNECTION_LOST.has((e as DbError).code ?? '') && this.meta.get(key)?.session === session) {
          this.meta.delete(key)
          session.then(
            (s) => s.close(),
            () => {},
          )
        }
        throw e
      }
    })
    meta.queue = run.catch(() => {})
    return run
  }
}

/** Cancels the statement when it has not finished after `timeoutSeconds`. */
async function withTimeout<T>(s: Session, timeoutSeconds: number, fn: () => Promise<T>): Promise<T> {
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    s.cancel().catch(() => {})
  }, timeoutSeconds * 1000)
  try {
    return await fn()
  } catch (e) {
    if (timedOut) {
      throw new AppError('timeout', `Query did not finish within ${timeoutSeconds} s and was cancelled`, {
        code: 'ETIMEOUT',
        params: { seconds: timeoutSeconds },
      })
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** The session, whose `close` also gives back its share of the SSH tunnel. */
function releasing(session: Session, release: () => void): Session {
  return {
    execute: (sql, options) => session.execute(sql, options),
    stream: (sql, sink) => session.stream(sql, sink),
    cancel: () => session.cancel(),
    transactionState: () => session.transactionState(),
    introspect: (request) => session.introspect(request),
    sessions: session.sessions && (() => session.sessions!()),
    stopSession: session.stopSession && ((id, action) => session.stopSession!(id, action)),
    close: () => session.close().finally(release),
  }
}
