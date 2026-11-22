<script setup lang="ts">
import type { CellValue, DataCompareResult } from '#core'
import type { CompareSideValue } from './CompareSide.vue'

const emit = defineEmits<{ close: [] }>()

const { connections } = useConnections()
const { state, loadColumns } = useSchema()
const { t, n } = useI18n()
const toast = useToast()

const source = ref<CompareSideValue>({})
const target = ref<CompareSideValue>({})
const keys = ref<string[]>([])
const running = ref<string>()
const error = ref<string>()
const result = ref<DataCompareResult>()

const dialectOf = (side: CompareSideValue) => connections.value.find((c) => c.id === side.connectionId)?.dialect
const supported = computed(
  () => !source.value.connectionId || (dataCompareDialects as readonly string[]).includes(dialectOf(source.value)!),
)
const ready = computed(
  () => supported.value && !!(source.value.table && target.value.connectionId && target.value.table),
)

watch(
  () => dialectOf(source.value),
  (dialect) => {
    if (dialectOf(target.value) !== dialect) target.value = {}
  },
)

const sideTarget = (side: CompareSideValue) => ({ connectionId: side.connectionId!, database: side.database })
const columnsOf = (side: CompareSideValue) =>
  side.connectionId && side.schema && side.table
    ? state(sideTarget(side)).columns[JSON.stringify([side.schema, side.table])]
    : undefined
const sourceColumns = computed(() => columnsOf(source.value))
const targetColumns = computed(() => columnsOf(target.value))
const targetTables = computed(() =>
  target.value.connectionId && target.value.schema
    ? state(sideTarget(target.value)).tables[target.value.schema]
    : undefined,
)

// The key can be chosen among the columns both tables have.
const keyItems = computed(() =>
  (sourceColumns.value ?? [])
    .filter(
      (c) => !targetColumns.value || targetColumns.value.some((x) => x.name.toLowerCase() === c.name.toLowerCase()),
    )
    .map((c) => c.name),
)

// The primary key is the default key; the target table defaults to the name of the source table.
watch(
  () => [source.value.connectionId, source.value.database, source.value.schema, source.value.table] as const,
  async () => {
    result.value = undefined
    const { connectionId, schema, table } = source.value
    if (!connectionId || !schema || !table) return (keys.value = [])
    await loadColumns(sideTarget(source.value), schema, table)
    keys.value = sourceColumns.value?.filter((c) => c.primaryKey).map((c) => c.name) ?? []
  },
)
watch(
  () => [target.value.connectionId, target.value.database, target.value.schema, target.value.table] as const,
  async () => {
    const { connectionId, schema, table } = target.value
    if (connectionId && schema && table) await loadColumns(sideTarget(target.value), schema, table)
  },
)
watch([() => source.value.table, targetTables], ([table, tables]) => {
  if (table && !target.value.table && tables?.some((x) => x.name === table && x.kind === 'table')) {
    target.value = { ...target.value, table }
  }
})

const refOf = ({ connectionId, database, schema, table }: CompareSideValue) => ({
  connectionId,
  database,
  schema,
  table,
})

async function run(path?: string) {
  const id = crypto.randomUUID()
  running.value = id
  error.value = undefined
  result.value = undefined
  try {
    result.value = await api<DataCompareResult>('/api/compare/data', {
      method: 'POST',
      body: {
        id,
        source: refOf(source.value),
        target: refOf(target.value),
        keys: keys.value.length ? keys.value : undefined,
        path,
      },
    })
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    running.value = undefined
  }
}

const cancel = () => api(`/api/compare/${running.value}/cancel`, { method: 'POST' }).catch(() => {})

async function saveScript() {
  const path = await fileDialog('save', t('dialog.save'), `${target.value.table}-sync.sql`)
  if (!path) return
  await run(path)
  if (result.value) toast.add({ title: t('common.saved'), description: path, color: 'success', icon: 'i-lucide-check' })
}

const show = (v: CellValue | undefined) =>
  v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v)
const valueOf = (row: CellValue[], column: string) => show(row[result.value!.columns.indexOf(column)])
const capped = computed(() => Object.values(result.value?.counts ?? {}).some((c) => c > SAMPLE_LIMIT))
const samples = computed(() => {
  const r = result.value
  return r
    ? [
        { key: 'added', label: t('compare.added'), n: r.counts.onlyInSource, rows: r.samples.onlyInSource },
        { key: 'removed', label: t('compare.removed'), n: r.counts.onlyInTarget, rows: r.samples.onlyInTarget },
      ]
    : []
})
</script>

