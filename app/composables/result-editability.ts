// Whether a query tab's current result can be edited in the grid, resolved from the schema (#60)
import type { ComputedRef } from 'vue'
import type { ResultSet } from '#core'
import type { EditBlock, EditTarget } from '~/utils/table-edit'
import type { PinnedResult, QueryTab } from './tabs'

export function useResultEditability(
  tab: QueryTab,
  currentSet: ComputedRef<ResultSet | undefined>,
  viewedPin: ComputedRef<PinnedResult | undefined>,
) {
  const { connectionOf } = useConnections()
  const { run, applyEdits } = useExecution()
  const { loadSchemas, loadTables, loadColumns, loadIndexes, keyOf, defaultSchema, state } = useSchema()
  const { t, locale } = useI18n()
  const toast = useToast()

  const edit = shallowRef<{ target: EditTarget } | { block: EditBlock; columns?: string[] }>()
  // The result belongs to the connection it ran on, even if the tab has switched since.
  const sourceConnection = computed(() => connectionOf(tab.source?.connectionId))
  watch([currentSet, viewedPin, () => tab.compare, sourceConnection], resolveEdit, { immediate: true })

  async function resolveEdit() {
    edit.value = undefined
    const set = currentSet.value
    const { source } = tab
    const conn = sourceConnection.value
    if (!set?.columns.length || viewedPin.value || tab.compare || !source || !conn) return
    const blocker = editBlocker(conn)
    if (blocker) return void (edit.value = { block: blocker })
    const st = set.statement
    const dialect = sqlDialect(conn.dialect)
    const ref = st && singleTableSource(source.sql.slice(st.from, st.to), dialect)
    if (!ref) return void (edit.value = { block: 'query' })
    const target = { connectionId: source.connectionId, database: source.database }
    const s = state(target)
    if (!s.schemas) await loadSchemas(target)
    const schema = ref.schema ?? defaultSchema(target)
    if (set !== currentSet.value) return
    if (!schema) return void (edit.value = { block: 'query' })
    if (!s.tables[schema]) await loadTables(target, schema)
    if (set !== currentSet.value) return
    const tables = s.tables[schema] ?? []
    const table =
      tables.find((x) => x.name === ref.name) ?? tables.find((x) => x.name.toLowerCase() === ref.name.toLowerCase())
    if (!table) return void (edit.value = { block: 'query' })
    if (table.kind !== 'table') return void (edit.value = { block: 'view' })
    await Promise.all([loadColumns(target, schema, table.name), loadIndexes(target, schema, table.name)])
    if (set !== currentSet.value) return
    const columns = s.columns[keyOf(schema, table.name)]
    const indexes = s.indexes[keyOf(schema, table.name)]
    edit.value =
      columns && indexes
        ? buildEditTarget(dialect, schema, table.name, set.columns, columns, indexes)
        : { block: 'query' }
  }

  async function saveEdits(statements: string[]) {
    const n = await applyEdits(tab, statements)
    toast.add({
      title: t('grid.saved', { n: n.toLocaleString(locale.value) }, n),
      color: 'success',
      icon: 'i-lucide-check',
    })
    const { source } = tab
    const st = currentSet.value?.statement
    if (source && st) run(tab, source.sql.slice(st.from, st.to), 0, (p) => p)
  }

  return { edit, sourceConnection, saveEdits }
}
