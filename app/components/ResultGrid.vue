<script setup lang="ts">
import type { DropdownMenuItem, TableColumn, TableRow } from '@nuxt/ui'
import type { CellValue, ResultColumn, ResultSet } from '#core'
import { insertSql } from '~~/core/sql-literals.ts'
import { csvField, markdownRow } from '~~/core/values.ts'
import type { SplitDialect } from '~/utils/sql-split'
import type { Changes, EditTarget, EditValue } from '~/utils/table-edit'

// `insertTarget`: dialect and table of the row menu's INSERT statement; without it the item is disabled.
const props = defineProps<{
  result: ResultSet
  insertTarget?: { dialect: SplitDialect; table: string[] }
  /** Set when the result can be edited (see QueryPanel); `save` runs the reviewed statements. */
  edit?: { target: EditTarget; confirm: boolean; connection: string; save: (statements: string[]) => Promise<void> }
}>()
// Text of the quick filter, whose input lives in the caller's status bar.
const filter = defineModel<string>('filter', { default: '' })
const { t, locale } = useI18n()

const UButton = resolveComponent('UButton')
const UDropdownMenu = resolveComponent('UDropdownMenu')

type Row = { index: number; cells: CellValue[] }
type Column = ReturnType<TableRow<Row>['getVisibleCells']>[number]['column']

// Pending edits (#60): nothing is written until "Save".
// Cast: `reactive<Changes>` would unwrap the recursive CellValue type endlessly.
const changes = reactive({ updated: new Map(), inserted: [], deleted: new Set() }) as Changes
const changeCount = computed(
  () =>
    changes.inserted.length +
    changes.deleted.size +
    [...changes.updated.keys()].filter((row) => !changes.deleted.has(row)).length,
)
function resetChanges() {
  changes.updated.clear()
  changes.inserted.length = 0
  changes.deleted.clear()
}

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
    editing.value = undefined
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

// Case-insensitive substring match on the displayed text; NULL (undefined here) matches nothing.
function containsText(row: TableRow<Row>, id: string, query: string) {
  const value = row.getValue<CellValue | undefined>(id)
  return value !== undefined && cellText(value).toLowerCase().includes(query)
}
// Lower-cased once per filter run instead of once per cell.
containsText.resolveFilterValue = (query: string) => query.toLowerCase()
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
const sizeStyle = ({ column }: { column: Column }) => ({ width: `${column.getSize()}px` })
// Pinned headers are sticky, which already positions the resize handle.
const headerClass = ({ column }: { column: Column }) => (column.getIsPinned() ? '' : 'relative')
const pinnedClass = ({ column }: { column: Column }) => (column.getIsPinned() ? 'bg-default' : '')

// Initial width from the header and the first rows' content, in characters of the monospace font.
const CHAR_WIDTH = 7.2
function initialSize(col: ResultSet['columns'][number], i: number) {
  let chars = col.name.length + col.type.length + 4
  for (const cells of props.result.rows.slice(0, 100)) {
    const value = cells[i] ?? null
    if (value !== null) chars = Math.max(chars, Math.min(cellText(value).length, 60))
  }
  return Math.min(Math.max(Math.round(chars * CHAR_WIDTH + 16), 60), 448)
}

