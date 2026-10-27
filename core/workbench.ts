import { loadDriver } from './registry.ts'
import { isReadOnlyStatement, splitStatements } from './sql-split.ts'
import { type ConnectionConfig, DbError, type IntrospectRequest, type IntrospectResult, type QueryResult, type RowSink, type Session } from './types.ts'

// Error codes meaning the connection itself is gone; the session is dropped and reopened on next use.
const CONNECTION_LOST = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ESOCKET', 'ECONNCLOSED', 'PROTOCOL_CONNECTION_LOST', '57P01', '08006', '08003'])

const PLAN_ROW_LIMIT = 10_000

interface TabSession {
  connectionId: string
  session: Promise<Session>
  busy: boolean
}

/**
 * Owns all open database sessions:
 * - one dedicated session per editor tab (so transactions and session state stay per tab)
 * - one metadata session per connection, used serially for introspection
 * - an introspection cache, filled lazily
 */
export class Workbench {
  private tabs = new Map<string, TabSession>()
  private meta = new Map<string, { session: Promise<Session>, queue: Promise<unknown> }>()
  private cache = new Map<string, Promise<unknown>>()

  constructor(private resolveConfig: (connectionId: string) => Promise<ConnectionConfig>) {}

  async test(config: ConnectionConfig): Promise<void> {
    const session = await (await loadDriver(config.dialect)).connect(config)
    await session.close()
  }

  /** Cancels the statement when it has not finished after `timeoutSeconds` (connecting does not count). */
  execute(tabId: string, connectionId: string, sql: string, rowLimit: number, timeoutSeconds: number): Promise<QueryResult> {
    return this.runTab(tabId, connectionId, s => withTimeout(s, timeoutSeconds, () => s.execute(sql, { rowLimit })))
  }

  /**
   * The execution plan of exactly one statement as text, in the tab's session (same session state as `execute`).
   * `analyze` runs the statement, so it is only accepted for read-only statements and not on SQL Server.
   */
  async explain(tabId: string, connectionId: string, sql: string, analyze: boolean, timeoutSeconds: number): Promise<{ plan: string, durationMs: number }> {
    const { dialect } = await this.resolveConfig(connectionId)
    // Checked here, not only in the UI: Postgres and DuckDB would run a second statement as such.
    const ranges = splitStatements(sql, dialect)
    if (ranges.length !== 1) throw new DbError('Only a single statement can be explained.')
    const statement = sql.slice(ranges[0]!.from, ranges[0]!.to)
    if (analyze && (dialect === 'mssql' || !isReadOnlyStatement(statement, dialect))) {
      throw new DbError('ANALYZE executes the statement and is only available for read-only statements.')
    }
    return this.runTab(tabId, connectionId, async (s) => {
      const started = performance.now()
      const run = (text: string) => withTimeout(s, timeoutSeconds, () => s.execute(text, { rowLimit: PLAN_ROW_LIMIT }))
      let result: QueryResult
      if (dialect === 'mssql') {
        // SHOWPLAN must be alone in its batch. While it is on, statements return plans instead of running,
        // so a session that cannot switch it off again is dropped.
        try {
          await run('set showplan_text on')
          result = await run(statement)
        } finally {
          await s.execute('set showplan_text off', { rowLimit: 1 }).catch(() => this.closeTab(tabId))
        }
      } else {
        const prefix = {
          postgres: analyze ? 'explain (analyze, buffers, format text)' : 'explain (format text)',
          duckdb: analyze ? 'explain analyze' : 'explain',
          mysql: analyze ? 'analyze format=json' : 'explain format=json',
        }[dialect]
        result = await run(`${prefix} ${statement}`)
      }
      // The plan is in the last column (Postgres: one row per line, DuckDB: explain_value, MySQL: one JSON document).
      const plan = result.resultSets.map(set => set.rows.map(r => String(r.at(-1))).join('\n')).join('\n\n')
      return { plan: dialect === 'mysql' ? JSON.stringify(JSON.parse(plan), null, 2) : plan, durationMs: performance.now() - started }
    })
  }

