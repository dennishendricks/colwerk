<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- `tab` is the shared reactive object from useTabs(), edited in place on purpose. */
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { Dialect } from '#core'
import type { QueryTab } from '~/composables/workspace'

const props = defineProps<{ tab: QueryTab }>()

const { connections, driverOf } = useWorkspace()
const { activeTabId, run, explain, cancel, exportResult } = useTabs()
const { loadSchemas, loadTables, loadColumns, keyOf, defaultSchema, completionSchema, state } = useSchema()

const editor = useTemplateRef('editor')
const driver = computed(() => driverOf(props.tab.connectionId))
const connectionItems = computed(() => connections.value.map(c => ({ label: c.name, value: c.id })))
const connection = computed(() => connections.value.find(c => c.id === props.tab.connectionId))

// Autocomplete needs at least the tables of the default schema.
watch(() => props.tab.connectionId, async (id) => {
  if (!id) return
  if (!state(id).schemas) await loadSchemas(id)
  const schema = defaultSchema(id)
  if (schema && !state(id).tables[schema]) await loadTables(id, schema)
  preloadColumns()
}, { immediate: true })

// Columns are only known once loaded: load them for the tables the editor content refers to.
let preloadTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.tab.sql, () => {
  clearTimeout(preloadTimer)
  preloadTimer = setTimeout(preloadColumns, 400)
})
onBeforeUnmount(() => clearTimeout(preloadTimer))

async function preloadColumns() {
  const id = props.tab.connectionId
  const dialect = driver.value?.dialect
  if (!id || !dialect) return
  const s = state(id)
  for (const ref of referencedTables(props.tab.sql, dialect).slice(0, 20)) {
    const schema = ref.schema ?? defaultSchema(id)
    if (!schema || !s.schemas?.some(x => x.name === schema)) continue
    if (!s.tables[schema]) await loadTables(id, schema)
    // Unquoted names may differ in case from the catalog.
    const tables = s.tables[schema] ?? []
    const table = tables.find(t => t.name === ref.name) ?? tables.find(t => t.name.toLowerCase() === ref.name.toLowerCase())
    if (table && !s.columns[keyOf(schema, table.name)]) loadColumns(id, schema, table.name)
  }
}

// SQL that waits for confirmation because the connection asks before writes.
const pending = ref<{ sql: string, from: number }>()

function execute() {
  const runnable = editor.value?.runnableSql() ?? { sql: '', from: 0 }
  if (connection.value?.confirmWrites && mayWrite(runnable.sql, connection.value.dialect)) pending.value = runnable
  else run(props.tab, runnable.sql, runnable.from)
}

function confirmRun() {
  if (pending.value) run(props.tab, pending.value.sql, pending.value.from)
  pending.value = undefined
}

// isReadOnlyStatement is false for any script with several statements, so check them one by one:
// a script of SELECTs runs without asking, a single write in it asks.
function mayWrite(sql: string, dialect: Dialect) {
  return splitStatements(sql, dialect).some(r => !isReadOnlyStatement(sql.slice(r.from, r.to), dialect))
}

function showPlan(analyze = false) {
  explain(props.tab, editor.value?.runnableSql().sql ?? '', analyze)
}

// SQL Server has no plan with runtime statistics without executing the statement as usual.
const planItems = computed(() => [
  { label: 'Plan', icon: 'i-lucide-list-tree', onSelect: () => showPlan() },
  ...driver.value?.dialect === 'mssql'
    ? []
    : [{ label: 'Analyze', icon: 'i-lucide-gauge', onSelect: () => showPlan(true) }],
])

async function copyPlan() {
  await navigator.clipboard.writeText(props.tab.plan?.text ?? '')
  toast.add({ title: 'Ausführungsplan kopiert', color: 'success', icon: 'i-lucide-check' })
}

const shown = computed(() => props.tab.result?.resultSets[props.tab.resultIndex])
const resultItems = computed(() => props.tab.result?.resultSets.map((_, i) => ({ label: `Ergebnis ${i + 1}`, value: i })) ?? [])