const columns = computed<TableColumn<Row>[]>(() => [
  {
    id: '#',
    enableSorting: false,
    enableHiding: false,
    enablePinning: false,
    enableResizing: false,
    size: Math.max(44, Math.round(String(props.result.rows.length).length * CHAR_WIDTH + (editable.value ? 32 : 16))),
    meta: { style: { th: sizeStyle }, class: { td: pinnedClass } },
    header: ({ table }) =>
      h(
        UDropdownMenu,
        {
          items: table
            .getAllLeafColumns()
            .filter((c) => c.getCanHide())
            .map((c): DropdownMenuItem => ({
              label: props.result.columns[Number(c.id)]?.name,
              type: 'checkbox',
              checked: c.getIsVisible(),
              onUpdateChecked: (v: boolean) => c.toggleVisibility(v),
              onSelect: (e: Event) => e.preventDefault(),
            })),
          content: { align: 'start' },
          ui: { content: 'max-h-96' },
        },
        () =>
          h(UButton, {
            icon: 'i-lucide-columns-3',
            color: 'neutral',
            variant: 'ghost',
            size: 'xs',
            class: '-my-1',
            title: t('grid.toggleColumns'),
            'aria-label': t('grid.toggleColumns'),
          }),
      ),
    cell: ({ row }) =>
      editable.value
        ? h(UDropdownMenu, { items: rowItems(row.original.index), content: { align: 'start' } }, () =>
            h(UButton, {
              color: 'neutral',
              variant: 'ghost',
              size: 'xs',
              class: '-mx-1.5 -my-1 text-dimmed',
              label: String(row.original.index + 1),
              'aria-label': t('grid.rowActions'),
            }),
          )
        : h('span', { class: 'text-dimmed' }, row.original.index + 1),
  },
  ...props.result.columns.map((col, i): TableColumn<Row> => ({
    id: String(i),
    size: initialSize(col, i),
    minSize: 40,
    // null → undefined, which `sortUndefined` keeps last in both directions.
    accessorFn: (row) => row.cells[i] ?? undefined,
    sortingFn: (a, b, id) => compareCells(a.getValue(id), b.getValue(id)),
    sortUndefined: 'last',
    filterFn: containsText,
    meta: { style: { th: sizeStyle }, class: { th: headerClass, td: pinnedClass } },
    header: ({ column, header }) => [
      h(
        UDropdownMenu,
        { items: headerItems(column), content: { align: 'start', onCloseAutoFocus: openColumnFilter } },
        () =>
          h(
            UButton,
            {
              color: 'neutral',
              variant: 'ghost',
              size: 'xs',
              class: '-mx-1.5 -my-1 font-semibold',
              title: col.type,
              icon: column.getIsFiltered() ? 'i-lucide-filter' : undefined,
              'data-column': column.id,
              trailingIcon: sortIcon(column.getIsSorted()) ?? (column.getIsPinned() ? 'i-lucide-pin' : undefined),
            },
            () => [col.name, h('span', { class: 'font-normal text-dimmed' }, col.type)],
          ),
      ),
      h('div', {
        class: [
          'absolute inset-y-0 right-0 w-1 cursor-col-resize touch-none select-none hover:bg-primary',
          column.getIsResizing() && 'bg-primary',
        ],
        title: t('grid.resize'),
        onMousedown: header.getResizeHandler(),
        onTouchstart: header.getResizeHandler(),
        onDblclick: () => column.resetSize(),
      }),
    ],
    cell: ({ row }) => {
      const { index, cells } = row.original
      const isNew = index >= props.result.rows.length
      const pending = pendingValue(index, i)
      const state = changes.deleted.has(index) ? 'deleted' : isNew ? 'new' : pending ? 'updated' : undefined
      return renderCell(pending ?? { value: cells[i] ?? null }, state)
    },
  })),
])

function sortIcon(sorted: false | 'asc' | 'desc') {
  if (sorted === 'asc') return 'i-lucide-arrow-up-narrow-wide'
  if (sorted === 'desc') return 'i-lucide-arrow-down-wide-narrow'
}

function headerItems(column: Column): DropdownMenuItem[][] {
  const sorted = column.getIsSorted()
  const pinned = column.getIsPinned()
  return [
    [
      { label: t('grid.sortAsc'), icon: 'i-lucide-arrow-up-narrow-wide', onSelect: () => column.toggleSorting(false) },
      {
        label: t('grid.sortDesc'),
        icon: 'i-lucide-arrow-down-wide-narrow',
        onSelect: () => column.toggleSorting(true),
      },
      ...(sorted ? [{ label: t('grid.clearSort'), icon: 'i-lucide-x', onSelect: () => column.clearSorting() }] : []),
    ],
    [
      ...(pinned !== 'left'
        ? [{ label: t('grid.pinLeft'), icon: 'i-lucide-pin', onSelect: () => column.pin('left') }]
        : []),
      ...(pinned !== 'right'
        ? [{ label: t('grid.pinRight'), icon: 'i-lucide-pin', onSelect: () => column.pin('right') }]
        : []),
      ...(pinned ? [{ label: t('grid.unpin'), icon: 'i-lucide-pin-off', onSelect: () => column.pin(false) }] : []),
    ],
    [
      { label: t('grid.filter'), icon: 'i-lucide-filter', onSelect: () => (pendingFilter = column) },
      ...(column.getIsFiltered()
        ? [
            {
              label: t('grid.removeFilter'),
              icon: 'i-lucide-filter-x',
              onSelect: () => column.setFilterValue(undefined),
            },
          ]
        : []),
    ],
    [{ label: t('grid.hide'), icon: 'i-lucide-eye-off', onSelect: () => column.toggleVisibility(false) }],
  ]
}

