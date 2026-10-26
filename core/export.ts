import { createReadStream } from 'node:fs'
import { type FileHandle, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { ByteWriter, ParquetWriter } from 'hyparquet-writer'
import { cellText, csvField } from './values.ts'
import { type CellValue, DbError, type ResultColumn, type RowSink } from './types.ts'

export type ExportFormat = 'csv' | 'parquet'

/** A sink that encodes rows; `write` is awaited for backpressure. */
export interface Exporter extends RowSink {
  /** Writes what is still buffered; called after the last row. */
  finish(): Promise<void>
  /** Releases temporary resources; always called, also after an error. */
  dispose(): Promise<void>
}

type Write = (chunk: Uint8Array) => Promise<void>

export function createExporter(format: ExportFormat, write: Write): Exporter {
  return format === 'csv' ? csvExporter(write) : parquetExporter(write)
}

// ---------------------------------------------------------------------------------------------
// CSV (RFC 4180) with `;` as separator and a UTF-8 BOM, see `csvField`.

function csvExporter(write: Write): Exporter {
  const encoder = new TextEncoder()
  let header: string | undefined
  const line = (fields: CellValue[]) => `${fields.map(csvField).join(';')}\r\n`
  const takeHeader = () => {
    const h = header ?? ''
    header = ''
    return h
  }
  return {
    columns: (columns) => {
      header = `\uFEFF${line(columns.map(c => c.name))}`
    },
    rows: rows => write(encoder.encode(takeHeader() + rows.map(line).join(''))),
    finish: async () => {
      if (header) await write(encoder.encode(takeHeader()))
    },
    dispose: async () => {},
  }
}

// ---------------------------------------------------------------------------------------------
// Parquet needs its footer at the end and one type per column for the whole file, so rows are staged as
// JSON lines in a temporary file (bounded memory) while each column is checked against its target type.
// `finish` reads them back in row groups and encodes them with hyparquet-writer.

type SchemaElement = ConstructorParameters<typeof ParquetWriter>[0]['schema'][number]

/** A Parquet column type and the conversion of a value into it; `undefined` = the value does not fit. */
interface Target {
  element: Omit<SchemaElement, 'name'>
  convert: (v: CellValue) => unknown
}

const STRING: Target = { element: { type: 'BYTE_ARRAY', converted_type: 'UTF8', logical_type: { type: 'STRING' } }, convert: cellText }

const BOOLEANS = new Map([['true', true], ['t', true], ['1', true], ['false', false], ['f', false], ['0', false]])

function integer(bits: 16 | 32 | 64): Target {
  const limit = 2n ** BigInt(bits - 1)
  return {
    element: bits === 64 ? { type: 'INT64' } : bits === 32 ? { type: 'INT32' } : { type: 'INT32', converted_type: 'INT_16' },
    convert: (v) => {
      const text = typeof v === 'number' || typeof v === 'string' ? String(v).trim() : ''
      if (!/^[+-]?\d+$/.test(text)) return undefined
      const n = BigInt(text)
      if (n < -limit || n >= limit) return undefined
      return bits === 64 ? n : Number(n)
    },
  }
}

function float(type: 'FLOAT' | 'DOUBLE'): Target {
  return {
    element: { type },
    convert: (v) => {
      if (typeof v === 'number') return v
      if (typeof v !== 'string' || v.trim() === '') return undefined
      return v === 'NaN' ? NaN : Number.isNaN(Number(v)) ? undefined : Number(v)
    },
  }
}

/** Converts to the unscaled integer; digits beyond the scale are rounded half away from zero. */
function decimal(precision: number, scale: number): Target {
  const type = precision <= 9 ? 'INT32' : precision <= 18 ? 'INT64' : 'FIXED_LEN_BYTE_ARRAY'
  const limit = 10n ** BigInt(precision)
  return {
    element: {
      type,
      type_length: type === 'FIXED_LEN_BYTE_ARRAY' ? 16 : undefined,
      converted_type: 'DECIMAL',
      precision,
      scale,
      logical_type: { type: 'DECIMAL', precision, scale },
    },
    convert: (v) => {
      const m = (typeof v === 'number' ? v.toFixed(scale) : typeof v === 'string' ? v.trim() : '').match(/^([+-]?)(\d*)(?:\.(\d*))?$/)
      if (!m || !(m[2] || m[3])) return undefined
      const [, sign, int, frac = ''] = m
      let n = BigInt(int + frac.slice(0, scale).padEnd(scale, '0'))
      if (frac.length > scale && frac[scale]! >= '5') n++
      if (n >= limit) return undefined
      return sign === '-' ? -n : n
    },
  }
}

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/
const MICROS_PER_DAY = 86_400_000_000n

/** Microseconds since the epoch of an ISO date or timestamp (as the drivers return them); a missing zone counts as UTC. */
function parseTimestamp(v: CellValue): { micros: bigint, time: boolean, zone: boolean } | undefined {
  const m = typeof v === 'string' ? v.match(TIMESTAMP) : null
  if (!m) return undefined
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(x => Number(x ?? 0)) as [number, number, number, number, number, number]
  const date = new Date(Date.UTC(2000, 0, 1, h, mi, s))
  date.setUTCFullYear(y, mo - 1, d)
  // Date rolls invalid fields over (Feb 30 → Mar 2); such values do not convert.
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || date.getUTCHours() !== h || date.getUTCMinutes() !== mi || date.getUTCSeconds() !== s) return undefined
  const zone = m[8]?.match(/^([+-])(\d{2}):?(\d{2})?$/)
  const offset = zone ? (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3] ?? 0)) * 60_000 : 0
  const micros = BigInt(date.getTime() - offset) * 1000n + BigInt((m[7] ?? '').padEnd(6, '0').slice(0, 6))
  return { micros, time: m[4] !== undefined, zone: m[8] !== undefined }
}

