import type { QueryResult, TransactionState } from '#core'
import type { QueryTab } from './tabs'

// Running statements in a tab's server-side session.

const openTransaction = (state?: TransactionState) => (state === 'idle' ? undefined : state)

export function useExecution() {
  const { t } = useNuxtApp().$i18n

  /** `from`: document offset where `sql` starts in the editor, to place the error position. */
  async function run(tab: QueryTab, sql: string, from = 0) {
    if (!tab.connectionId || !sql.trim() || tab.running || tab.exporting) return
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
      tab.resultIndex = Math.max(0, tab.result.resultSets.length - 1)
      tab.source = { connectionId: tab.connectionId, database: tab.database, sql }
      tab.transaction = openTransaction(tab.result.transaction)
    } catch (e) {
      tab.result = undefined
      tab.error = errorMessage(e)
      const position = (e as { data?: { data?: { position?: number } } }).data?.data?.position
      if (position !== undefined) tab.errorAt = from + position
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
    tab.running = true
    tab.error = undefined
    tab.errorAt = undefined
    tab.result = undefined
    tab.source = undefined
    tab.plan = undefined
    try {
      const { plan, durationMs } = await api<{ plan: string; durationMs: number }>(`/api/tabs/${tab.id}/explain`, {
        method: 'POST',
        body: { connectionId: tab.connectionId, database: tab.database, sql, analyze, timeout: tab.timeout },
      })
      tab.plan = { text: plan, durationMs }
    } catch (e) {
      tab.error = errorMessage(e)
    } finally {
      tab.running = false
    }
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
   */
  async function exportResult(tab: QueryTab, format: 'csv' | 'parquet', full: boolean): Promise<string | undefined> {
    const shown = tab.result?.resultSets[tab.resultIndex]
    tab.exporting = 'running'
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
      const path = await fileDialog('save', t('dialog.save'), `export-${stamp}.${format}`)
      // Widened: `cancel()` changes it while this call is waiting.
      if (!path || (tab.exporting as QueryTab['exporting']) === 'cancelled') return undefined
      const { statement } = shown ?? {}
      const body =
        full && tab.source && statement
          ? {
              format,
              path,
              connectionId: tab.source.connectionId,
              database: tab.source.database,
              sql: tab.source.sql.slice(statement.from, statement.to),
            }
          : { format, path, columns: shown?.columns, rows: shown?.rows }
      await api(`/api/tabs/${tab.id}/export`, { method: 'POST', body })
      return path
    } catch (e) {
      if ((tab.exporting as QueryTab['exporting']) === 'cancelled') return undefined
      throw e
    } finally {
      tab.exporting = undefined
    }
  }

  return { run, explain, cancel, exportResult }
}
