<script setup lang="ts">
import type { Dialect } from '#core'

/** One side of a compare: the connection and, below it, database, schema and table. */
export interface CompareSideValue {
  connectionId?: string
  database?: string
  schema?: string
  table?: string
}

const model = defineModel<CompareSideValue>({ required: true })
const props = defineProps<{ label: string; dialect?: Dialect; withTable?: boolean }>()

const { connections, driverOf } = useConnections()
const { state, loadDatabases, loadSchemas, loadTables, defaultSchema } = useSchema()
const { t } = useI18n()

const connection = computed(() => connections.value.find((c) => c.id === model.value.connectionId))
const capabilities = computed(() => driverOf(model.value.connectionId)?.capabilities)
const target = computed(() =>
  model.value.connectionId ? { connectionId: model.value.connectionId, database: model.value.database } : undefined,
)

const connectionItems = computed(() =>
  connections.value
    .filter((c) => !props.dialect || c.dialect === props.dialect)
    .map((c) => ({ label: c.name, value: c.id })),
)
const databaseItems = computed(() => {
  const names = model.value.connectionId
    ? (state({ connectionId: model.value.connectionId }).databases?.map((d) => d.name) ?? [])
    : []
  const fallback = connection.value?.database
  return fallback && !names.includes(fallback) ? [fallback, ...names] : names
})
const schemaItems = computed(() => (target.value ? state(target.value).schemas?.map((s) => s.name) : undefined) ?? [])
const tableItems = computed(() =>
  target.value && model.value.schema
    ? (state(target.value)
        .tables[model.value.schema]?.filter((t) => t.kind === 'table')
        .map((t) => t.name) ?? [])
    : [],
)

const set = (patch: CompareSideValue) => (model.value = { ...model.value, ...patch })
// The configured database is the default, like in the sidebar.
const selectDatabase = (name: string) =>
  set({ database: name === connection.value?.database ? undefined : name, schema: undefined, table: undefined })

watch(
  () => [model.value.connectionId, capabilities.value?.supportsDatabases] as const,
  ([id, supported]) => id && supported && loadDatabases(id),
  { immediate: true },
)
watch(
  target,
  async (t) => {
    if (!t) return
    await loadSchemas(t)
    const schema = defaultSchema(t)
    if (!model.value.schema && schema) set({ schema })
  },
  { immediate: true },
)
watch(
  () => [target.value, model.value.schema, props.withTable] as const,
  ([t, schema, withTable]) => t && schema && withTable && loadTables(t, schema),
  { immediate: true },
)
</script>

<template>
  <fieldset class="space-y-2">
    <legend class="mb-2 text-sm font-medium">{{ label }}</legend>
    <USelectMenu
      :model-value="model.connectionId"
      :items="connectionItems"
      value-key="value"
      :placeholder="t('compare.connection')"
      :aria-label="`${label}: ${t('compare.connection')}`"
      icon="i-lucide-server"
      class="w-full"
      @update:model-value="(id) => set({ connectionId: id, database: undefined, schema: undefined, table: undefined })"
    />
    <USelectMenu
      v-if="capabilities?.supportsDatabases"
      :model-value="model.database ?? connection?.database"
      :items="databaseItems"
      :placeholder="t('connection.defaultDatabase')"
      :aria-label="`${label}: ${t('compare.database')}`"
      icon="i-lucide-database"
      class="w-full"
      @update:model-value="selectDatabase"
    />
    <USelectMenu
      v-if="capabilities?.supportsSchemas"
      :model-value="model.schema"
      :items="schemaItems"
      :placeholder="t('compare.schema')"
      :aria-label="`${label}: ${t('compare.schema')}`"
      icon="i-lucide-folder"
      class="w-full"
      @update:model-value="(schema) => set({ schema, table: undefined })"
    />
    <USelectMenu
      v-if="withTable"
      :model-value="model.table"
      :items="tableItems"
      :placeholder="t('compare.table')"
      :aria-label="`${label}: ${t('compare.table')}`"
      icon="i-lucide-table"
      class="w-full"
      @update:model-value="(table) => set({ table })"
    />
  </fieldset>
</template>
