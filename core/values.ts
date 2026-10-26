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

export const cellText = (v: CellValue) => typeof v === 'object' ? JSON.stringify(v) : String(v)

/** CSV field (RFC 4180, `;`-separated): every value is quoted, NULL is an empty field. */
export function csvField(v: CellValue): string {
  return v === null ? '' : `"${cellText(v).replaceAll('"', '""')}"`
}