const DATE: Target = {
  element: { type: 'INT32', converted_type: 'DATE', logical_type: { type: 'DATE' } },
  convert: (v) => {
    const t = parseTimestamp(v)
    return t && !t.time && !t.zone ? Number(t.micros / MICROS_PER_DAY) : undefined
  },
}

const TIME: Target = {
  element: { type: 'INT64', logical_type: { type: 'TIME', isAdjustedToUTC: false, unit: 'MICROS' } },
  convert: (v) => {
    const m = typeof v === 'string' ? v.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/) : null
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3]) > 59) return undefined
    return BigInt((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1_000_000n + BigInt((m[4] ?? '').padEnd(6, '0').slice(0, 6))
  },
}

function timestamp(utc: boolean): Target {
  return {
    element: { type: 'INT64', logical_type: { type: 'TIMESTAMP', isAdjustedToUTC: utc, unit: 'MICROS' } },
    convert: (v) => {
      const t = parseTimestamp(v)
      return t && (utc || !t.zone) ? t.micros : undefined
    },
  }
}

const UUID: Target = {
  element: { type: 'FIXED_LEN_BYTE_ARRAY', type_length: 16, logical_type: { type: 'UUID' } },
  convert: v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined,
}

/** Best-effort mapping of driver type names to Parquet types; unknown types become strings. */
function parquetTarget(type: string): Target | undefined {
  const t = type.toLowerCase()
  const dec = t.match(/^(?:decimal|numeric)\((\d+),\s*(\d+)\)$/)
  if (dec) return Number(dec[1]) <= 38 ? decimal(Number(dec[1]), Number(dec[2])) : undefined
  if (/^(bool|boolean|bit)$/.test(t)) return { element: { type: 'BOOLEAN' }, convert: v => typeof v === 'boolean' ? v : BOOLEANS.get(String(v).toLowerCase()) }
  if (/^(tinyint|smallint|int2|tiny|short|utinyint)$/.test(t)) return integer(16)
  if (/^(int|integer|int4|int24|mediumint|year|usmallint)$/.test(t)) return integer(32)
  if (/^(bigint|int8|long|longlong|uinteger)$/.test(t)) return integer(64)
  if (/^(real|float4)$/.test(t)) return float('FLOAT')
  if (/^(double|double precision|float|float8)$/.test(t)) return float('DOUBLE')
  if (/^(date|newdate)$/.test(t)) return DATE
  if (/^(time|time without time zone)$/.test(t)) return TIME
  if (/^(timestamp with time zone|timestamptz|datetimeoffset)$/.test(t)) return timestamp(true)
  if (/^(timestamp2?|timestamp without time zone|datetime2?|smalldatetime|timestamp_(s|ms|ns))$/.test(t)) return timestamp(false)
  if (/^(uuid|uniqueidentifier)$/.test(t)) return UUID
  return undefined
}

