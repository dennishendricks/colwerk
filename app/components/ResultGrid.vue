<script setup lang="ts">
import type { DropdownMenuItem, TableColumn, TableRow } from '@nuxt/ui'
import type { CellValue, ResultSet } from '#core'
import { csvField } from '~~/core/values.ts'

const props = defineProps<{ result: ResultSet }>()

const UButton = resolveComponent('UButton')
const UDropdownMenu = resolveComponent('UDropdownMenu')

type Row = { index: number, cells: CellValue[] }
type Column = ReturnType<TableRow<Row>['getVisibleCells']>[number]['column']

const data = computed<Row[]>(() => props.result.rows.map((cells, index) => ({ index, cells })))

const sorting = ref<{ id: string, desc: boolean }[]>([])
const columnPinning = ref<{ left: string[], right: string[] }>({ left: [], right: [] })
const columnVisibility = ref<Record<string, boolean>>({})
const columnSizing = ref<Record<string, number>>({})
// Column ids are positions, so state of the previous result must not carry over.
watch(() => props.result, () => {
  sorting.value = []
  columnPinning.value = { left: [], right: [] }
  columnVisibility.value = {}
  columnSizing.value = {}
})

// The table has a fixed layout of exactly the column sizes, which pinned offsets and resizing rely on.
const table = useTemplateRef<{ tableApi: { getTotalSize(): number, getRowModel(): { rows: TableRow<Row>[] } } }>('table')
const tableWidth = computed(() => table.value ? `${table.value.tableApi.getTotalSize()}px` : undefined)
const sizeStyle = ({ column }: { column: Column }) => ({ width: `${column.getSize()}px` })
// Pinned headers are sticky, which already positions the resize handle.
const headerClass = ({ column }: { column: Column }) => column.getIsPinned() ? '' : 'relative'
const pinnedClass = ({ column }: { column: Column }) => column.getIsPinned() ? 'bg-default' : ''

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
    size: Math.max(44, Math.round(String(props.result.rows.length).length * CHAR_WIDTH + 16)),
    meta: { style: { th: sizeStyle } },
    header: ({ table }) => h(UDropdownMenu, {
      items: table.getAllLeafColumns().filter(c => c.getCanHide()).map((c): DropdownMenuItem => ({
        label: props.result.columns[Number(c.id)]?.name,
        type: 'checkbox',
        checked: c.getIsVisible(),
        onUpdateChecked: (v: boolean) => c.toggleVisibility(v),
        onSelect: (e: Event) => e.preventDefault(),
      })),
      content: { align: 'start' },
      ui: { content: 'max-h-96' },
    }, () => h(UButton, { icon: 'i-lucide-columns-3', color: 'neutral', variant: 'ghost', size: 'xs', class: '-my-1', title: 'Spalten ein-/ausblenden' })),
    cell: ({ row }) => h('span', { class: 'text-dimmed' }, row.original.index + 1),
  },
  ...props.result.columns.map((col, i): TableColumn<Row> => ({
    id: String(i),
    size: initialSize(col, i),
    minSize: 40,
    // null → undefined, which `sortUndefined` keeps last in both directions.
    accessorFn: row => row.cells[i] ?? undefined,
    sortingFn: (a, b, id) => compareCells(a.getValue(id), b.getValue(id)),
    sortUndefined: 'last',
    meta: { style: { th: sizeStyle }, class: { th: headerClass, td: pinnedClass } },
    header: ({ column, header }) => [h(UDropdownMenu, { items: headerItems(column), content: { align: 'start' } }, () => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      size: 'xs',
      class: '-mx-1.5 -my-1 font-semibold',
      title: col.type,
      trailingIcon: sortIcon(column.getIsSorted()) ?? (column.getIsPinned() ? 'i-lucide-pin' : undefined),
    }, () => [col.name, h('span', { class: 'font-normal text-dimmed' }, col.type)])), h('div', {
      class: ['absolute inset-y-0 right-0 w-1 cursor-col-resize touch-none select-none hover:bg-primary', column.getIsResizing() && 'bg-primary'],
      title: 'Breite ziehen, Doppelklick setzt zurück',
      onMousedown: header.getResizeHandler(),
      onTouchstart: header.getResizeHandler(),
      onDblclick: () => column.resetSize(),
    })],
    cell: ({ row }) => renderCell(row.original.cells[i] ?? null),
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
      { label: 'Aufsteigend sortieren', icon: 'i-lucide-arrow-up-narrow-wide', onSelect: () => column.toggleSorting(false) },
      { label: 'Absteigend sortieren', icon: 'i-lucide-arrow-down-wide-narrow', onSelect: () => column.toggleSorting(true) },
      ...sorted ? [{ label: 'Sortierung aufheben', icon: 'i-lucide-x', onSelect: () => column.clearSorting() }] : [],
    ],
    [
      ...pinned !== 'left' ? [{ label: 'Links fixieren', icon: 'i-lucide-pin', onSelect: () => column.pin('left') }] : [],
      ...pinned !== 'right' ? [{ label: 'Rechts fixieren', icon: 'i-lucide-pin', onSelect: () => column.pin('right') }] : [],
      ...pinned ? [{ label: 'Fixierung lösen', icon: 'i-lucide-pin-off', onSelect: () => column.pin(false) }] : [],
    ],
    [{ label: 'Ausblenden', icon: 'i-lucide-eye-off', onSelect: () => column.toggleVisibility(false) }],
  ]
}

