// Pending edits of one result grid (#60): changed, inserted and deleted rows; nothing is written until "Save".
import type { ResultSet } from '#core'
import { cellText } from '~~/core/values.ts'
import type { Changes, EditTarget, EditValue } from '~/utils/table-edit'

/** Set when a result can be edited (see QueryPanel); `save` runs the reviewed statements. */
export type GridEdit = {
  target: EditTarget
  confirm: boolean
  connection: string
  save: (statements: string[]) => Promise<void>
}

export function useGridEdits(result: () => ResultSet, target: () => EditTarget | undefined) {
  const { t } = useI18n()

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

  function pendingValue(index: number, col: number): EditValue | undefined {
    const n = index - result().rows.length
    return n >= 0 ? changes.inserted[n]?.[col] : changes.updated.get(index)?.get(col)
  }
  // What the cell shows: the pending value or the one of the result.
  const currentValue = (index: number, col: number): EditValue =>
    pendingValue(index, col) ?? { value: result().rows[index]?.[col] ?? null }

  function setValue(index: number, col: number, value: EditValue) {
    const n = index - result().rows.length
    if (n >= 0) {
      changes.inserted[n]![col] = value
      return
    }
    const original = result().rows[index]![col] ?? null
    const unchanged =
      'value' in value &&
      (value.value === null ? original === null : original !== null && cellText(value.value) === cellText(original))
    if (!unchanged && !changes.updated.has(index)) changes.updated.set(index, new Map())
    const cells = changes.updated.get(index)
    if (unchanged) cells?.delete(col)
    else cells!.set(col, value)
    if (cells && !cells.size) changes.updated.delete(index)
  }

  const newRow = () => target()!.columns.map((c): EditValue => (c ? { default: true } : { value: null }))
  function addRow() {
    changes.inserted.push(newRow())
  }
  // Key columns start as DEFAULT, for identity and serial keys.
  function cloneRow(index: number) {
    const { columns, key } = target()!
    changes.inserted.push(
      columns.map((c, col): EditValue =>
        !c ? { value: null } : key.includes(col) ? { default: true } : currentValue(index, col),
      ),
    )
  }
  function toggleDelete(index: number) {
    const n = index - result().rows.length
    if (n >= 0) changes.inserted.splice(n, 1)
    else if (!changes.deleted.delete(index)) changes.deleted.add(index)
  }
  function revertRow(index: number) {
    changes.updated.delete(index)
    changes.deleted.delete(index)
  }

  // Delete or undo, as the row's state allows.
  function rowActions(index: number) {
    const isNew = index >= result().rows.length
    const deleted = changes.deleted.has(index)
    return [
      { label: t('grid.cloneRow'), icon: 'i-lucide-copy', action: () => cloneRow(index) },
      ...(deleted ? [] : [{ label: t('grid.deleteRow'), icon: 'i-lucide-trash-2', action: () => toggleDelete(index) }]),
      ...(deleted || (!isNew && changes.updated.has(index))
        ? [{ label: t('grid.revertRow'), icon: 'i-lucide-undo-2', action: () => revertRow(index) }]
        : []),
    ]
  }

  return { changes, changeCount, resetChanges, pendingValue, currentValue, setValue, addRow, rowActions }
}

export type GridEdits = ReturnType<typeof useGridEdits>
