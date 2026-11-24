<script setup lang="ts">
import type { TableRow } from '@nuxt/ui'
import type { CellValue, ResultColumn, ResultSet } from '#core'
import { insertSql } from '~~/core/sql-literals.ts'
import { csvLine, markdownRow } from '~~/core/values.ts'
import type { GridEdit } from '~/composables/grid-edits'
import type { GridColumn as Column, GridRow as Row } from '~/utils/grid-cells'
import type { SplitDialect } from '~/utils/sql-split'

// `insertTarget`: dialect and table of the row menu's INSERT statement; without it the item is disabled.
const props = defineProps<{
  result: ResultSet
  insertTarget?: { dialect: SplitDialect; table: string[] }
  /** Set when the result can be edited (see QueryPanel); `save` runs the reviewed statements. */
  edit?: GridEdit
}>()
// Text of the quick filter, whose input lives in the caller's status bar.
const filter = defineModel<string>('filter', { default: '' })
const { t, locale } = useI18n()
// Separator and quoting of the CSV copy as chosen in the settings dialog.
const { settings } = useSettings()

// Pending edits (#60): nothing is written until "Save".
const edits = useGridEdits(
  () => props.result,
  () => props.edit?.target,
)
const { changes, changeCount, resetChanges, currentValue, setValue, addRow, rowActions } = edits

const resultRows = computed<Row[]>(() => props.result.rows.map((cells, index) => ({ index, cells })))
// New rows follow the result rows; DEFAULT is NULL for sorting.
const data = computed<Row[]>(() =>
  changes.inserted.length
    ? [
        ...resultRows.value,
        ...changes.inserted.map((values, i) => ({
          index: props.result.rows.length + i,
          cells: values.map((v) => ('value' in v ? v.value : null)),
        })),
      ]
    : resultRows.value,
)
// Only whether editing is possible goes into `columns`, which is rebuilt when this changes.
const editable = computed(() => !!props.edit)

const sorting = ref<{ id: string; desc: boolean }[]>([])
// The `#` column always stays at the left edge; columns pinned later are appended after it.
const columnPinning = ref<{ left: string[]; right: string[] }>({ left: ['#'], right: [] })
const columnVisibility = ref<Record<string, boolean>>({})
const columnSizing = ref<Record<string, number>>({})
const columnFilters = ref<{ id: string; value: unknown }[]>([])
const globalFilter = ref(filter.value)
// Column ids are positions, so state of the previous result must not carry over.
watch(
  () => props.result,
  () => {
    sorting.value = []
    columnPinning.value = { left: ['#'], right: [] }
    columnVisibility.value = {}
    columnSizing.value = {}
    columnFilters.value = []
    filter.value = ''
    globalFilter.value = ''
    filtering.value = undefined
    editor.value?.close()
    resetChanges()
  },
)

// Filtering 100k rows on every keystroke would make typing lag.
let filterTimer: ReturnType<typeof setTimeout> | undefined
watch(filter, (value) => {
  clearTimeout(filterTimer)
  filterTimer = setTimeout(() => (globalFilter.value = value), 200)
})
onBeforeUnmount(() => clearTimeout(filterTimer))

// The filtered row model is memoized on the filter state, not on visibility: a new array makes the
// quick filter run again over the columns visible now.
watch(columnVisibility, () => {
  if (globalFilter.value) columnFilters.value = [...columnFilters.value]
})

// The default only searches columns whose first value is a string or number.
const globalFilterOptions = {
  globalFilterFn: containsText,
  getColumnCanGlobalFilter: (column: Column) => column.getIsVisible(),
}

