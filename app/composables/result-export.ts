// Exporting and copying the shown result of a query tab, including the target of SQL INSERT statements
import type { ComputedRef, ShallowRef } from 'vue'
import type { CellValue, ExportFormat, ResultColumn, ResultSet } from '#core'
import { insertSql, maxInsertRows } from '~~/core/sql-literals.ts'
import { markdownTable, uniqueNames } from '~~/core/values.ts'
import type { PinnedResult, QueryTab } from './tabs'

export function useResultExport(
  tab: QueryTab,
  shown: ComputedRef<ResultSet | undefined>,
  viewedPin: ComputedRef<PinnedResult | undefined>,
  grid: Readonly<ShallowRef<{ view(): { columns: ResultColumn[]; rows: CellValue[][] } } | null>>,
) {
  const { driverOf } = useConnections()
  const { exportResult } = useExecution()
  const { t, locale } = useI18n()
  const toast = useToast()

  const exportFormat = ref<ExportFormat>('csv')
  const exportScope = ref<'shown' | 'full'>('shown')
  // Target of INSERT statements (export, copy): the only table of the shown statement, else a placeholder.
  const insertTable = ref('')
  const insertBatch = ref(100)
  const shownSource = computed(() => viewedPin.value?.source ?? tab.source)
  const insertDialect = computed(() => sqlDialect(driverOf(shownSource.value?.connectionId)?.dialect ?? 'postgres'))
  const defaultInsertTable = computed(() => {
    const source = shownSource.value
    const statement = shown.value?.statement
    if (!source || !statement) return 'export_table'
    const refs = referencedTables(source.sql.slice(statement.from, statement.to), insertDialect.value)
    return refs.length === 1 ? [refs[0]!.schema, refs[0]!.name].filter(Boolean).join('.') : 'export_table'
  })
  watch(shown, () => (insertTable.value = defaultInsertTable.value), { immediate: true })
  const tableParts = (text: string) =>
    text
      .split('.')
      .map((p) => p.trim().replace(/^(["`[])(.*)["`\]]$/, '$2'))
      .filter(Boolean)
  const insertTarget = computed(() => ({
    dialect: insertDialect.value,
    table: tableParts(insertTable.value || defaultInsertTable.value),
  }))
  // The full result runs the statement of the shown result set again, which must not repeat side effects.
  const canExportFull = computed(() => {
    const source = viewedPin.value?.source ?? tab.source
    const statement = shown.value?.statement
    return (
      !!source &&
      !!statement &&
      isReadOnlyStatement(
        source.sql.slice(statement.from, statement.to),
        sqlDialect(driverOf(source.connectionId)?.dialect ?? 'postgres'),
      )
    )
  })
  const scopeItems = computed(() => [
    { label: t('query.shownRows', { n: shown.value?.rows.length.toLocaleString(locale.value) }), value: 'shown' },
    canExportFull.value
      ? { label: t('query.fullResult'), value: 'full' }
      : { label: t('query.fullResultSelectOnly'), value: 'full', disabled: true },
  ])
  watch(canExportFull, (ok) => {
    if (!ok) exportScope.value = 'shown'
  })

  // Without truncation the shown rows are the full result, so there is no need to run the statement again.
  async function download() {
    const table = tableParts(insertTable.value)
    if (exportFormat.value === 'insert' && !table.length) {
      toast.add({ title: t('errors.insertTableRequired'), color: 'error', icon: 'i-lucide-circle-alert' })
      return
    }
    try {
      const path = await exportResult(
        tab,
        exportFormat.value,
        exportScope.value === 'full' && canExportFull.value && !!shown.value?.truncated,
        viewedPin.value,
        { table, batchSize: insertBatch.value },
      )
      if (path)
        toast.add({ title: t('query.exportSaved'), description: path, color: 'success', icon: 'i-lucide-check' })
      else toast.add({ title: t('query.exportCancelled'), color: 'neutral', icon: 'i-lucide-square' })
    } catch (e) {
      toast.add({
        title: t('query.exportFailed'),
        description: errorMessage(e),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    }
  }

  // The rows as the grid shows them (sorted, filtered, visible columns).
  async function copyAs(kind: 'markdown' | 'json' | 'insert') {
    const view = grid.value?.view()
    if (!view) return
    const names = view.columns.map((c) => c.name)
    const keys = uniqueNames(names)
    const { rows } = view
    let text: string
    if (kind === 'markdown') text = markdownTable(names, rows)
    else if (kind === 'json') {
      text = JSON.stringify(
        rows.map((row) => Object.fromEntries(keys.map((k, i) => [k, row[i] ?? null]))),
        null,
        2,
      )
    } else {
      const { dialect, table } = insertTarget.value
      const columns = view.columns.map((c, i) => ({ name: keys[i]!, type: c.type }))
      const size = Math.min(insertBatch.value, maxInsertRows(dialect))
      const statements = []
      for (let i = 0; i < rows.length; i += size)
        statements.push(insertSql(dialect, table, columns, rows.slice(i, i + size)))
      text = statements.map((s) => `${s};`).join('\n\n')
    }
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('query.copied', { n: rows.length }, rows.length), color: 'success', icon: 'i-lucide-check' })
  }
  const copyItems = [
    { label: 'Markdown', onSelect: () => copyAs('markdown') },
    { label: 'JSON', onSelect: () => copyAs('json') },
    { label: 'SQL INSERT', onSelect: () => copyAs('insert') },
  ]

  return { exportFormat, exportScope, insertTable, insertBatch, insertTarget, scopeItems, download, copyItems }
}
