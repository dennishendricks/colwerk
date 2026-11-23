<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- `tab` is the shared reactive object from useTabs(), edited in place on purpose. */
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { CellValue, ResultColumn } from '#core'
import type { QueryTab } from '~/composables/tabs'

const props = defineProps<{ tab: QueryTab }>()
const emit = defineEmits<{ newConnection: []; importConnections: [] }>()

const { driverOf, connectionOf } = useConnections()
const { activeTabId } = useTabs()
const { run, cancel } = useExecution()
const { defaultSchema, completionSchema } = useSchema()
const { names: lintNames, writes: lintWrites } = useLintSettings()
const { settings } = useSettings()
const { t, locale } = useI18n()
const toast = useToast()

const editor = useTemplateRef('editor')
const driver = computed(() => driverOf(props.tab.connectionId))
const connection = computed(() => connectionOf(props.tab.connectionId))
const { schemaTarget, model } = useEditorSchema(props.tab, driver)

const {
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
} = useQueryRun(props.tab, editor, connection)

async function copyPlan() {
  await navigator.clipboard.writeText(props.tab.plan?.text ?? '')
  toast.add({ title: t('query.planCopied'), color: 'success', icon: 'i-lucide-check' })
}

const { currentSet, pinView, viewedPin, shown, canPin, resultItems, pinResult, closePin, selectResult } =
  usePinnedResults(props.tab)
const showSwitcher = computed(
  () =>
    !busy.value &&
    !props.tab.error &&
    !props.tab.plan &&
    (resultItems.value.length > 1 || !!props.tab.pinned?.length || canPin.value),
)

const { edit, sourceConnection, saveEdits } = useResultEditability(props.tab, currentSet, viewedPin)

const grid = useTemplateRef<{ filteredCount?: number; view(): { columns: ResultColumn[]; rows: CellValue[][] } }>(
  'grid',
)
const { exportFormat, exportScope, insertTable, insertBatch, insertTarget, scopeItems, download, copyItems } =
  useResultExport(props.tab, shown, viewedPin, grid)