const filteredCount = computed(() =>
  globalFilter.value || columnFilters.value.length
    ? table.value?.tableApi.getFilteredRowModel().rows.length
    : undefined,
)
// Columns and rows as the grid shows them now: visible columns in their order, rows sorted and filtered.
function view(): { columns: ResultColumn[]; rows: CellValue[][] } {
  const api = table.value!.tableApi
  const indices = api
    .getVisibleLeafColumns()
    .filter((c) => c.id !== '#')
    .map((c) => Number(c.id))
  return {
    columns: indices.map((i) => props.result.columns[i]!),
    rows: api.getRowModel().rows.map((row) => indices.map((i) => row.original.cells[i] ?? null)),
  }
}
defineExpose({ filteredCount, view })

// The table has a fixed layout of exactly the column sizes, which pinned offsets and resizing rely on.
const table = useTemplateRef<{
  $el: HTMLElement
  tableApi: {
    getTotalSize(): number
    getVisibleLeafColumns(): { id: string }[]
    getRowModel(): { rows: TableRow<Row>[] }
    getFilteredRowModel(): { rows: unknown[] }
  }
}>('table')
const tableWidth = computed(() => (table.value ? `${table.value.tableApi.getTotalSize()}px` : undefined))

const { columns, filtering } = useGridColumns(
  () => props.result,
  editable,
  edits,
  () => table.value?.$el,
)
const editor = useTemplateRef('editor')

// Desktop app only: a native context menu. In the browser the browser's own menu stays.
function onRowContextmenu(e: Event, row: TableRow<Row>) {
  const col = cellColumn(e, row)
  const index = row.original.index
  const column = col === undefined ? undefined : props.edit?.target.columns[col]
  const td = (e.target as Element).closest('td')
  const isNew = index >= props.result.rows.length
  const canEdit = !!column && !changes.deleted.has(index)
  const { columns } = props.result
  const { cells } = row.original
  return showContextMenu(e as MouseEvent, [
    { label: t('grid.copyValue'), enabled: col !== undefined, action: () => copyValue(cells[col!] ?? null) },
    { label: t('grid.showValue'), enabled: col !== undefined, action: () => showDetail(row, col!) },
    'separator',
    {
      label: t('grid.copyJson'),
      action: () =>
        navigator.clipboard.writeText(
          JSON.stringify(Object.fromEntries(columns.map((c, i) => [c.name, cells[i] ?? null])), null, 2),
        ),
    },
    {
      label: t('grid.copyCsv'),
      action: () =>
        navigator.clipboard.writeText(
          [columns.map((c) => c.name), cells].map((fields) => csvLine(fields, settings.value.csv)).join('\r\n'),
        ),
    },
    {
      label: t('grid.copyMarkdown'),
      action: () =>
        navigator.clipboard.writeText(
          markdownRow(
            columns.map((c) => c.name),
            cells,
          ),
        ),
    },
    {
      label: t('grid.copyInsert'),
      enabled: !!props.insertTarget,
      action: () => {
        const target = props.insertTarget!
        return navigator.clipboard.writeText(`${insertSql(target.dialect, target.table, columns, [cells])};`)
      },
    },
    ...(props.edit
      ? [
          'separator' as const,
          { label: t('grid.editValue'), enabled: canEdit, action: () => editor.value!.open(index, col!, td!) },
          {
            label: t('grid.setNull'),
            enabled: canEdit && column!.nullable,
            action: () => setValue(index, col!, { value: null }),
          },
          {
            label: t('grid.setDefault'),
            enabled: canEdit && (isNew || canUpdateToDefault(props.edit.target.dialect)),
            action: () => setValue(index, col!, { default: true }),
          },
          ...rowActions(index),
        ]
      : []),
  ])
}

// Cells are rendered in `getVisibleCells()` order, so the td's position identifies the column even
// with pinned or hidden columns. The `#` column has no value.
function cellColumn(e: Event, row: TableRow<Row>) {
  const td = (e.target as Element).closest('td')
  const id = td && row.getVisibleCells()[td.cellIndex]?.column.id
  return id && id !== '#' ? Number(id) : undefined
}