// One popover for all column filters, anchored at the header button. It opens only once the menu
// has closed, because the menu returning focus to its trigger would dismiss it right away.
const filtering = shallowRef<{ column: Column; anchor: Element }>()
let pendingFilter: Column | undefined
function openColumnFilter(e: Event) {
  const column = pendingFilter
  pendingFilter = undefined
  const anchor = column && table.value?.$el.querySelector(`[data-column="${column.id}"]`)
  if (!column || !anchor) return
  e.preventDefault()
  filtering.value = { column, anchor }
}

// Decimals and big integers arrive as strings, so numeric strings compare as numbers.
const NUMERIC = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i
// One instance: `localeCompare` with locale and options builds a collator on every call.
const collator = new Intl.Collator('de', { numeric: true })
function compareCells(a: CellValue, b: CellValue) {
  const isNum = (v: CellValue) =>
    typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && NUMERIC.test(v))
  if (isNum(a) && isNum(b)) return Number(a) - Number(b)
  return collator.compare(cellText(a), cellText(b))
}

function cellText(value: CellValue) {
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function pendingValue(index: number, col: number): EditValue | undefined {
  const n = index - props.result.rows.length
  return n >= 0 ? changes.inserted[n]?.[col] : changes.updated.get(index)?.get(col)
}
// What the cell shows: the pending value or the one of the result.
const currentValue = (index: number, col: number): EditValue =>
  pendingValue(index, col) ?? { value: props.result.rows[index]?.[col] ?? null }

function setValue(index: number, col: number, value: EditValue) {
  const n = index - props.result.rows.length
  if (n >= 0) {
    changes.inserted[n]![col] = value
    return
  }
  const original = props.result.rows[index]![col] ?? null
  const unchanged =
    'value' in value &&
    (value.value === null ? original === null : original !== null && cellText(value.value) === cellText(original))
  if (!unchanged && !changes.updated.has(index)) changes.updated.set(index, new Map())
  const cells = changes.updated.get(index)
  if (unchanged) cells?.delete(col)
  else cells!.set(col, value)
  if (cells && !cells.size) changes.updated.delete(index)
}

const newRow = () => props.edit!.target.columns.map((c): EditValue => (c ? { default: true } : { value: null }))
function addRow() {
  changes.inserted.push(newRow())
}
// Key columns start as DEFAULT, for identity and serial keys.
function cloneRow(index: number) {
  const { columns, key } = props.edit!.target
  changes.inserted.push(
    columns.map((c, col): EditValue =>
      !c ? { value: null } : key.includes(col) ? { default: true } : currentValue(index, col),
    ),
  )
}
function toggleDelete(index: number) {
  const n = index - props.result.rows.length
  if (n >= 0) changes.inserted.splice(n, 1)
  else if (!changes.deleted.delete(index)) changes.deleted.add(index)
}
function revertRow(index: number) {
  changes.updated.delete(index)
  changes.deleted.delete(index)
}

// Delete or undo, as the row's state allows.
function rowActions(index: number) {
  const isNew = index >= props.result.rows.length
  const deleted = changes.deleted.has(index)
  return [
    { label: t('grid.cloneRow'), icon: 'i-lucide-copy', action: () => cloneRow(index) },
    ...(deleted ? [] : [{ label: t('grid.deleteRow'), icon: 'i-lucide-trash-2', action: () => toggleDelete(index) }]),
    ...(deleted || (!isNew && changes.updated.has(index))
      ? [{ label: t('grid.revertRow'), icon: 'i-lucide-undo-2', action: () => revertRow(index) }]
      : []),
  ]
}
const rowItems = (index: number): DropdownMenuItem[] =>
  rowActions(index).map(({ label, icon, action }) => ({ label, icon, onSelect: action }))

// One popover editor for all cells, anchored at the td. Text and the boolean live in refs of their own, as
// `editing` is shallow.
const editing = shallowRef<{
  row: number
  col: number
  anchor: Element
  kind: ReturnType<typeof editorKind>
  column: NonNullable<EditTarget['columns'][number]>
}>()
const draft = ref('')
const draftBool = ref<boolean>()
function openEditor(row: number, col: number, anchor: Element) {
  const column = props.edit!.target.columns[col]!
  const value = currentValue(row, col)
  const text = 'default' in value || value.value === null ? '' : detailText(value.value)
  const kind = editorKind(column, props.edit!.target.dialect, text)
  draft.value = text
  draftBool.value = 'value' in value && value.value !== null ? ['true', '1'].includes(text) : undefined
  editing.value = { row, col, anchor, kind, column }
}
// `value`: NULL or DEFAULT; otherwise what the editor holds (nothing for a boolean that was not chosen).
function applyEditor(value?: EditValue) {
  const e = editing.value!
  value ??=
    e.kind !== 'boolean'
      ? { value: draft.value }
      : draftBool.value === undefined
        ? undefined
        : { value: draftBool.value }
  if (value) setValue(e.row, e.col, value)
  editing.value = undefined
}

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
          [columns.map((c) => c.name), cells].map((fields) => fields.map(csvField).join(';')).join('\r\n'),
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
          { label: t('grid.editValue'), enabled: canEdit, action: () => openEditor(index, col!, td!) },
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
    openEditor(row!.original.index, col, anchor)
  } else showDetail(row!, col)
}

