<script setup lang="ts">
import type { ForeignKeyInfo } from '#core'
import { buildErModel, type ErModel, layoutEr, tableKey, toDbml, toMermaid } from '~/utils/er-model'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ connectionId: string; database?: string; scope: { schema: string; table?: string } }>()

const { state, keyOf, loadTables, loadColumns, loadForeignKeys } = useSchema()
const toast = useToast()
const { t } = useI18n()

// Schemas with more tables than this are drawn from the tables that have relations.
const MAX_TABLES = 100
const KEYS_ONLY_FROM = 30

const target = computed(() => ({ connectionId: props.connectionId, database: props.database }))
// Double-clicking a table narrows the diagram to it.
const scope = ref(props.scope)
const model = ref<ErModel>()
const error = ref<string>()
const progress = ref<{ n: number; total: number }>()
const limited = ref<{ shown: number; total: number }>()
const keysOnly = ref(false)
const view = ref<'diagram' | 'mermaid' | 'dbml'>('diagram')
const diagram = useTemplateRef('diagram')

const focus = computed(() => scope.value.table && tableKey(scope.value.schema, scope.value.table))
const name = computed(() => (focus.value ? scope.value.table! : scope.value.schema))
const layout = computed(() => model.value && layoutEr(model.value, { keysOnly: keysOnly.value, focus: focus.value }))
const text = computed(() => (model.value ? (view.value === 'mermaid' ? toMermaid : toDbml)(model.value) : ''))
const tabs = computed(() => [
  { label: t('er.diagram'), value: 'diagram' },
  { label: 'Mermaid', value: 'mermaid' },
  { label: 'DBML', value: 'dbml' },
])

// Loads what the scope needs, one table at a time; a later call (another scope, closing) makes the running one stop.
let run = 0
async function load() {
  const id = ++run
  const { schema, table } = scope.value
  const s = state(target.value)
  model.value = error.value = limited.value = undefined
  const fail = (key: string) => (error.value = s.errors[key] ?? t('common.error'))
  const fkKey = keyOf(schema, table)
  if (!s.tables[schema]) await loadTables(target.value, schema)
  if (!s.tables[schema]) return fail(keyOf(schema))
  if (!s.foreignKeys[fkKey]) await loadForeignKeys(target.value, schema, table)
  if (!s.foreignKeys[fkKey]) return fail(keyOf(schema, table, 'foreignKeys'))
  const keys = s.foreignKeys[fkKey]
  const inSchema = (k: ForeignKeyInfo) => [k.schema === schema && k.table, k.refSchema === schema && k.refTable]

  let names: string[]
  if (table) {
    // The table and its neighbors of the same schema; those of other schemas stay stubs.
    names = [...new Set([table, ...keys.flatMap(inSchema).filter((n) => !!n)])] as string[]
  } else {
    const tables = s.tables[schema].filter((x) => x.kind === 'table')
    names = tables.map((x) => x.name)
    if (names.length > MAX_TABLES) {
      const relations = new Map<string, number>()
      for (const n of keys.flatMap(inSchema)) if (n) relations.set(n, (relations.get(n) ?? 0) + 1)
      names = names
        .filter((n) => relations.has(n))
        .sort((a, b) => relations.get(b)! - relations.get(a)! || (a < b ? -1 : 1))
        .slice(0, MAX_TABLES)
      limited.value = { shown: names.length, total: tables.length }
    }
  }
  for (const [i, n] of names.entries()) {
    progress.value = { n: i + 1, total: names.length }
    if (!s.columns[keyOf(schema, n)]) await loadColumns(target.value, schema, n)
    if (id !== run) return
    if (!s.columns[keyOf(schema, n)]) return fail(keyOf(schema, n))
  }
  progress.value = undefined
  if (id !== run) return
  model.value = buildErModel(
    names.map((n) => ({ schema, name: n, columns: s.columns[keyOf(schema, n)]! })),
    keys,
  )
  keysOnly.value = model.value.tables.length > KEYS_ONLY_FROM
}

watch(
  [open, scope],
  () => {
    if (open.value) load()
    else run++
  },
  { immediate: true },
)

function rescope(schema: string, table: string) {
  scope.value = { schema, table }
}

async function copy() {
  await navigator.clipboard.writeText(text.value)
  toast.add({ title: t('er.copied'), color: 'success', icon: 'i-lucide-check' })
}

async function save() {
  try {
    const ext = view.value === 'mermaid' ? 'mmd' : 'dbml'
    const path = await fileDialog(
      'save',
      t('dialog.save'),
      `${scope.value.schema}${scope.value.table ? `.${scope.value.table}` : ''}.${ext}`,
    )
    if (!path) return
    await api('/api/files/write', { method: 'POST', body: { path, sql: text.value } })
    toast.add({ title: t('common.saved'), description: path, color: 'success', icon: 'i-lucide-check' })
  } catch (e) {
    toast.add({
      title: t('er.saveFailed'),
      description: errorMessage(e),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    fullscreen
    :title="t('er.title')"
    :description="focus ? t('er.tableScope', { name }) : t('er.schemaScope', { name })"
    :ui="{ body: 'flex min-h-0 flex-col gap-3 overflow-hidden' }"
  >
    <template #body>
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />
      <p v-else-if="progress" role="status" class="text-sm text-muted">
        {{ t('er.loadingColumns', progress) }}
      </p>
      <p v-else-if="model && !model.tables.length" class="text-sm text-muted">{{ t('er.empty') }}</p>
      <template v-else-if="model && layout">
        <div class="flex flex-wrap items-center gap-3" data-tour="er-toolbar">
          <UTabs v-model="view" :items="tabs" :content="false" size="sm" class="w-auto" />
          <template v-if="view === 'diagram'">
            <USwitch v-model="keysOnly" :label="t('er.keysOnly')" size="sm" />
            <UFieldGroup size="sm">
              <UButton
                icon="i-lucide-zoom-out"
                color="neutral"
                variant="outline"
                :title="t('er.zoomOut')"
                :aria-label="t('er.zoomOut')"
                @click="diagram?.zoomOut()"
              />
              <UButton
                icon="i-lucide-zoom-in"
                color="neutral"
                variant="outline"
                :title="t('er.zoomIn')"
                :aria-label="t('er.zoomIn')"
                @click="diagram?.zoomIn()"
              />
              <UButton
                icon="i-lucide-maximize"
                color="neutral"
                variant="outline"
                :title="t('er.fit')"
                :aria-label="t('er.fit')"
                @click="diagram?.fit()"
              />
            </UFieldGroup>
            <span v-if="limited" class="text-xs text-muted">{{ t('er.limited', limited) }}</span>
          </template>
          <UFieldGroup v-else size="sm">
            <UButton icon="i-lucide-copy" color="neutral" variant="outline" :label="t('common.copy')" @click="copy" />
            <UButton icon="i-lucide-save" color="neutral" variant="outline" :label="t('dialog.save')" @click="save" />
          </UFieldGroup>
        </div>
        <div
          v-if="view === 'diagram'"
          class="min-h-0 flex-1 overflow-hidden rounded-md border border-default"
          data-tour="er-diagram"
        >
          <ErDiagram ref="diagram" :layout="layout" :label="t('er.label', { name })" @open="rescope" />
        </div>
        <pre
          v-else
          class="min-h-0 flex-1 overflow-auto rounded-md border border-default p-3 text-xs"
          style="font-family: var(--font-mono)"
          tabindex="0"
          >{{ text }}</pre>
      </template>
    </template>
  </UModal>
</template>