// One listener on the table instead of one per cell; rows carry their index in the row model.
function onDblclick(e: MouseEvent) {
  const index = (e.target as Element).closest<HTMLElement>('tr[data-index]')?.dataset.index
  const row = index !== undefined ? table.value?.tableApi.getRowModel().rows[Number(index)] : undefined
  const col = row && cellColumn(e, row)
  if (col === undefined) return
  const anchor = (e.target as Element).closest('td')
  if (props.edit?.target.columns[col] && anchor && !changes.deleted.has(row!.original.index)) {
    editor.value!.open(row!.original.index, col, anchor)
  } else showDetail(row!, col)
}

const detailOpen = ref(false)
const detail = shallowRef<{ column: ResultSet['columns'][number]; value: CellValue }>()
function showDetail(row: TableRow<Row>, col: number) {
  detail.value = { column: props.result.columns[col]!, value: row.original.cells[col] ?? null }
  detailOpen.value = true
}

const toast = useToast()
// NULL is copied as an empty string; the text "NULL" would be indistinguishable from a real value.
async function copyValue(value: CellValue) {
  await navigator.clipboard.writeText(value === null ? '' : detailText(value))
  toast.add({ title: t('grid.valueCopied'), color: 'success', icon: 'i-lucide-check' })
}

const review = useTemplateRef('review')
</script>

<template>
  <div class="flex h-full flex-col" data-tour="grid">
    <UTable
      ref="table"
      v-model:sorting="sorting"
      v-model:column-pinning="columnPinning"
      v-model:column-visibility="columnVisibility"
      v-model:column-sizing="columnSizing"
      v-model:column-filters="columnFilters"
      v-model:global-filter="globalFilter"
      :global-filter-options="globalFilterOptions"
      :column-sizing-options="{ columnResizeMode: 'onChange' }"
      :data="data"
      :columns="columns"
      :virtualize="{ estimateSize: 29, overscan: 20 }"
      :on-contextmenu="isDesktop ? onRowContextmenu : undefined"
      sticky="header"
      class="min-h-0 flex-1"
      :style="{ '--grid-width': tableWidth }"
      :ui="{
        base: 'font-mono text-(length:--font-size) table-fixed min-w-0 w-(--grid-width)',
        // On the cells, not the row: pinned cells have an opaque background of their own. Mixed with the
        // page background so it stays opaque, too.
        tbody: '[&>tr:hover>td]:bg-[color-mix(in_oklab,var(--ui-primary)_12%,var(--ui-bg))]',
        th: 'px-2 py-1.5 whitespace-nowrap overflow-hidden bg-elevated',
        td: 'px-2 py-1 whitespace-nowrap truncate',
      }"
      @dblclick="onDblclick"
    />
    <div v-if="edit" class="flex items-center gap-2 border-t border-default px-3 py-1.5 text-xs text-muted">
      <span class="truncate">{{ t('grid.editHint') }}</span>
      <UButton
        icon="i-lucide-plus"
        :label="t('grid.addRow')"
        size="xs"
        color="neutral"
        variant="outline"
        class="shrink-0"
        @click="addRow"
      />
      <template v-if="changeCount">
        <span class="ml-auto shrink-0">{{
          t('grid.changes', { n: changeCount.toLocaleString(locale) }, changeCount)
        }}</span>
        <UButton
          :label="t('grid.discard')"
          size="xs"
          color="neutral"
          variant="ghost"
          class="shrink-0"
          @click="resetChanges"
        />
        <UButton :label="t('grid.review')" size="xs" class="shrink-0" @click="review!.openReview()" />
      </template>
    </div>
    <GridCellDetail v-model:open="detailOpen" :detail="detail" @copy="copyValue" />
    <GridColumnFilter v-model="filtering" />
    <GridCellEditor
      ref="editor"
      :target="edit?.target"
      :row-count="result.rows.length"
      :current-value="currentValue"
      @apply="setValue"
    />
    <GridReviewModal ref="review" :edit="edit" :rows="result.rows" :changes="changes" @saved="resetChanges" />
  </div>
</template>