const detailOpen = ref(false)
const detail = shallowRef<{ column: ResultSet['columns'][number]; value: CellValue }>()
function showDetail(row: TableRow<Row>, col: number) {
  detail.value = { column: props.result.columns[col]!, value: row.original.cells[col] ?? null }
  detailOpen.value = true
}

function detailText(value: CellValue) {
  return typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value)
}

const toast = useToast()
// NULL is copied as an empty string; the text "NULL" would be indistinguishable from a real value.
async function copyValue(value: CellValue) {
  await navigator.clipboard.writeText(value === null ? '' : detailText(value))
  toast.add({ title: t('grid.valueCopied'), color: 'success', icon: 'i-lucide-check' })
}

const STATE_CLASS = {
  updated: 'bg-warning/15',
  new: 'bg-success/10',
  deleted: 'line-through text-dimmed bg-error/10',
}
// Changed cells get a background across the whole cell.
function renderCell(value: EditValue, state?: keyof typeof STATE_CLASS) {
  const text = 'value' in value && value.value !== null ? cellText(value.value) : undefined
  const content =
    'default' in value
      ? h('span', { class: 'italic text-dimmed' }, 'DEFAULT')
      : text === undefined
        ? h('span', { class: 'italic text-dimmed' }, 'NULL')
        : h('span', { title: text.length > 80 ? text : undefined }, text.length > 200 ? `${text.slice(0, 200)}…` : text)
  return state ? h('span', { class: ['block -mx-2 -my-1 truncate px-2 py-1', STATE_CLASS[state]] }, [content]) : content
}

