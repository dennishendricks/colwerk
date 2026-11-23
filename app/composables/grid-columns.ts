// Column definitions of the result grid: header menus, resize handles, row menus, cell rendering, column filter.
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { ResultSet } from '#core'
import type { Ref } from 'vue'
import { UButton, UDropdownMenu } from '#components'
import { cellText } from '~~/core/values.ts'
import type { GridEdits } from '~/composables/grid-edits'
import type { GridColumn as Column, GridRow as Row } from '~/utils/grid-cells'
import type { EditValue } from '~/utils/table-edit'

// `root`: the table element, in which the column filter finds the header button to anchor at.
export function useGridColumns(
  result: () => ResultSet,
  editable: Ref<boolean>,
  edits: GridEdits,
  root: () => HTMLElement | undefined,
) {
  const { t } = useI18n()
  const { changes, pendingValue, rowActions } = edits

  const sizeStyle = ({ column }: { column: Column }) => ({ width: `${column.getSize()}px` })
  // Pinned headers are sticky, which already positions the resize handle.
  const headerClass = ({ column }: { column: Column }) => (column.getIsPinned() ? '' : 'relative')
  const pinnedClass = ({ column }: { column: Column }) => (column.getIsPinned() ? 'bg-default' : '')

  const columns = computed<TableColumn<Row>[]>(() => [
    {
      id: '#',
      enableSorting: false,
      enableHiding: false,
      enablePinning: false,
      enableResizing: false,
      size: Math.max(44, Math.round(String(result().rows.length).length * CHAR_WIDTH + (editable.value ? 32 : 16))),
      meta: { style: { th: sizeStyle }, class: { td: pinnedClass } },
      header: ({ table }) =>
        h(
          UDropdownMenu,
          {
            items: table
              .getAllLeafColumns()
              .filter((c) => c.getCanHide())
              .map((c): DropdownMenuItem => ({
                label: result().columns[Number(c.id)]?.name,
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
    ...result().columns.map((col, i): TableColumn<Row> => ({
      id: String(i),
      size: initialSize(col, i, result().rows),
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
        const isNew = index >= result().rows.length
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
        {
          label: t('grid.sortAsc'),
          icon: 'i-lucide-arrow-up-narrow-wide',
          onSelect: () => column.toggleSorting(false),
        },
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
    const anchor = column && root()?.querySelector(`[data-column="${column.id}"]`)
    if (!column || !anchor) return
    e.preventDefault()
    filtering.value = { column, anchor }
  }

  const rowItems = (index: number): DropdownMenuItem[] =>
    rowActions(index).map(({ label, icon, action }) => ({ label, icon, onSelect: action }))

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
          : h(
              'span',
              { title: text.length > 80 ? text : undefined },
              text.length > 200 ? `${text.slice(0, 200)}…` : text,
            )
    return state
      ? h('span', { class: ['block -mx-2 -my-1 truncate px-2 py-1', STATE_CLASS[state]] }, [content])
      : content
  }

  return { columns, filtering }
}
