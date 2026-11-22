// Execution plans in an open session: the plan shown to the user (`explainPlan`) and the scans of the plan check.
import { clickhouseScans, mssqlScans, mysqlScans, postgresScans, type Scan } from './plan-check.ts'
import { CONNECTION_LOST, withTimeout } from './session-utils.ts'
import type { SplitDialect } from './sql-split.ts'
import { AppError, type CellValue, DbError, type QueryResult, type Session } from './types.ts'

const PLAN_ROW_LIMIT = 10_000
const SHOWPLAN_COLUMN = 'Microsoft SQL Server 2005 XML Showplan'
const PLAN_CHECK_TIMEOUT = 10

/**
 * The plan of one statement as text (on SQL Server as Showplan XML). `analyze` runs the statement. `dropSession` is
 * called when SQL Server cannot switch the plan option off again, so the session must not be used any further.
 */
export async function explainPlan(
  s: Session,
  dialect: SplitDialect,
  statement: string,
  analyze: boolean,
  timeoutSeconds: number,
  dropSession: () => Promise<void>,
): Promise<{ plan: string; durationMs: number; format?: 'showplan' }> {
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
      await s.execute(`set ${option} off`, { rowLimit: 1 }).catch(dropSession)
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
}

/**
 * Tables that the plans (EXPLAIN, never ANALYZE) of `statements` read completely. A statement whose EXPLAIN fails is
 * skipped; `dropSession` as in `explainPlan`.
 */
export async function planScans(
  s: Session,
  d: SplitDialect,
  statements: string[],
  dropSession: () => Promise<void>,
): Promise<{ statement: string; scan: Scan }[]> {
  const scans: { statement: string; scan: Scan }[] = []
  const run = (text: string) => withTimeout(s, PLAN_CHECK_TIMEOUT, () => s.execute(text, { rowLimit: PLAN_ROW_LIMIT }))
  const plan = async (text: string): Promise<Scan[]> => {
    if (d === 'mssql') {
      // SHOWPLAN must be alone in its batch; see `explainPlan`.
      try {
        await run('set showplan_all on')
        return (await run(text)).resultSets.flatMap(mssqlScans)
      } finally {
        await s.execute('set showplan_all off', { rowLimit: 1 }).catch(dropSession)
      }
    }
    const prefix = {
      postgres: 'explain (format json, verbose)',
      mysql: 'explain format=json',
      clickhouse: 'explain estimate',
    }[d as 'postgres' | 'mysql' | 'clickhouse']
    const set = (await run(`${prefix} ${text}`)).resultSets[0]
    if (!set) return []
    if (d === 'clickhouse') return clickhouseScans(set)
    return (d === 'postgres' ? postgresScans : mysqlScans)(set.rows[0]![0]!)
  }
  for (const statement of statements) {
    try {
      for (const scan of await plan(statement)) scans.push({ statement, scan })
    } catch (e) {
      if (!(e instanceof DbError) || CONNECTION_LOST.has(e.code ?? '')) throw e
    }
  }
  return scans
}
