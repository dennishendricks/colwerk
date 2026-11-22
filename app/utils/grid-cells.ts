// Pure helpers of the result grid: row and column types, cell sorting, filtering, sizing and display text.
import type { TableRow } from '@nuxt/ui'
import type { CellValue, ResultSet } from '#core'
import { cellText } from '~~/core/values.ts'

export type GridRow = { index: number; cells: CellValue[] }
export type GridColumn = ReturnType<TableRow<GridRow>['getVisibleCells']>[number]['column']

// Case-insensitive substring match on the displayed text; NULL (undefined here) matches nothing.
export function containsText(row: TableRow<GridRow>, id: string, query: string) {
  const value = row.getValue<CellValue | undefined>(id)
  return value !== undefined && cellText(value).toLowerCase().includes(query)
}
// Lower-cased once per filter run instead of once per cell.
containsText.resolveFilterValue = (query: string) => query.toLowerCase()

// Initial width from the header and the first rows' content, in characters of the monospace font.
export const CHAR_WIDTH = 7.2
export function initialSize(col: ResultSet['columns'][number], i: number, rows: CellValue[][]) {
  let chars = col.name.length + col.type.length + 4
  for (const cells of rows.slice(0, 100)) {
    const value = cells[i] ?? null
    if (value !== null) chars = Math.max(chars, Math.min(cellText(value).length, 60))
  }
  return Math.min(Math.max(Math.round(chars * CHAR_WIDTH + 16), 60), 448)
}

// Decimals and big integers arrive as strings, so numeric strings compare as numbers.
const NUMERIC = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i
// One instance: `localeCompare` with locale and options builds a collator on every call.
const collator = new Intl.Collator('de', { numeric: true })
export function compareCells(a: CellValue, b: CellValue) {
  const isNum = (v: CellValue) =>
    typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && NUMERIC.test(v))
  if (isNum(a) && isNum(b)) return Number(a) - Number(b)
  return collator.compare(cellText(a), cellText(b))
}

export function detailText(value: CellValue) {
  return typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value)
}