/** Parquet columns are addressed by name, so repeated names (e.g. `id` of a join) get a suffix. */
function uniqueNames(columns: ResultColumn[]): string[] {
  const seen = new Set<string>()
  return columns.map(({ name }) => {
    let unique = name
    for (let i = 1; seen.has(unique); i++) unique = `${name}_${i}`
    seen.add(unique)
    return unique
  })
}

/** Hands the buffered bytes to `write` after every row group and at the end. */
class ChunkWriter extends ByteWriter {
  constructor(private out: Write) {
    super()
  }

  async flush() {
    await this.out(this.getBytes().slice())
    this.index = 0
  }

  override finish() {
    return this.flush()
  }
}

const ROW_GROUP = 100_000

function parquetExporter(write: Write): Exporter {
  let columns: ResultColumn[] | undefined
  let targets: (Target | undefined)[] = []
  let staging: Promise<{ dir: string, file: FileHandle }> | undefined
  const stage = () => (staging ??= mkdtemp(join(tmpdir(), 'dbm-export-')).then(async dir => ({ dir, file: await open(join(dir, 'rows.jsonl'), 'w') })))
  return {
    columns: (c) => {
      columns = c
      targets = c.map(column => parquetTarget(column.type))
    },
    rows: async (rows) => {
      const { file } = await stage()
      // A target type is only used when every value of the column converts; otherwise the column becomes a string.
      for (const row of rows) {
        row.forEach((v, i) => {
          if (v !== null && targets[i]?.convert(v) === undefined) targets[i] = undefined
        })
      }
      await file.write(rows.map(row => `${JSON.stringify(row)}\n`).join(''))
    },
    finish: async () => {
      if (!columns) throw new DbError('The statement returned no result set.')
      const { dir, file } = await stage()
      await file.close()
      const names = uniqueNames(columns)
      const types = targets.map(t => t ?? STRING)
      const writer = new ParquetWriter({
        writer: new ChunkWriter(write),
        schema: [{ name: 'root', num_children: names.length }, ...names.map((name, i) => ({ name, repetition_type: 'OPTIONAL' as const, ...types[i]!.element }))],
      })
      let batch: CellValue[][] = []
      const writeGroup = async () => {
        await writer.write({ columnData: names.map((name, i) => ({ name, data: batch.map(row => row[i] === null ? null : types[i]!.convert(row[i]!)) })), rowGroupSize: ROW_GROUP })
        batch = []
      }
      for await (const line of createInterface({ input: createReadStream(join(dir, 'rows.jsonl')), crlfDelay: Infinity })) {
        batch.push(JSON.parse(line))
        if (batch.length === ROW_GROUP) await writeGroup()
      }
      if (batch.length) await writeGroup()
      await writer.finish()
    },
    dispose: async () => {
      await staging?.then(async ({ dir, file }) => {
        await file.close().catch(() => {})
        await rm(dir, { recursive: true, force: true })
      }, () => {})
    },
  }
}