// Decimals and big integers arrive as strings, so numeric strings compare as numbers.
const NUMERIC = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i
// One instance: `localeCompare` with locale and options builds a collator on every call.
const collator = new Intl.Collator('de', { numeric: true })
function compareCells(a: CellValue, b: CellValue) {
  const isNum = (v: CellValue) => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && NUMERIC.test(v))
  if (isNum(a) && isNum(b)) return Number(a) - Number(b)
  return collator.compare(cellText(a), cellText(b))
}

function cellText(value: CellValue) {
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

// Desktop app only: the launcher shows a native context menu (see launcher/main.ts). In the browser
// the browser's own menu stays.
type MenuItem = { item: { label: string, id: string, enabled: boolean } } | 'separator'
const contextMenu = (window as { bindings?: { contextMenu?(x: number, y: number, menu: MenuItem[]): Promise<string | null> } }).bindings?.contextMenu

async function onRowContextmenu(e: Event, row: TableRow<Row>) {
  e.preventDefault()
  const { clientX, clientY } = e as MouseEvent
  const col = cellColumn(e, row)
  const id = await contextMenu!(clientX, clientY, [
    { item: { label: 'Wert kopieren', id: 'copy', enabled: col !== undefined } },
    { item: { label: 'Wert anzeigen …', id: 'show', enabled: col !== undefined } },
    'separator',
    { item: { label: 'Datensatz als JSON kopieren', id: 'json', enabled: true } },
    { item: { label: 'Datensatz als CSV kopieren', id: 'csv', enabled: true } },
  ])
  const { columns } = props.result
  const { cells } = row.original
  if (id === 'copy') {
    await copyValue(cells[col!] ?? null)
  } else if (id === 'show') {
    showDetail(row, col!)
  } else if (id === 'json') {
    await navigator.clipboard.writeText(JSON.stringify(Object.fromEntries(columns.map((c, i) => [c.name, cells[i] ?? null])), null, 2))
  } else if (id === 'csv') {
    await navigator.clipboard.writeText([columns.map(c => c.name), cells].map(fields => fields.map(csvField).join(';')).join('\r\n'))
  }
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
  if (col !== undefined) showDetail(row!, col)
}

const detailOpen = ref(false)
const detail = shallowRef<{ column: ResultSet['columns'][number], value: CellValue }>()
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
  toast.add({ title: 'Wert kopiert', color: 'success', icon: 'i-lucide-check' })
}

function renderCell(value: CellValue) {
  if (value === null) return h('span', { class: 'italic text-dimmed' }, 'NULL')
  const text = cellText(value)
  return h('span', { title: text.length > 80 ? text : undefined }, text.length > 200 ? `${text.slice(0, 200)}…` : text)
}
</script>

<template>
  <UTable
    ref="table"
    v-model:sorting="sorting"
    v-model:column-pinning="columnPinning"
    v-model:column-visibility="columnVisibility"
    v-model:column-sizing="columnSizing"
    :column-sizing-options="{ columnResizeMode: 'onChange' }"
    :data="data"
    :columns="columns"
    :virtualize="{ estimateSize: 29, overscan: 20 }"
    :on-contextmenu="contextMenu ? onRowContextmenu : undefined"
    sticky="header"
    class="h-full"
    :style="{ '--grid-width': tableWidth }"
    :ui="{
      base: 'font-mono text-xs table-fixed min-w-0 w-(--grid-width)',
      th: 'px-2 py-1.5 whitespace-nowrap overflow-hidden bg-elevated',
      td: 'px-2 py-1 whitespace-nowrap truncate',
    }"
    @dblclick="onDblclick"
  />
  <UModal v-model:open="detailOpen" :title="detail?.column.name" :description="detail?.column.type" :ui="{ content: 'max-w-3xl' }">
    <template #body>
      <span v-if="detail?.value === null" class="font-mono text-xs italic text-dimmed">NULL</span>
      <pre v-else-if="detail" class="font-mono text-xs whitespace-pre-wrap wrap-anywhere">{{ detailText(detail.value) }}</pre>
    </template>
    <template #footer>
      <UButton label="Kopieren" icon="i-lucide-copy" color="neutral" variant="outline" @click="copyValue(detail!.value)" />
    </template>
  </UModal>
</template>
