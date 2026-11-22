// Parsing of ISO dates and timestamps for the typed export formats (Parquet, XLSX).
import type { CellValue } from '../types.ts'

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/

/** Microseconds since the epoch of an ISO date or timestamp (as the drivers return them); a missing zone counts as UTC. */
export function parseTimestamp(v: CellValue): { micros: bigint; time: boolean; zone: boolean } | undefined {
  const m = typeof v === 'string' ? v.match(TIMESTAMP) : null
  if (!m) return undefined
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map((x) => Number(x ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const date = new Date(Date.UTC(2000, 0, 1, h, mi, s))
  date.setUTCFullYear(y, mo - 1, d)
  // Date rolls invalid fields over (Feb 30 → Mar 2); such values do not convert.
  if (
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d ||
    date.getUTCHours() !== h ||
    date.getUTCMinutes() !== mi ||
    date.getUTCSeconds() !== s
  )
    return undefined
  const zone = m[8]?.match(/^([+-])(\d{2}):?(\d{2})?$/)
  const offset = zone ? (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3] ?? 0)) * 60_000 : 0
  const micros = BigInt(date.getTime() - offset) * 1000n + BigInt((m[7] ?? '').padEnd(6, '0').slice(0, 6))
  return { micros, time: m[4] !== undefined, zone: m[8] !== undefined }
}
