// Helpers around an open database session, shared by the workbench and the plan queries.
import { referencedTables } from './sql-tables.ts'
import { AppError, type Dialect, type Session } from './types.ts'

// Error codes meaning the connection itself is gone; the session is dropped and reopened on next use.
export const CONNECTION_LOST = new Set([
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

/** Cancels the statement when it has not finished after `timeoutSeconds`. */
export async function withTimeout<T>(s: Session, timeoutSeconds: number, fn: () => Promise<T>): Promise<T> {
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
export function releasing(session: Session, release: () => void): Session {
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

/** MySQL: refuses tables whose engine cannot roll back (a NULL engine is a view). */
export async function checkTransactional(s: Session, statement: string) {
  const lit = (v: string) => `'${v.replace(/[\\']/g, '\\$&')}'`
  for (const { schema, name } of referencedTables(statement, 'mysql')) {
    const result = await s.execute(
      `select engine from information_schema.tables where table_schema = ${schema ? lit(schema) : 'database()'} and table_name = ${lit(name)}`,
      { rowLimit: 1 },
    )
    const row = result.resultSets[0]?.rows[0]
    if (!row) continue
    const engine = String(row[0] ?? 'VIEW')
    if (engine.toLowerCase() !== 'innodb') {
      throw new AppError(
        'dryRunNonTransactional',
        `${name} uses the ${engine} engine, which cannot roll back changes.`,
        {
          params: { table: name, engine },
        },
      )
    }
  }
}

// Statement that opens a transaction (dry runs, grid saves).
export const BEGIN_TRANSACTION: Partial<Record<Dialect, string>> = {
  postgres: 'begin',
  mysql: 'start transaction',
  mssql: 'begin transaction',
  duckdb: 'begin transaction',
  sqlite: 'begin',
}
