// Running a query tab's SQL: variables, write confirmation, unfiltered writes, plan check and dry run
import type { ComputedRef, ShallowRef } from 'vue'
import type { ConnectionSummary } from '#core'
import type { PlanWarning } from '~/utils/pre-execution'
import type { SplitDialect } from '~/utils/sql-split'
import type { QueryTab } from './tabs'

/** SQL ready to run; `offset` maps a position in it back to the editor content from `from`. */
export interface PendingRun {
  sql: string
  from: number
  offset: (position: number) => number
}

export function useQueryRun(
  tab: QueryTab,
  editor: Readonly<ShallowRef<{ runnableSql(): { sql: string; from: number } } | null>>,
  connection: ComputedRef<ConnectionSummary | undefined>,
) {
  const { run, explain, dryRun, planWarnings, withVariables } = useExecution()
  const { t, locale } = useI18n()
  const toast = useToast()

  // SQL that waits for confirmation because the connection asks before writes.
  const pending = ref<PendingRun>()

  // Statements that change every row (#65), waiting for explicit confirmation.
  const pendingUnfiltered = ref<PendingRun & { statements: string[] }>()

  // Variables first, so the write check sees the SQL that will run.
  async function execute() {
    const runnable = editor.value?.runnableSql() ?? { sql: '', from: 0 }
    if (!tab.connectionId || !runnable.sql.trim() || tab.running || tab.exporting || checking.value) {
      return
    }
    const substituted = await withVariables(tab, runnable.sql)
    if (!substituted) return
    const next = { ...substituted, from: runnable.from }
    const c = connection.value
    // The server refuses writes on read-only connections; there is nothing to confirm.
    if (!c || c.readOnly) return proceed(next)
    const dialect = sqlDialect(c.dialect)
    if (c.requireWhere ?? !!c.confirmWrites) {
      const unfiltered = unfilteredWrites(next.sql, dialect)
      if (unfiltered.length) {
        pendingUnfiltered.value = { ...next, statements: unfiltered.map((r) => next.sql.slice(r.from, r.to)) }
        return
      }
    }
    if (c.confirmWrites && mayWrite(next.sql, dialect)) pending.value = next
    else proceed(next)
  }

  const checking = ref(false)
  // A query whose plan reads large tables completely, waiting for confirmation.
  const planWarning = ref<PendingRun & { warnings: PlanWarning[] }>()
  const checksPlan = computed(() => {
    const c = connection.value
    return !!c && planCheckDialects.includes(sqlDialect(c.dialect)) && (c.checkPlan ?? !!c.confirmWrites)
  })

  async function proceed(next: PendingRun) {
    if (checksPlan.value) {
      checking.value = true
      const warnings = await planWarnings(tab, next.sql).finally(() => (checking.value = false))
      if (warnings.length) return void (planWarning.value = { ...next, warnings })
    }
    run(tab, next.sql, next.from, next.offset)
  }

  function runWarned() {
    const w = planWarning.value
    planWarning.value = undefined
    if (w) run(tab, w.sql, w.from, w.offset)
  }

  function showWarnedPlan() {
    const w = planWarning.value
    planWarning.value = undefined
    if (w) explain(tab, w.warnings[0]!.statement)
  }

  function confirmRun() {
    const next = pending.value
    pending.value = undefined
    if (next) proceed(next)
  }

  function confirmUnfiltered() {
    const p = pendingUnfiltered.value
    if (p) run(tab, p.sql, p.from, p.offset)
    pendingUnfiltered.value = undefined
  }

  // isReadOnlyStatement is false for any script with several statements, so check them one by one:
  // a script of SELECTs runs without asking, a single write in it asks.
  function mayWrite(sql: string, dialect: SplitDialect) {
    return splitStatements(sql, dialect).some((r) => !isReadOnlyStatement(sql.slice(r.from, r.to), dialect))
  }

  function showPlan(analyze = false) {
    explain(tab, editor.value?.runnableSql().sql ?? '', analyze)
  }

  const canDryRun = computed(
    () => !!connection.value && !connection.value.readOnly && dryRunDialects.includes(connection.value.dialect),
  )
  const isDml = (sql: string) => !!connection.value && !!dmlKind(sql.trim(), sqlDialect(connection.value.dialect))

  const dryRunTitle = (n: number | null) =>
    n === null ? t('query.dryRunUnknown') : t('query.dryRunResult', { n: n.toLocaleString(locale.value) }, n)

  async function dryRunEditor() {
    const substituted = await withVariables(tab, editor.value?.runnableSql().sql ?? '')
    if (!substituted) return
    if (!isDml(substituted.sql)) {
      toast.add({ title: t('errors.dryRunStatement'), color: 'error', icon: 'i-lucide-circle-alert' })
      return
    }
    try {
      const n = await dryRun(tab, substituted.sql)
      toast.add({
        title: dryRunTitle(n),
        description: t('query.dryRunHint'),
        color: 'success',
        icon: 'i-lucide-flask-conical',
      })
    } catch (e) {
      toast.add({
        title: t('query.dryRunFailed'),
        description: errorMessage(e),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    }
  }

  // Result of the dry run in the confirmation dialog.
  const pendingDryRun = ref<{ rows?: number | null; error?: string }>()
  watch(pending, () => (pendingDryRun.value = undefined))

  async function dryRunPending() {
    if (!pending.value) return
    try {
      pendingDryRun.value = { rows: await dryRun(tab, pending.value.sql) }
    } catch (e) {
      pendingDryRun.value = { error: errorMessage(e) }
    }
  }

  return {
    pending,
    pendingUnfiltered,
    planWarning,
    pendingDryRun,
    checking,
    canDryRun,
    execute,
    showPlan,
    runWarned,
    showWarnedPlan,
    confirmRun,
    confirmUnfiltered,
    isDml,
    dryRunTitle,
    dryRunEditor,
    dryRunPending,
  }
}