// The reviewed statements are exactly the ones that run.
const reviewOpen = ref(false)
const statements = computed(() =>
  reviewOpen.value && props.edit ? editStatements(props.edit.target, props.result.rows, changes) : [],
)
const saving = ref(false)
const saveError = ref<string>()
function openReview() {
  saveError.value = undefined
  reviewOpen.value = true
}
async function save() {
  saving.value = true
  saveError.value = undefined
  try {
    await props.edit!.save(statements.value)
    resetChanges()
    reviewOpen.value = false
  } catch (e) {
    saveError.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
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
        <UButton :label="t('grid.review')" size="xs" class="shrink-0" @click="openReview" />
      </template>
    </div>
    <UModal
      v-model:open="detailOpen"
      :title="detail?.column.name"
      :description="detail?.column.type"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <span v-if="detail?.value === null" class="font-mono text-xs italic text-dimmed">NULL</span>
        <pre v-else-if="detail" class="font-mono text-xs whitespace-pre-wrap wrap-anywhere">{{
          detailText(detail.value)
        }}</pre>
      </template>
      <template #footer>
        <UButton
          :label="t('common.copy')"
          icon="i-lucide-copy"
          color="neutral"
          variant="outline"
          @click="copyValue(detail!.value)"
        />
      </template>
    </UModal>
    <UPopover
      :open="!!filtering"
      :reference="filtering?.anchor"
      :content="{ align: 'start' }"
      @update:open="(open) => open || (filtering = undefined)"
    >
      <template #content>
        <UInput
          v-if="filtering"
          :model-value="String(filtering.column.getFilterValue() ?? '')"
          :placeholder="t('grid.columnContains')"
          :aria-label="t('grid.columnContains')"
          icon="i-lucide-filter"
          size="xs"
          class="m-2 w-56"
          @update:model-value="(value) => filtering?.column.setFilterValue(value)"
          @keydown.enter="filtering = undefined"
        />
      </template>
    </UPopover>
    <UPopover
      :open="!!editing"
      :reference="editing?.anchor"
      :content="{ align: 'start' }"
      @update:open="(open) => open || (editing = undefined)"
    >
      <template #content>
        <form v-if="editing" class="flex w-80 flex-col gap-2 p-2" @submit.prevent="applyEditor()">
          <USelect
            v-if="editing.kind === 'boolean'"
            v-model="draftBool"
            :items="[
              { label: 'true', value: true },
              { label: 'false', value: false },
            ]"
            :aria-label="editing.column.name"
            size="xs"
          />
          <UInput
            v-else-if="editing.kind === 'date'"
            v-model="draft"
            type="date"
            :aria-label="editing.column.name"
            size="xs"
            autofocus
          />
          <UTextarea
            v-else-if="editing.kind === 'long'"
            v-model="draft"
            :rows="6"
            autoresize
            :aria-label="editing.column.name"
            size="xs"
            autofocus
            @keydown.meta.enter.prevent="applyEditor()"
            @keydown.ctrl.enter.prevent="applyEditor()"
          />
          <UInput
            v-else
            v-model="draft"
            :placeholder="/timestamp|datetime/i.test(editing.column.type) ? 'YYYY-MM-DD hh:mm:ss' : undefined"
            :aria-label="editing.column.name"
            size="xs"
            autofocus
          />
          <div class="flex justify-end gap-2">
            <UButton
              v-if="editing.column.nullable"
              label="NULL"
              size="xs"
              color="neutral"
              variant="outline"
              @click="applyEditor({ value: null })"
            />
            <UButton
              v-if="editing.row >= result.rows.length || canUpdateToDefault(edit!.target.dialect)"
              label="DEFAULT"
              size="xs"
              color="neutral"
              variant="outline"
              @click="applyEditor({ default: true })"
            />
            <UButton :label="t('grid.apply')" type="submit" size="xs" />
          </div>
        </form>
      </template>
    </UPopover>
    <UModal
      v-model:open="reviewOpen"
      :title="t('grid.reviewTitle')"
      :description="
        edit?.confirm
          ? t('grid.reviewDescriptionConfirm', { connection: edit.connection })
          : t('grid.reviewDescription')
      "
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <UAlert
          v-if="saveError"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="saveError"
          class="mb-3 whitespace-pre-wrap"
        />
        <pre class="max-h-96 overflow-auto rounded bg-elevated p-3 font-mono text-xs">{{
          statements.map((s) => `${s};`).join('\n')
        }}</pre>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="reviewOpen = false" />
          <UButton
            :label="t('grid.review')"
            :color="edit?.confirm ? 'error' : 'primary'"
            :loading="saving"
            @click="save"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
