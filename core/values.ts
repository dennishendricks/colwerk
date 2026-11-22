import type { CellValue } from './types.ts'

/** Rows per `RowSink.rows` call when streaming. */
export const STREAM_BATCH = 1000

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function toHex(bytes: Uint8Array): string {
  let out = '0x'
  for (const b of bytes) out += HEX[b]
  return out
}

/** `2024-01-02 03:04:05.123+01` → `2024-01-02T03:04:05.123+01:00` (keeps full fractional precision). */
export function sqlTimestampToIso(value: string): string {
  return value
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
}

/** Converts driver-native values into the unified value model (see `CellValue`). */
export function normalizeValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      return Number.isFinite(value) ? value : String(value)
    case 'bigint':
      return value.toString()
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value instanceof Uint8Array) return toHex(value)
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (typeof value === 'object') {
    const out: Record<string, CellValue> = {}
    for (const [k, v] of Object.entries(value)) out[k] = normalizeValue(v)
    return out
  }
  return String(value)
}

export const cellText = (v: CellValue) => (typeof v === 'object' ? JSON.stringify(v) : String(v))

/** CSV field (RFC 4180, `;`-separated): every value is quoted, NULL is an empty field. */
export function csvField(v: CellValue): string {
  return v === null ? '' : `"${cellText(v).replaceAll('"', '""')}"`
}

/** Markdown table cell: NULL is empty (like CSV), `|` and backslashes are escaped, line breaks become `<br>`. */
export function markdownField(v: CellValue): string {
  return v === null
    ? ''
    : cellText(v)
        .replace(/[\\|]/g, '\\$&')
        .replace(/\r?\n|\r/g, '<br>')
}

/** Header, separator and one line per row. */
export function markdownTable(names: string[], rows: CellValue[][]): string {
  const line = (fields: string[]) => `| ${fields.join(' | ')} |`
  return [
    line(names.map(markdownField)),
    line(names.map(() => '---')),
    ...rows.map((cells) => line(names.map((_, i) => markdownField(cells[i] ?? null)))),
  ].join('\n')
}

/** Header, separator and one row. */
export const markdownRow = (names: string[], cells: CellValue[]) => markdownTable(names, [cells])

/** Repeated names (e.g. `id` of a join) get a suffix, for formats that address columns by name. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>()
  return names.map((name) => {
    let unique = name
    for (let i = 1; seen.has(unique); i++) unique = `${name}_${i}`
    seen.add(unique)
    return unique
  })
}

/** One JSON object per row, keyed by column name. */
export const jsonRecord = (names: string[], row: CellValue[]) =>
  JSON.stringify(Object.fromEntries(names.map((n, i) => [n, row[i] ?? null])))
