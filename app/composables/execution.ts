import type { ExportFormat, QueryResult, TransactionState } from '#core'
import type { PlanWarning } from '~/utils/pre-execution'
import type { PinnedResult, QueryTab } from './tabs'

// Running statements in a tab's server-side session.

/** Open variables dialog (rendered by the tab's QueryPanel): resolves with the entered values, `undefined` if cancelled. */
export const variablePrompt = ref<{
  tabId: string
  names: string[]
  values: Record<string, string>
  done: (values?: Record<string, string>) => void
}>()

// Not taken from core/export/, which pulls in `node:fs`.
const extensions: Record<ExportFormat, string> = {
  csv: 'csv',
  parquet: 'parquet',
  xlsx: 'xlsx',
  json: 'json',
  ndjson: 'ndjson',
  markdown: 'md',
  insert: 'sql',
}

const openTransaction = (state?: TransactionState) => (state === 'idle' ? undefined : state)

export function useExecution() {
  const { t } = useNuxtApp().$i18n
  const { driverOf } = useConnections()

  /**
   * Asks for the values of the `${name}` variables in `sql` (prefilled from the tab's last ones) and substitutes them.
   * `offset` maps a position in the substituted SQL back to `sql`; `undefined` result: cancelled.
   */
  async function withVariables(tab: QueryTab, sql: string) {
    const dialect = driverOf(tab.connectionId)?.dialect
    const uses = dialect ? findVariables(sql, sqlDialect(dialect)) : []
    if (!uses.length) return { sql, offset: (position: number) => position }
    const names = variableNames(uses)
    const values = await new Promise<Record<string, string> | undefined>((done) => {
      variablePrompt.value = {
        tabId: tab.id,
        names,
        values: Object.fromEntries(names.map((n) => [n, tab.variables?.[n] ?? ''])),
        done,
      }
    })
    if (!values) return undefined
    tab.variables = { ...tab.variables, ...values }
    return {
      sql: substituteVariables(sql, uses, values),
      offset: (position: number) => originalOffset(uses, values, position),
    }
  }

  /**
   * `from`: document offset where `sql` starts in the editor, to place the error position.
   * `offset`: `sql` is already substituted (see `withVariables`) and `offset` maps its positions back.
   */
  async function run(tab: QueryTab, sql: string, from = 0, offset?: (position: number) => number) {
    if (!tab.connectionId || !sql.trim() || tab.running || tab.exporting) return
    if (!offset) {
      const substituted = await withVariables(tab, sql)
      if (!substituted) return
      ;({ sql, offset } = substituted)
    }
    tab.running = true
    tab.error = undefined
    tab.errorAt = undefined
    tab.plan = undefined
    try {
      // Raw: deep reactivity on up to 100k rows would wrap every row and cell in a proxy.
      tab.result = markRaw(
        await api<QueryResult>(`/api/tabs/${tab.id}/execute`, {
          method: 'POST',
          body: {
            connectionId: tab.connectionId,
            database: tab.database,
            sql,
            rowLimit: tab.rowLimit,
            timeout: tab.timeout,
          },
        }),
      )
      // The last result set is usually the one a script is run for.
      tab.executedAt = Date.now()
      if (!tab.compare) tab.viewPin = undefined
      tab.resultIndex = Math.max(0, tab.result.resultSets.length - 1)
      tab.source = { connectionId: tab.connectionId, database: tab.database, sql }
      tab.transaction = openTransaction(tab.result.transaction)
    } catch (e) {
      tab.result = undefined
      tab.error = errorMessage(e)
      const position = (e as { data?: { data?: { position?: number } } }).data?.data?.position
      if (position !== undefined) tab.errorAt = from + offset(position)
      // A failed statement can leave the transaction open; the server sends the state along with the error.
      tab.transaction = openTransaction(
        (e as { data?: { data?: { transaction?: TransactionState } } }).data?.data?.transaction,
      )
    } finally {
      tab.running = false
    }
  }

  /** `analyze` executes the statement; the server only accepts it for read-only statements. */
  async function explain(tab: QueryTab, sql: string, analyze = false) {
    if (!tab.connectionId || !sql.trim() || tab.running || tab.exporting) return
    sql = (await withVariables(tab, sql))?.sql ?? ''
    if (!sql) return
    tab.running = true
    tab.error = undefined
    tab.errorAt = undefined
    tab.result = undefined
    tab.source = undefined
    tab.plan = undefined
    tab.viewPin = undefined
    tab.compare = false
    try {
      const { plan, durationMs, format } = await api<{ plan: string; durationMs: number; format?: 'showplan' }>(
        `/api/tabs/${tab.id}/explain`,
        {
          method: 'POST',
          body: { connectionId: tab.connectionId, database: tab.database, sql, analyze, timeout: tab.timeout },
        },
      )
      tab.plan = { text: plan, durationMs, executedAt: Date.now(), format }
    } catch (e) {
      tab.error = errorMessage(e)
    } finally {
      tab.running = false
    }
  }

  /** Runs one DML statement in a transaction of its own that is always rolled back; resolves with the affected rows (null: not reported). */
  async function dryRun(tab: QueryTab, sql: string): Promise<number | null> {
    tab.running = true
    tab.error = undefined
    try {
      const { affectedRows } = await api<{ affectedRows: number | null }>(`/api/tabs/${tab.id}/dry-run`, {
        method: 'POST',
        body: { connectionId: tab.connectionId, database: tab.database, sql, timeout: tab.timeout },
      })
      return affectedRows
    } finally {
      tab.running = false
    }
  }

  /** Plan check before running; never fails: no warnings when the check is not possible. */
  async function planWarnings(tab: QueryTab, sql: string): Promise<PlanWarning[]> {
    const { warnings } = await api<{ warnings: PlanWarning[] }>(`/api/tabs/${tab.id}/plan-check`, {
      method: 'POST',
      body: { connectionId: tab.connectionId, database: tab.database, sql },
    }).catch(() => ({ warnings: [] }))
    return warnings
  }

  /** Saves grid edits (see Workbench.applyEdits); resolves with the affected rows. */
  async function applyEdits(tab: QueryTab, statements: string[]): Promise<number> {
    const { affectedRows } = await api<{ affectedRows: number }>(`/api/tabs/${tab.id}/edit`, {
      method: 'POST',
      body: {
        connectionId: tab.source!.connectionId,
        database: tab.source!.database,
        statements,
        timeout: tab.timeout,
      },
    })
    return affectedRows
  }

  async function cancel(tab: QueryTab) {
    if (tab.exporting) tab.exporting = 'cancelled'
    await api(`/api/tabs/${tab.id}/cancel`, { method: 'POST' }).catch((e) => {
      tab.error = errorMessage(e)
    })
  }

  /**
   * Asks for the target file in a native dialog, then the server writes it.
   * `full`: runs the statement again without row limit; otherwise exports the rows of the result set shown.
   * Resolves with the path once the file is written completely, with `undefined` if the user cancelled.
   * `pin`: exports this pinned result instead of the current one (with its own source for the full result).
   */
  async function exportResult(
    tab: QueryTab,
    format: ExportFormat,
    full: boolean,
    pin?: PinnedResult,
    insert?: { table: string[]; batchSize: number },
  ): Promise<string | undefined> {
    const shown = pin?.set ?? tab.result?.resultSets[tab.resultIndex]
    const source = pin?.source ?? tab.source
    tab.exporting = 'running'
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
      const path = await fileDialog('save', t('dialog.save'), `export-${stamp}.${extensions[format]}`)
      // Widened: `cancel()` changes it while this call is waiting.
      if (!path || (tab.exporting as QueryTab['exporting']) === 'cancelled') return undefined
      const { statement } = shown ?? {}
      const common = {
        format,
        path,
        connectionId: source?.connectionId,
        insert: format === 'insert' ? insert : undefined,
      }
      const body =
        full && source && statement
          ? { ...common, database: source.database, sql: source.sql.slice(statement.from, statement.to) }
          : { ...common, columns: shown?.columns, rows: shown?.rows }
      await api(`/api/tabs/${tab.id}/export`, { method: 'POST', body })
      return path
    } catch (e) {
      if ((tab.exporting as QueryTab['exporting']) === 'cancelled') return undefined
      throw e
    } finally {
      tab.exporting = undefined
    }
  }

  return { run, explain, dryRun, planWarnings, applyEdits, withVariables, cancel, exportResult }
}