const toast = useToast()
const exportFormat = ref<'csv' | 'parquet'>('csv')
const exportScope = ref<'shown' | 'full'>('shown')
const formatItems = [{ label: 'CSV', value: 'csv' }, { label: 'Parquet', value: 'parquet' }]
// The full result runs the statement again, which must not repeat side effects.
const canExportFull = computed(() => {
  const source = props.tab.source
  return !!source && isReadOnlyStatement(source.sql, driverOf(source.connectionId)?.dialect ?? 'postgres')
})
const scopeItems = computed(() => [
  { label: `Angezeigte Zeilen (${shown.value?.rows.length.toLocaleString('de-DE')})`, value: 'shown' },
  canExportFull.value
    ? { label: 'Gesamtes Ergebnis (ohne Limit)', value: 'full' }
    : { label: 'Gesamtes Ergebnis (nur bei einzelnem SELECT)', value: 'full', disabled: true },
])
watch(canExportFull, (ok) => {
  if (!ok) exportScope.value = 'shown'
})

// Without truncation the shown rows are the full result, so there is no need to run the statement again.
async function download() {
  try {
    const path = await exportResult(props.tab, exportFormat.value, exportScope.value === 'full' && canExportFull.value && !!shown.value?.truncated)
    if (path) toast.add({ title: 'Export gespeichert', description: path, color: 'success', icon: 'i-lucide-check' })
    else toast.add({ title: 'Export abgebrochen', color: 'neutral', icon: 'i-lucide-square' })
  } catch (e) {
    toast.add({ title: 'Export fehlgeschlagen', description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

// The whole editor content. Focus goes back to the editor so that ⌘Z undoes the formatting
// (on the button, WebKit's native undo would act on the editor's DOM instead).
async function format() {
  try {
    const { formatSql } = await import('~/utils/sql-format')
    props.tab.sql = formatSql(props.tab.sql, driver.value?.dialect ?? 'postgres')
    editor.value?.focus()
  } catch (e) {
    toast.add({ title: 'Formatieren fehlgeschlagen', description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

const busy = computed(() => props.tab.running || !!props.tab.exporting)

// Every open tab keeps its panel mounted, so the shortcuts only apply to the visible one.
const active = computed(() => props.tab.id === activeTabId.value)
defineShortcuts(computed(() => active.value ? { meta_shift_f: { usingInput: true, handler: format } } : {}))

// Ctrl+C cancels like in a terminal. On macOS the key has no other use; elsewhere it is copy, so it
// only cancels when nothing is selected that it would copy.
const { macOS } = useKbd()
function onKeydown(e: KeyboardEvent) {
  if (!active.value || !busy.value || !driver.value?.capabilities.supportsCancel) return
  if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'c') return
  if (!macOS.value && (editor.value?.hasSelection() || !window.getSelection()?.isCollapsed)) return
  e.preventDefault()
  cancel(props.tab)
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const grid = useTemplateRef<{ filteredCount?: number }>('grid')
const filter = ref('')
// The grid resets it itself, but not when a new result mounts a fresh grid (other result index).
watch(() => props.tab.result, () => (filter.value = ''))

const formatTime = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`

// Another connection needs another session; closing the old one rolls back its open transaction, so confirm first.
const pendingConnection = ref<string>()

function selectConnection(id: string) {
  if (props.tab.transaction) pendingConnection.value = id
  else props.tab.connectionId = id
}

async function confirmConnection() {
  props.tab.connectionId = pendingConnection.value
  props.tab.transaction = undefined
  pendingConnection.value = undefined
  await api(`/api/tabs/${props.tab.id}`, { method: 'DELETE' }).catch(() => {})
}

const status = computed(() => {
  if (props.tab.plan) return `Ausführungsplan · ${formatTime(props.tab.plan.durationMs)}`
  const r = props.tab.result
  if (!r) return ''
  const time = formatTime(r.durationMs)
  const set = shown.value
  if (!set) return `${r.affectedRows ?? 0} Zeile(n) betroffen · ${time}`
  const filtered = grid.value?.filteredCount
  return `${filtered === undefined ? '' : `${filtered.toLocaleString('de-DE')} von `}${set.rows.length.toLocaleString('de-DE')} Zeile(n)${set.truncated ? ` – auf Limit ${props.tab.rowLimit.toLocaleString('de-DE')} gekürzt` : ''} · ${time}`
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div
      class="flex items-center gap-2 border-b border-default px-3 py-2"
      :class="connection?.color && ['border-l-4', connectionColorClasses[connection.color].borderLeft]"
    >
      <USelect
        :model-value="tab.connectionId"
        :items="connectionItems"
        placeholder="Verbindung wählen"
        icon="i-lucide-database"
        size="sm"
        class="w-56"
        @update:model-value="selectConnection"
      />
      <UFieldGroup size="sm">
        <UButton
          icon="i-lucide-play"
          label="Ausführen"
          :loading="tab.running"
          :disabled="!tab.connectionId || !!tab.exporting"
          @click="execute"
        />
        <UDropdownMenu :items="planItems">
          <UButton icon="i-lucide-chevron-down" aria-label="Weitere Optionen" :disabled="!tab.connectionId || busy" />
        </UDropdownMenu>
      </UFieldGroup>
      <UButton
        v-if="driver?.capabilities.supportsCancel"
        icon="i-lucide-square"
        size="sm"
        :color="busy ? 'error' : 'neutral'"
        variant="soft"
        label="Abbrechen"
        :disabled="!busy || tab.exporting === 'cancelled'"
        @click="cancel(tab)"
      />
      <UButton
        icon="i-lucide-wand-sparkles"
        size="sm"
        color="neutral"
        variant="ghost"
        label="Formatieren"
        :disabled="!tab.sql.trim()"
        @click="format"
      />
      <template v-if="tab.transaction">
        <UBadge
          :label="tab.transaction === 'failed' ? 'Transaktion fehlgeschlagen' : 'Transaktion offen'"
          :color="tab.transaction === 'failed' ? 'error' : 'warning'"
          variant="subtle"
          icon="i-lucide-triangle-alert"
        />
        <!-- A failed transaction can only be rolled back (Postgres turns COMMIT into ROLLBACK). -->
        <UButton v-if="tab.transaction === 'open'" size="sm" color="neutral" variant="soft" label="Commit" :disabled="busy" @click="run(tab, 'COMMIT')" />
        <UButton size="sm" color="neutral" variant="soft" label="Rollback" :disabled="busy" @click="run(tab, 'ROLLBACK')" />
      </template>
      <div class="ml-auto flex items-center gap-2 text-sm text-muted">
        <span>Limit</span>
        <UInputNumber v-model="tab.rowLimit" :min="1" :max="100000" :step="100" :step-snapping="false" size="sm" class="w-32" />
        <span>Timeout (s)</span>
        <UInputNumber v-model="tab.timeout" :min="1" :max="86400" :step="10" :step-snapping="false" size="sm" class="w-28" />
      </div>
    </div>

    <SplitterGroup direction="vertical" auto-save-id="dbm-query-panel" class="min-h-0 flex-1">
      <SplitterPanel :default-size="40" :min-size="10" class="overflow-hidden">
        <LazySqlEditor
          ref="editor"
          v-model="tab.sql"
          :dialect="driver?.dialect"
          :schema="tab.connectionId ? completionSchema(tab.connectionId) : {}"
          :default-schema="tab.connectionId ? defaultSchema(tab.connectionId) : undefined"
          :error-at="tab.errorAt"
          @run="execute"
          @explain="showPlan()"
        />
      </SplitterPanel>
      <SplitterResizeHandle class="h-px bg-(--ui-border) data-[state=drag]:bg-primary data-[state=hover]:bg-primary" />

      <SplitterPanel :min-size="15" class="flex flex-col">
        <div class="flex items-center gap-2 border-b border-default px-3 py-1.5 text-xs text-muted">
          <UIcon v-if="busy" name="i-lucide-loader-circle" class="animate-spin" />
          <span v-if="tab.running">Läuft …</span>
          <span v-else-if="tab.exporting">Export läuft …</span>
          <span v-else-if="tab.error" class="text-error">Fehler</span>
          <span v-else>{{ status || 'Noch nicht ausgeführt' }}</span>
          <span v-if="!busy && !tab.error && resultItems.length > 1" class="ml-auto flex gap-1">
            <UButton
              v-for="item in resultItems"
              :key="item.value"
              :label="item.label"
              size="xs"
              color="neutral"
              :variant="item.value === tab.resultIndex ? 'soft' : 'ghost'"
              @click="tab.resultIndex = item.value"
            />
          </span>
          <!-- Pushed to the right edge itself only without result buttons: two auto margins would split the space. -->
          <UInput
            v-if="!tab.error && shown?.columns.length"
            v-model="filter"
            placeholder="Ergebnis filtern …"
            icon="i-lucide-search"
            size="xs"
            class="-my-1 w-56"
            :class="!busy && resultItems.length > 1 ? '' : 'ml-auto'"
          >
            <template v-if="filter" #trailing>
              <UButton icon="i-lucide-x" color="neutral" variant="link" size="xs" class="-me-1" title="Filter leeren" @click="filter = ''" />
            </template>
          </UInput>
          <UButton
            v-if="!busy && !tab.error && tab.plan"
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            label="Kopieren"
            class="ml-auto"
            @click="copyPlan"
          />
        </div>
        <div class="min-h-0 flex-1 overflow-hidden">
          <UAlert
            v-if="tab.error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="tab.error"
            class="m-3 w-auto whitespace-pre-wrap font-mono"
          />
          <pre v-else-if="tab.plan" class="h-full overflow-auto p-3 font-mono text-xs">{{ tab.plan.text }}</pre>
          <LazyResultGrid v-else-if="shown?.columns.length" ref="grid" :key="tab.resultIndex" v-model:filter="filter" :result="shown" />
        </div>
        <div v-if="!tab.error && shown?.columns.length" class="flex items-center gap-2 border-t border-default px-3 py-1.5 text-xs text-muted">
          <span>Export</span>
          <USelect v-model="exportFormat" :items="formatItems" size="xs" class="w-28" />
          <USelect v-if="shown.truncated" v-model="exportScope" :items="scopeItems" size="xs" class="w-72" />
          <UButton icon="i-lucide-download" size="xs" variant="soft" label="Speichern unter …" :loading="!!tab.exporting" :disabled="tab.running" @click="download" />
        </div>
      </SplitterPanel>
    </SplitterGroup>

    <UModal
      :open="pending !== undefined"
      title="Schreibende Anweisung ausführen?"
      :description="`Die Abfrage kann Daten oder Strukturen in „${connection?.name}“ ändern.`"
      :close="false"
      @update:open="v => !v && (pending = undefined)"
    >
      <template #body>
        <pre class="max-h-64 overflow-auto rounded bg-elevated p-3 font-mono text-xs">{{ pending?.sql }}</pre>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Abbrechen" color="neutral" variant="ghost" @click="pending = undefined" />
          <UButton label="Ausführen" color="error" @click="confirmRun" />
        </div>
      </template>
    </UModal>

    <UModal
      :open="!!pendingConnection"
      title="Verbindung wechseln?"
      description="Die offene Transaktion dieses Tabs wird dabei zurückgerollt."
      :close="false"
      @update:open="v => !v && (pendingConnection = undefined)"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Abbrechen" color="neutral" variant="ghost" @click="pendingConnection = undefined" />
          <UButton label="Wechseln" color="error" @click="confirmConnection" />
        </div>
      </template>
    </UModal>
  </div>
</template>