// The whole editor content. Focus goes back to the editor so that ⌘Z undoes the formatting
// (on the button, WebKit's native undo would act on the editor's DOM instead).
async function format() {
  try {
    const { formatSql } = await import('~/utils/sql-format')
    props.tab.sql = formatSql(props.tab.sql, sqlDialect(driver.value?.dialect ?? 'postgres'), settings.value.sqlFormat)
    editor.value?.focus()
  } catch (e) {
    toast.add({
      title: t('query.formatFailed'),
      description: errorMessage(e),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}

const busy = computed(() => props.tab.running || !!props.tab.exporting)

// Every open tab keeps its panel mounted, so the shortcuts only apply to the visible one.
const active = computed(() => props.tab.id === activeTabId.value)
defineShortcuts(computed(() => (active.value ? { meta_shift_f: { usingInput: true, handler: format } } : {})))
// Application menu (desktop app); app.vue builds the menu and enables the items.
defineMenuHandlers(() =>
  active.value
    ? {
        run: execute,
        explain: () => showPlan(),
        cancel: () => cancel(props.tab),
        format: format,
        commit: () => run(props.tab, 'COMMIT'),
        rollback: () => run(props.tab, 'ROLLBACK'),
        export: download,
      }
    : {},
)

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

const filterInput = useTemplateRef<{ inputRef?: HTMLInputElement }>('filterInput')
const filter = ref('')

// ⌘F with focus in the result area searches its values via the quick filter. The editor has its own
// search, so the shortcut is not global.
function onResultKeydown(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 'f' || !(macOS.value ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey) return
  const input = filterInput.value?.inputRef
  if (!input) return
  e.preventDefault()
  input.focus()
  input.select()
}
// The grid resets it itself, but not when a new result mounts a fresh grid (other result index).
watch(
  () => props.tab.result,
  () => (filter.value = ''),
)

const status = computed(() => {
  const { plan } = props.tab
  if (plan?.file) return `${t('query.plan')} · ${plan.file}`
  if (plan) return `${t('query.plan')} · ${formatDuration(plan.durationMs)} · ${formatClock(plan.executedAt)}`
  const pin = viewedPin.value
  const r = props.tab.result
  if (!r && !pin) return ''
  const time = pin
    ? `${t('query.pinned')} · ${formatDuration(pin.durationMs)} · ${formatClock(pin.executedAt)}`
    : `${formatDuration(r!.durationMs)} · ${formatClock(props.tab.executedAt ?? Date.now())}`
  const set = shown.value
  if (!set) {
    return `${t(
      'common.rowsAffected',
      { n: (r?.affectedRows ?? 0).toLocaleString(locale.value) },
      r?.affectedRows ?? 0,
    )} · ${time}`
  }
  const filtered = grid.value?.filteredCount
  const n = (value: number) => value.toLocaleString(locale.value)
  const rows =
    filtered === undefined
      ? n(set.rows.length)
      : t('query.filteredOf', { filtered: n(filtered), rows: n(set.rows.length) })
  return `${t('common.rows', { n: rows }, set.rows.length)}${
    set.truncated ? ` – ${t('query.truncated', { limit: n(set.rows.length) })}` : ''
  } · ${time}`
})
</script>

<template>
  <!-- Container queries: the panel width depends on the sidebar, not only on the viewport. -->
  <div class="@container flex h-full flex-col">
    <QueryToolbar
      :tab="tab"
      :connection="connection"
      :driver="driver"
      :checking="checking"
      :busy="busy"
      :can-dry-run="canDryRun"
      @execute="execute"
      @explain="showPlan"
      @dry-run="dryRunEditor"
      @format="format"
    />

    <SplitterGroup direction="vertical" auto-save-id="colwerk-query-panel" class="min-h-0 flex-1">
      <SplitterPanel :default-size="40" :min-size="10" class="overflow-hidden">
        <LazySqlEditor
          ref="editor"
          v-model="tab.sql"
          :dialect="driver?.dialect"
          :schema="schemaTarget ? completionSchema(schemaTarget) : {}"
          :default-schema="schemaTarget ? defaultSchema(schemaTarget) : undefined"
          :schema-model="model"
          :lint="{ names: lintNames, writes: lintWrites }"
          :error-at="tab.errorAt"
          @run="execute"
          @explain="showPlan()"
        />
      </SplitterPanel>
      <SplitterResizeHandle class="h-px bg-(--ui-border) data-[state=drag]:bg-primary data-[state=hover]:bg-primary" />

      <SplitterPanel :min-size="15" class="flex flex-col">
        <div class="flex items-center gap-2 border-b border-default px-3 py-1.5 text-xs text-muted">
          <!-- Announced by screen readers, so running a query (⌘Enter) gets feedback without looking. -->
          <span role="status" class="flex min-w-0 items-center gap-2">
            <UIcon v-if="busy" name="i-lucide-loader-circle" class="animate-spin" />
            <span v-if="tab.running">{{ t('query.running') }}</span>
            <span v-else-if="tab.exporting">{{ t('query.exporting') }}</span>
            <span v-else-if="tab.error" class="text-error">{{ t('common.error') }}</span>
            <span v-else class="truncate" :title="status">{{ status || t('query.notRun') }}</span>
          </span>
          <ResultSwitcher
            v-if="showSwitcher"
            :tab="tab"
            :items="resultItems"
            :viewed-pin="viewedPin"
            :pin-view="pinView"
            :can-pin="canPin"
            :can-compare="!!currentSet?.columns.length"
            @select="selectResult"
            @pin="pinResult"
            @close="closePin"
          />
          <!-- Pushed to the right edge itself only without result buttons: two auto margins would split the space. -->
          <UInput
            v-if="!tab.error && shown?.columns.length"
            ref="filterInput"
            v-model="filter"
            :placeholder="t('query.filter')"
            :aria-label="t('query.filter')"
            icon="i-lucide-search"
            size="xs"
            class="-my-1 w-56 min-w-32"
            :class="showSwitcher ? '' : 'ml-auto'"
          >
            <template v-if="filter" #trailing>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="link"
                size="xs"
                class="-me-1"
                :title="t('query.clearFilter')"
                :aria-label="t('query.clearFilter')"
                @click="filter = ''"
              />
            </template>
          </UInput>
          <UButton
            v-if="!busy && !tab.error && tab.plan"
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            :label="t('common.copy')"
            class="ml-auto"
            @click="copyPlan"
          />
        </div>
        <!-- Focusable so that a click into the grid moves the focus here and ⌘F reaches the handler. -->
        <div class="min-h-0 flex-1 overflow-hidden outline-none" tabindex="-1" @keydown="onResultKeydown">
          <UAlert
            v-if="tab.error"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="tab.error"
            class="m-3 w-auto whitespace-pre-wrap font-mono"
          />
          <LazyPlanView v-else-if="tab.plan?.format === 'showplan'" :xml="tab.plan.text" />
          <pre v-else-if="tab.plan" class="h-full overflow-auto p-3 font-mono text-xs">{{ tab.plan.text }}</pre>
          <!-- Both grids share the quick filter; the row count in the status is the current result's. -->
          <SplitterGroup v-else-if="tab.compare && pinView" direction="horizontal" class="h-full">
            <SplitterPanel :min-size="10" class="overflow-hidden">
              <LazyResultGrid
                :key="pinView.id"
                v-model:filter="filter"
                :result="pinView.set"
                :insert-target="insertTarget"
              />
            </SplitterPanel>
            <SplitterResizeHandle
              class="w-px bg-(--ui-border) data-[state=drag]:bg-primary data-[state=hover]:bg-primary"
            />
            <SplitterPanel :min-size="10" class="overflow-hidden">
              <LazyResultGrid
                v-if="currentSet?.columns.length"
                ref="grid"
                :key="tab.resultIndex"
                v-model:filter="filter"
                :result="currentSet"
                :insert-target="insertTarget"
              />
            </SplitterPanel>
          </SplitterGroup>
          <LazyResultGrid
            v-else-if="shown?.columns.length"
            ref="grid"
            :key="viewedPin?.id ?? tab.resultIndex"
            v-model:filter="filter"
            :result="shown"
            :edit="
              edit && 'target' in edit && !viewedPin
                ? {
                    target: edit.target,
                    confirm: !!sourceConnection?.confirmWrites,
                    connection: sourceConnection?.name ?? '',
                    save: saveEdits,
                  }
                : undefined
            "
            :insert-target="insertTarget"
          />
          <EmptyState
            v-else-if="!busy && !tab.sql.trim()"
            :connection-id="tab.connectionId"
            :database="tab.database"
            @new-connection="emit('newConnection')"
            @import-connections="emit('importConnections')"
            @select="
              (e) => {
                tab.sql = e.sql
                tab.connectionId ??= e.connectionId
              }
            "
          />
        </div>
        <ResultExportBar
          v-if="!tab.error && shown?.columns.length"
          v-model:format="exportFormat"
          v-model:scope="exportScope"
          v-model:table="insertTable"
          v-model:batch="insertBatch"
          :tab="tab"
          :truncated="shown.truncated"
          :scope-items="scopeItems"
          :copy-items="copyItems"
          :read-only="edit && 'block' in edit ? edit : undefined"
          @download="download"
        />
      </SplitterPanel>
    </SplitterGroup>

    <QueryRunModals
      v-model:unfiltered="pendingUnfiltered"
      v-model:pending="pending"
      v-model:plan-warning="planWarning"
      :connection="connection?.name"
      :running="tab.running"
      :dry-run="pendingDryRun"
      :can-dry-run="canDryRun && !!pending && isDml(pending.sql)"
      :dry-run-title="dryRunTitle"
      @confirm-unfiltered="confirmUnfiltered"
      @confirm-run="confirmRun"
      @dry-run="dryRunPending"
      @run-warned="runWarned"
      @show-plan="showWarnedPlan"
    />
    <VariablesModal :tab-id="tab.id" />
  </div>
</template>
