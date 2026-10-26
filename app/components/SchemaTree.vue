<script setup lang="ts">
import type { ColumnInfo, Dialect } from '#core'

const props = defineProps<{ connectionId: string }>()

const { driverOf } = useWorkspace()
const { state, keyOf, loadSchemas, loadTables, loadColumns } = useSchema()
const { tabs, activeTabId, addTab, run } = useTabs()

const s = computed(() => state(props.connectionId))
const driver = computed(() => driverOf(props.connectionId))
const expanded = reactive(new Set<string>())

// Without a schema level (MySQL/MariaDB) and a single database, the tables are shown directly.
const flatSchema = computed(() => {
  const schemas = s.value.schemas ?? []
  return !driver.value?.capabilities.supportsSchemas && schemas.length === 1 ? schemas[0]!.name : undefined
})

watch(() => props.connectionId, (id) => {
  if (!state(id).schemas) loadSchemas(id)
}, { immediate: true })

watch(flatSchema, (schema) => {
  if (schema && !s.value.tables[schema]) loadTables(props.connectionId, schema)
}, { immediate: true })

function toggle(key: string, load: () => void) {
  if (expanded.has(key)) return expanded.delete(key)
  expanded.add(key)
  load()
}

function toggleSchema(schema: string) {
  toggle(keyOf(schema), () => s.value.tables[schema] ?? loadTables(props.connectionId, schema))
}

function toggleTable(schema: string, table: string) {
  toggle(keyOf(schema, table), () => s.value.columns[keyOf(schema, table)] ?? loadColumns(props.connectionId, schema, table))
}

function quoteIdent(dialect: Dialect, name: string) {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`
  return `"${name.replaceAll('"', '""')}"`
}

/** Appends a SELECT of all columns to the active tab (or a new one) and runs it with the tab's row limit. */
async function selectTable(schema: string, table: string) {
  const key = keyOf(schema, table)
  if (!s.value.columns[key]) await loadColumns(props.connectionId, schema, table)
  const cols = s.value.columns[key]
  if (!cols || !driver.value) return
  const q = (name: string) => quoteIdent(driver.value!.dialect, name)
  const { formatSql } = await import('~/utils/sql-format')
  const sql = formatSql(`select ${cols.map(c => q(c.name)).join(', ')} from ${q(schema)}.${q(table)};`, driver.value.dialect)
  let tab = tabs.value.find(t => t.id === activeTabId.value)
  if (!tab || tab.connectionId !== props.connectionId || tab.running || tab.exporting) tab = addTab(props.connectionId)
  const prev = tab.sql
  tab.sql = !prev.trim() ? sql : `${prev}${prev.trimEnd().endsWith(';') ? '' : ';'}\n\n${sql}`
  run(tab, sql)
}

function refresh() {
  expanded.clear()
  loadSchemas(props.connectionId, true)
}

function fkTitle(c: ColumnInfo) {
  return c.references ? `${c.references.schema}.${c.references.table}.${c.references.column}` : ''
}
</script>

<template>
  <div class="text-sm">
    <div class="flex items-center justify-between px-3 py-1">
      <span class="text-xs font-medium uppercase text-muted">Schema</span>
      <UButton icon="i-lucide-refresh-cw" size="xs" variant="ghost" color="neutral" :loading="s.loading.schemas" title="Neu laden" @click="refresh" />
    </div>
    <p v-if="s.errors.schemas" class="px-3 py-1 text-xs text-error">{{ s.errors.schemas }}</p>

    <template v-for="schema in s.schemas" :key="schema.name">
      <button
        v-if="!flatSchema"
        class="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-elevated"
        @click="toggleSchema(schema.name)"
      >
        <UIcon :name="expanded.has(keyOf(schema.name)) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 shrink-0 text-dimmed" />
        <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-muted" />
        <span class="truncate">{{ schema.name }}</span>
        <UIcon v-if="s.loading[keyOf(schema.name)]" name="i-lucide-loader-circle" class="size-3.5 animate-spin text-dimmed" />
      </button>

      <div v-if="flatSchema || expanded.has(keyOf(schema.name))" :class="flatSchema ? '' : 'pl-4'">
        <p v-if="s.errors[keyOf(schema.name)]" class="px-3 py-1 text-xs text-error">{{ s.errors[keyOf(schema.name)] }}</p>
        <template v-for="table in s.tables[schema.name]" :key="table.name">
          <button
            class="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-elevated"
            title="Doppelklick: alle Spalten abfragen"
            @click="toggleTable(schema.name, table.name)"
            @dblclick="selectTable(schema.name, table.name)"
          >
            <UIcon :name="expanded.has(keyOf(schema.name, table.name)) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 shrink-0 text-dimmed" />
            <UIcon :name="table.kind === 'view' ? 'i-lucide-eye' : 'i-lucide-table-2'" class="size-4 shrink-0 text-muted" />
            <span class="truncate">{{ table.name }}</span>
            <UIcon v-if="s.loading[keyOf(schema.name, table.name)]" name="i-lucide-loader-circle" class="size-3.5 animate-spin text-dimmed" />
          </button>

          <div v-if="expanded.has(keyOf(schema.name, table.name))" class="pl-9 pr-2">
            <p v-if="s.errors[keyOf(schema.name, table.name)]" class="py-1 text-xs text-error">{{ s.errors[keyOf(schema.name, table.name)] }}</p>
            <div
              v-for="col in s.columns[keyOf(schema.name, table.name)]"
              :key="col.name"
              class="flex items-center gap-1.5 py-0.5 text-xs"
            >
              <UIcon name="i-lucide-columns-3" class="size-3.5 shrink-0 text-dimmed" />
              <span class="max-w-[60%] shrink-0 truncate" :class="col.primaryKey ? 'font-semibold' : ''" :title="col.name">{{ col.name }}</span>
              <span class="min-w-0 truncate text-dimmed" :title="col.type">{{ col.type }}{{ col.nullable ? '' : ' not null' }}</span>
              <span class="ml-auto flex shrink-0 gap-1">
                <UBadge v-if="col.primaryKey" label="PK" size="sm" color="warning" variant="subtle" />
                <UBadge v-if="col.references" size="sm" color="info" variant="subtle" :title="`Fremdschlüssel → ${fkTitle(col)}`">
                  FK → {{ col.references.table }}
                </UBadge>
                <UBadge v-if="col.indexes.length" label="IDX" size="sm" color="neutral" variant="subtle" :title="col.indexes.join(', ')" />
              </span>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
