// Schema of a query tab's connection for the editor's autocomplete, preloaded for the tables the SQL refers to
import type { ComputedRef } from 'vue'
import type { DriverStatus } from '#core'
import type { QueryTab } from './tabs'

export function useEditorSchema(tab: QueryTab, driver: ComputedRef<DriverStatus | undefined>) {
  const { loadSchemas, loadTables, loadColumns, loadForeignKeys, keyOf, defaultSchema, schemaModel, state } =
    useSchema()

  const schemaTarget = computed(() =>
    tab.connectionId ? { connectionId: tab.connectionId, database: tab.database } : undefined,
  )
  const model = computed(() => schemaTarget.value && schemaModel(schemaTarget.value))

  // Autocomplete needs at least the tables of the default schema.
  watch(
    schemaTarget,
    async (t) => {
      if (!t) return
      if (!state(t).schemas) await loadSchemas(t)
      const schema = defaultSchema(t)
      if (schema && !state(t).tables[schema]) await loadTables(t, schema)
      preloadColumns()
    },
    { immediate: true },
  )

  // Columns are only known once loaded: load them for the tables the editor content refers to.
  let preloadTimer: ReturnType<typeof setTimeout> | undefined
  watch(
    () => tab.sql,
    () => {
      clearTimeout(preloadTimer)
      preloadTimer = setTimeout(preloadColumns, 400)
    },
  )
  onBeforeUnmount(() => clearTimeout(preloadTimer))

  async function preloadColumns() {
    const target = schemaTarget.value
    const dialect = driver.value && sqlDialect(driver.value.dialect)
    if (!target || !dialect) return
    const s = state(target)
    for (const ref of referencedTables(tab.sql, dialect).slice(0, 20)) {
      const schema = ref.schema ?? defaultSchema(target)
      if (!schema || !s.schemas?.some((x) => x.name === schema)) continue
      if (!s.tables[schema]) await loadTables(target, schema)
      // Unquoted names may differ in case from the catalog.
      const tables = s.tables[schema] ?? []
      const table =
        tables.find((t) => t.name === ref.name) ?? tables.find((t) => t.name.toLowerCase() === ref.name.toLowerCase())
      if (table && !s.columns[keyOf(schema, table.name)]) loadColumns(target, schema, table.name)
      // JOIN suggestions need the keys of the tables in the query.
      if (table && !s.foreignKeys[keyOf(schema, table.name)]) loadForeignKeys(target, schema, table.name)
    }
  }

  return { schemaTarget, model }
}