<template>
  <div class="space-y-4">
    <div class="grid gap-4 sm:grid-cols-2">
      <CompareSide v-model="source" :label="t('compare.source')" with-table />
      <CompareSide v-model="target" :label="t('compare.target')" :dialect="dialectOf(source)" with-table />
    </div>
    <UAlert
      v-if="!supported"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :description="t('compare.dataUnsupported')"
    />
    <UFormField v-if="keyItems.length" :label="t('compare.keys')">
      <USelectMenu v-model="keys" multiple :items="keyItems" :aria-label="t('compare.keys')" class="w-full" />
    </UFormField>
    <div class="flex gap-2">
      <UButton
        icon="i-lucide-git-compare"
        :label="running ? t('compare.running') : t('compare.run')"
        :loading="!!running"
        :disabled="!ready"
        @click="run()"
      />
      <UButton
        v-if="running"
        :label="t('common.cancel')"
        icon="i-lucide-square"
        color="neutral"
        variant="outline"
        @click="cancel"
      />
    </div>
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />

    <template v-if="result">
      <div class="flex flex-wrap gap-2 text-sm">
        <UBadge color="neutral" variant="subtle" :label="`${t('compare.same')}: ${n(result.counts.same)}`" />
        <UBadge color="success" variant="subtle" :label="`${t('compare.added')}: ${n(result.counts.onlyInSource)}`" />
        <UBadge color="error" variant="subtle" :label="`${t('compare.removed')}: ${n(result.counts.onlyInTarget)}`" />
        <UBadge color="warning" variant="subtle" :label="`${t('compare.changed')}: ${n(result.counts.different)}`" />
      </div>
      <p v-if="!result.statements" class="text-sm text-muted">{{ t('compare.noDifferences') }}</p>
      <UAlert
        v-if="result.ignored.source.length || result.ignored.target.length"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        :description="
          t('compare.ignored', {
            source: result.ignored.source.join(', ') || '–',
            target: result.ignored.target.join(', ') || '–',
          })
        "
      />

      <UCollapsible v-for="s in samples.filter((x) => x.n)" :key="s.key">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          trailing-icon="i-lucide-chevron-down"
          :label="`${s.label} (${n(s.n)})`"
        />
        <template #content>
          <div class="max-h-72 overflow-auto rounded border border-default">
            <table class="min-w-full font-mono text-xs">
              <thead class="sticky top-0 bg-elevated text-left">
                <tr>
                  <th v-for="c in result.columns" :key="c" class="px-2 py-1 font-medium">{{ c }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in s.rows" :key="i" class="border-t border-default">
                  <td
                    v-for="(v, j) in row"
                    :key="j"
                    class="px-2 py-1 whitespace-nowrap"
                    :class="v === null && 'text-muted'"
                  >
                    {{ show(v) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </UCollapsible>
      <UCollapsible v-if="result.counts.different">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          trailing-icon="i-lucide-chevron-down"
          :label="`${t('compare.changed')} (${n(result.counts.different)})`"
        />
        <template #content>
          <ul class="max-h-72 space-y-1 overflow-auto rounded border border-default p-2 font-mono text-xs">
            <li v-for="(d, i) in result.samples.different" :key="i">
              <span class="font-medium">{{ result.keys.map((k) => `${k} = ${valueOf(d.source, k)}`).join(', ') }}</span>
              <div v-for="c in d.changed" :key="c" class="pl-4">
                {{ c }}: <span class="text-error">{{ valueOf(d.source, c) }}</span> →
                <span class="text-success">{{ valueOf(d.target, c) }}</span>
              </div>
            </li>
          </ul>
        </template>
      </UCollapsible>
      <p v-if="capped" class="text-xs text-muted">{{ t('compare.samplesCapped', { n: n(SAMPLE_LIMIT) }) }}</p>

      <template v-if="result.statements">
        <CompareScript
          v-if="result.script !== null"
          :label="`${t('compare.syncScript')} · ${t('compare.statements', { n: n(result.statements) }, result.statements)}`"
          :script="result.script"
          :target="target"
          :title="target.table!"
          @opened="emit('close')"
        />
        <UAlert
          v-else
          color="warning"
          variant="subtle"
          icon="i-lucide-file-warning"
          :description="t('compare.scriptTooLarge', { n: n(result.statements) })"
        >
          <template #actions>
            <UButton color="warning" variant="outline" size="xs" :label="t('compare.saveScript')" @click="saveScript" />
          </template>
        </UAlert>
      </template>
    </template>
  </div>
</template>