  /** Streams the full result through the tab's session (same session state as `execute`). */
  stream(tabId: string, connectionId: string, sql: string, sink: RowSink): Promise<void> {
    return this.runTab(tabId, connectionId, s => s.stream(sql, sink))
  }

  private async runTab<T>(tabId: string, connectionId: string, fn: (s: Session) => Promise<T>): Promise<T> {
    let tab = this.tabs.get(tabId)
    if (tab && tab.connectionId !== connectionId) {
      await this.closeTab(tabId)
      tab = undefined
    }
    if (!tab) {
      tab = { connectionId, session: this.open(connectionId), busy: false }
      tab.session.catch(() => this.tabs.delete(tabId))
      this.tabs.set(tabId, tab)
    }
    if (tab.busy) throw new DbError('A statement is already running in this tab.')
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

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    this.tabs.delete(tabId)
    await tab.session.then(s => s.close(), () => {})
  }

  introspect<R extends IntrospectRequest>(connectionId: string, request: R, refresh = false): Promise<IntrospectResult<R>> {
    const key = JSON.stringify([connectionId, request.kind, 'schema' in request ? request.schema : '', 'table' in request ? request.table : ''])
    if (refresh) this.invalidate(connectionId, request)
    let result = this.cache.get(key) as Promise<IntrospectResult<R>> | undefined
    if (!result) {
      result = this.runMeta(connectionId, s => s.introspect(request))
      result.catch(() => this.cache.delete(key))
      this.cache.set(key, result)
    }
    return result
  }

  /** Closes every session of a connection and drops its cache (after edit/delete). */
  async closeConnection(connectionId: string): Promise<void> {
    this.invalidate(connectionId)
    const meta = this.meta.get(connectionId)
    this.meta.delete(connectionId)
    const closing = [meta?.session.then(s => s.close(), () => {})]
    for (const [tabId, tab] of this.tabs) {
      if (tab.connectionId === connectionId) closing.push(this.closeTab(tabId))
    }
    await Promise.all(closing)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...new Set([...this.meta.keys(), ...[...this.tabs.values()].map(t => t.connectionId)])].map(id => this.closeConnection(id)))
  }

  /** Drops cached entries of a connection; with a request only that entry and everything below it. */
  private invalidate(connectionId: string, request?: IntrospectRequest) {
    const prefix = JSON.stringify([connectionId]).slice(0, -1)
    for (const key of this.cache.keys()) {
      if (!key.startsWith(prefix)) continue
      const [, kind, schema, table] = JSON.parse(key) as string[]
      const below = !request
        || request.kind === 'schemas'
        || (request.kind === 'tables' && schema === request.schema)
        || (request.kind === 'columns' && kind === 'columns' && schema === request.schema && table === request.table)
      if (below) this.cache.delete(key)
    }
  }

  private async open(connectionId: string): Promise<Session> {
    const config = await this.resolveConfig(connectionId)
    return (await loadDriver(config.dialect)).connect(config)
  }

  private runMeta<T>(connectionId: string, fn: (s: Session) => Promise<T>): Promise<T> {
    let meta = this.meta.get(connectionId)
    if (!meta) {
      const session = this.open(connectionId)
      meta = { session, queue: Promise.resolve() }
      session.catch(() => this.meta.delete(connectionId))
      this.meta.set(connectionId, meta)
    }
    const { session } = meta
    const run = meta.queue.then(async () => {
      try {
        return await fn(await session)
      } catch (e) {
        if (CONNECTION_LOST.has((e as DbError).code ?? '') && this.meta.get(connectionId)?.session === session) {
          this.meta.delete(connectionId)
          session.then(s => s.close(), () => {})
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
    if (timedOut) throw new DbError(`Query did not finish within ${timeoutSeconds} s and was cancelled`, 'ETIMEOUT')
    throw e
  } finally {
    clearTimeout(timer)
  }
}
