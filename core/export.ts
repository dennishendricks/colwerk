import { createReadStream } from 'node:fs'
import { type FileHandle, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { createDeflateRaw, crc32 } from 'node:zlib'
import { ByteWriter, ParquetWriter } from 'hyparquet-writer'
import type { SplitDialect } from './sql-split.ts'
import { insertSql, maxInsertRows } from './sql-literals.ts'
import { cellText, csvField, jsonRecord, markdownField, markdownTable, uniqueNames } from './values.ts'
import { AppError, type CellValue, type ResultColumn, type RowSink } from './types.ts'

export type ExportFormat = 'csv' | 'parquet' | 'xlsx' | 'json' | 'ndjson' | 'markdown' | 'insert'
export const exportFormats: ExportFormat[] = ['csv', 'parquet', 'xlsx', 'json', 'ndjson', 'markdown', 'insert']

/** What the INSERT format needs: the dialect of the source connection, the target table and rows per statement. */
export interface ExportOptions {
  dialect: SplitDialect
  table: string[]
  batchSize: number
}

/** A sink that encodes rows; `write` is awaited for backpressure. */
export interface Exporter extends RowSink {
  /** Writes what is still buffered; called after the last row. */
  finish(): Promise<void>
  /** Releases temporary resources; always called, also after an error. */
  dispose(): Promise<void>
}

type Write = (chunk: Uint8Array) => Promise<void>

export function createExporter(format: ExportFormat, write: Write, options?: ExportOptions): Exporter {
  switch (format) {
    case 'csv':
      return csvExporter(write)
    case 'parquet':
      return parquetExporter(write)
    case 'xlsx':
      return xlsxExporter(write)
    case 'json':
      return jsonExporter(write)
    case 'ndjson':
      return ndjsonExporter(write)
    case 'markdown':
      return markdownExporter(write)
    case 'insert':
      if (!options) throw new AppError('insertTableRequired', 'The target table for INSERT statements is missing.')
      return insertExporter(write, options)
  }
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
      header = `\uFEFF${line(columns.map((c) => c.name))}`
    },
    rows: (rows) => write(encoder.encode(takeHeader() + rows.map(line).join(''))),
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

const STRING: Target = {
  element: { type: 'BYTE_ARRAY', converted_type: 'UTF8', logical_type: { type: 'STRING' } },
  convert: cellText,
}

const BOOLEANS = new Map([
  ['true', true],
  ['t', true],
  ['1', true],
  ['false', false],
  ['f', false],
  ['0', false],
])

function integer(bits: 16 | 32 | 64): Target {
  const limit = 2n ** BigInt(bits - 1)
  return {
    element:
      bits === 64 ? { type: 'INT64' } : bits === 32 ? { type: 'INT32' } : { type: 'INT32', converted_type: 'INT_16' },
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
      const m = (typeof v === 'number' ? v.toFixed(scale) : typeof v === 'string' ? v.trim() : '').match(
        /^([+-]?)(\d*)(?:\.(\d*))?$/,
      )
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
function parseTimestamp(v: CellValue): { micros: bigint; time: boolean; zone: boolean } | undefined {
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
    return (
      BigInt((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1_000_000n +
      BigInt((m[4] ?? '').padEnd(6, '0').slice(0, 6))
    )
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
  convert: (v) =>
    typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined,
}

/** Best-effort mapping of driver type names to Parquet types; unknown types become strings. */
function parquetTarget(type: string): Target | undefined {
  const t = type.toLowerCase()
  const dec = t.match(/^(?:decimal|numeric)\((\d+),\s*(\d+)\)$/)
  if (dec) return Number(dec[1]) <= 38 ? decimal(Number(dec[1]), Number(dec[2])) : undefined
  if (/^(bool|boolean|bit)$/.test(t)) {
    return {
      element: { type: 'BOOLEAN' },
      convert: (v) => (typeof v === 'boolean' ? v : BOOLEANS.get(String(v).toLowerCase())),
    }
  }
  if (/^(tinyint|smallint|int2|tiny|short|utinyint)$/.test(t)) return integer(16)
  if (/^(int|integer|int4|int24|mediumint|year|usmallint)$/.test(t)) return integer(32)
  if (/^(bigint|int8|long|longlong|uinteger)$/.test(t)) return integer(64)
  if (/^(real|float4)$/.test(t)) return float('FLOAT')
  if (/^(double|double precision|float|float8)$/.test(t)) return float('DOUBLE')
  if (/^(date|newdate)$/.test(t)) return DATE
  if (/^(time|time without time zone)$/.test(t)) return TIME
  if (/^(timestamp with time zone|timestamptz|datetimeoffset)$/.test(t)) return timestamp(true)
  if (/^(timestamp2?|timestamp without time zone|datetime2?|smalldatetime|timestamp_(s|ms|ns))$/.test(t)) {
    return timestamp(false)
  }
  if (/^(uuid|uniqueidentifier)$/.test(t)) return UUID
  return undefined
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
  let staging: Promise<{ dir: string; file: FileHandle }> | undefined
  const stage = () =>
    (staging ??= mkdtemp(join(tmpdir(), 'colwerk-export-')).then(async (dir) => ({
      dir,
      file: await open(join(dir, 'rows.jsonl'), 'w'),
    })))
  return {
    columns: (c) => {
      columns = c
      targets = c.map((column) => parquetTarget(column.type))
    },
    rows: async (rows) => {
      const { file } = await stage()
      // A target type is only used when every value of the column converts; otherwise the column becomes a string.
      for (const row of rows) {
        row.forEach((v, i) => {
          if (v !== null && targets[i]?.convert(v) === undefined) targets[i] = undefined
        })
      }
      await file.write(rows.map((row) => `${JSON.stringify(row)}\n`).join(''))
    },
    finish: async () => {
      if (!columns) throw new AppError('noResultSet', 'The statement returned no result set.')
      const { dir, file } = await stage()
      await file.close()
      const names = uniqueNames(columns.map((c) => c.name))
      const types = targets.map((t) => t ?? STRING)
      const writer = new ParquetWriter({
        writer: new ChunkWriter(write),
        schema: [
          { name: 'root', num_children: names.length },
          ...names.map((name, i) => ({ name, repetition_type: 'OPTIONAL' as const, ...types[i]!.element })),
        ],
      })
      let batch: CellValue[][] = []
      const writeGroup = async () => {
        await writer.write({
          columnData: names.map((name, i) => ({
            name,
            data: batch.map((row) => (row[i] === null ? null : types[i]!.convert(row[i]!))),
          })),
          rowGroupSize: ROW_GROUP,
        })
        batch = []
      }
      for await (const line of createInterface({
        input: createReadStream(join(dir, 'rows.jsonl')),
        crlfDelay: Infinity,
      })) {
        batch.push(JSON.parse(line))
        if (batch.length === ROW_GROUP) await writeGroup()
      }
      if (batch.length) await writeGroup()
      await writer.finish()
    },
    dispose: async () => {
      await staging?.then(
        async ({ dir, file }) => {
          await file.close().catch(() => {})
          await rm(dir, { recursive: true, force: true })
        },
        () => {},
      )
    },
  }
}

// ---------------------------------------------------------------------------------------------
// JSON, NDJSON, Markdown and INSERT write every batch as it arrives. Like CSV, `columns` is synchronous and the
// head of the file follows with the first batch (or in `finish`).

const encoder = new TextEncoder()
const needColumns = () => new AppError('noResultSet', 'The statement returned no result set.')

// A JSON array of objects, one per line; `[]` without rows.
function jsonExporter(write: Write): Exporter {
  let names: string[] | undefined
  let first = true
  return {
    columns: (columns) => {
      names = uniqueNames(columns.map((c) => c.name))
    },
    rows: async (rows) => {
      if (!rows.length) return
      const lines = rows.map((row) => `\n${jsonRecord(names!, row)}`)
      await write(encoder.encode((first ? '[' : ',') + lines.join(',')))
      first = false
    },
    finish: async () => {
      if (!names) throw needColumns()
      await write(encoder.encode(first ? '[]\n' : '\n]\n'))
    },
    dispose: async () => {},
  }
}

// Newline-delimited JSON: one object per line, no enclosing array.
function ndjsonExporter(write: Write): Exporter {
  let names: string[] | undefined
  return {
    columns: (columns) => {
      names = uniqueNames(columns.map((c) => c.name))
    },
    rows: (rows) => write(encoder.encode(rows.map((row) => `${jsonRecord(names!, row)}\n`).join(''))),
    finish: async () => {
      if (!names) throw needColumns()
    },
    dispose: async () => {},
  }
}

// A Markdown table; header and separator are written even without rows.
function markdownExporter(write: Write): Exporter {
  let names: string[] | undefined
  let head: string | undefined
  const takeHead = () => {
    const h = head ?? ''
    head = ''
    return h
  }
  return {
    columns: (columns) => {
      names = columns.map((c) => c.name)
      head = `${markdownTable(names, [])}\n`
    },
    rows: (rows) =>
      write(
        encoder.encode(
          takeHead() +
            rows.map((row) => `| ${names!.map((_, i) => markdownField(row[i] ?? null)).join(' | ')} |\n`).join(''),
        ),
      ),
    finish: async () => {
      if (!names) throw needColumns()
      if (head) await write(encoder.encode(takeHead()))
    },
    dispose: async () => {},
  }
}

// INSERT statements in the dialect of the source connection, `batchSize` rows per statement.
function insertExporter(write: Write, { dialect, table, batchSize }: ExportOptions): Exporter {
  const size = Math.min(batchSize, maxInsertRows(dialect))
  let columns: { name: string; type: string }[] | undefined
  let buffer: CellValue[][] = []
  const flush = async (all: boolean) => {
    while (buffer.length >= (all ? 1 : size)) {
      const batch = buffer.splice(0, size)
      await write(encoder.encode(`${insertSql(dialect, table, columns!, batch)};\n\n`))
    }
  }
  return {
    columns: (c) => {
      const names = uniqueNames(c.map((column) => column.name))
      columns = c.map((column, i) => ({ name: names[i]!, type: column.type }))
    },
    rows: async (rows) => {
      buffer.push(...rows)
      await flush(false)
    },
    finish: async () => {
      if (!columns) throw needColumns()
      await flush(true)
    },
    dispose: async () => {
      buffer = []
    },
  }
}

// ---------------------------------------------------------------------------------------------
// XLSX: one sheet with inline strings (no shared-strings table, so a single pass is enough), written through a
// streaming deflate into a minimal ZIP container. No ZIP64: results beyond the limits of the format fail.

const ZIP_MAX = 0xffffffff
const xlsxLimit = () =>
  new AppError('xlsxLimit', 'The result exceeds the limits of an Excel sheet (1,048,576 rows, 16,384 columns, 4 GB).')

/** Minimal ZIP writer: deflated entries with data descriptors, streamed one after another; central directory at the end. */
class ZipWriter {
  private offset = 0
  private entries: { name: Uint8Array; crc: number; csize: number; usize: number; offset: number }[] = []
  constructor(private out: Write) {}

  private async emit(bytes: Uint8Array) {
    this.offset += bytes.length
    if (this.offset > ZIP_MAX) throw xlsxLimit()
    await this.out(bytes)
  }

  /** Little-endian record: signature followed by `[size, value]` fields. */
  private static record(signature: number, fields: [number, number][], name?: Uint8Array): Uint8Array {
    const length = 4 + fields.reduce((n, [size]) => n + size, 0)
    const bytes = new Uint8Array(length + (name?.length ?? 0))
    const view = new DataView(bytes.buffer)
    view.setUint32(0, signature, true)
    let at = 4
    for (const [size, value] of fields) {
      if (size === 2) view.setUint16(at, value, true)
      else view.setUint32(at, value, true)
      at += size
    }
    if (name) bytes.set(name, length)
    return bytes
  }

  /** Starts an entry; its data is deflated as it is written. */
  entry(name: string): { write(data: Uint8Array): Promise<void>; close(): Promise<void> } {
    const nameBytes = encoder.encode(name)
    const offset = this.offset
    const z = createDeflateRaw()
    let crc = 0
    let csize = 0
    let usize = 0
    let pending = this.emit(
      ZipWriter.record(
        0x04034b50,
        [
          [2, 20],
          [2, 0x0808],
          [2, 8],
          [2, 0],
          [2, 0x0021],
          [4, 0],
          [4, 0],
          [4, 0],
          [2, nameBytes.length],
          [2, 0],
        ],
        nameBytes,
      ),
    )
    z.on('data', (chunk: Buffer) => {
      csize += chunk.length
      pending = pending.then(() => this.emit(chunk))
    })
    return {
      write: async (data) => {
        crc = crc32(data, crc)
        usize += data.length
        if (usize > ZIP_MAX) throw xlsxLimit()
        if (!z.write(data)) await once(z, 'drain')
        await pending
      },
      close: async () => {
        const ended = once(z, 'end')
        z.end()
        await ended
        await pending
        await this.emit(
          ZipWriter.record(0x08074b50, [
            [4, crc >>> 0],
            [4, csize],
            [4, usize],
          ]),
        )
        this.entries.push({ name: nameBytes, crc: crc >>> 0, csize, usize, offset })
      },
    }
  }

  /** Central directory and end record. */
  async finish() {
    const start = this.offset
    for (const e of this.entries) {
      await this.emit(
        ZipWriter.record(
          0x02014b50,
          [
            [2, 20],
            [2, 20],
            [2, 0x0808],
            [2, 8],
            [2, 0],
            [2, 0x0021],
            [4, e.crc],
            [4, e.csize],
            [4, e.usize],
            [2, e.name.length],
            [2, 0],
            [2, 0],
            [2, 0],
            [2, 0],
            [4, 0],
            [4, e.offset],
          ],
          e.name,
        ),
      )
    }
    const size = this.offset - start
    const count = this.entries.length
    await this.emit(
      ZipWriter.record(0x06054b50, [
        [2, 0],
        [2, 0],
        [2, count],
        [2, count],
        [4, size],
        [4, start],
        [2, 0],
      ]),
    )
  }
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

// Styles of `xlsxCell`: 1 header (bold), 2 date, 3 date-time, 4 time.
const XLSX_PARTS: [string, string][] = [
  [
    '[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/xl/workbook.xml" ContentType="${OFFICE_TYPE}.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${OFFICE_TYPE}.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="${OFFICE_TYPE}.styles+xml"/></Types>`,
  ],
  [
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  ],
  [
    'xl/workbook.xml',
    `${XML_HEAD}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Result" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  ],
  [
    'xl/_rels/workbook.xml.rels',
    `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL}">` +
      `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  ],
  [
    'xl/styles.xml',
    `${XML_HEAD}<styleSheet xmlns="${NS}">` +
      '<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>' +
      '<numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/><numFmt numFmtId="166" formatCode="hh:mm:ss"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  ],
]

const XLSX_SHEET_START =
  `${XML_HEAD}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0">` +
  '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'

type XlsxKind = 'number' | 'date' | 'time' | 'datetime' | 'text'

// Same numeric types as `NUMERIC_TYPE` in sql-literals.ts.
const NUMERIC_TYPE =
  /^(?:u?int\d*|tinyint|smallint|mediumint|bigint|integer|hugeint|uhugeint|ubigint|uinteger|usmallint|utinyint|decimal|numeric|dec|float\d*|double|real|money|smallmoney)\b/
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
const TIME_OF_DAY = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/
const EXCEL_EPOCH = 25569 // 1970-01-01 as Excel serial
const EXCEL_LEAP_BUG = 61 // 1900-03-01: earlier dates are off by one in Excel

function xlsxKind(type: string): XlsxKind {
  const t = type.toLowerCase().replace(/^(?:(?:nullable|lowcardinality)\()*/, '')
  if (NUMERIC_TYPE.test(t)) return 'number'
  if (/^(date|newdate|date32)$/.test(t)) return 'date'
  if (/^time( without time zone)?(\(\d\))?$/.test(t)) return 'time'
  if (/timestamp|datetime|smalldatetime/.test(t)) return 'datetime'
  return 'text'
}

/** Column letters: A…Z, AA…, up to XFD. */
function columnName(i: number): string {
  let name = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

// Characters invalid in XML 1.0.
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

const textCell = (ref: string, text: string, style = '') =>
  `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text
    // Excel holds at most 32,767 characters per cell.
    .replace(XML_INVALID, '')
    .slice(0, 32767)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')}</t></is></c>`

/** One cell, NULL excluded; what does not fit its column's kind stays text. */
function xlsxCell(value: CellValue, kind: XlsxKind, ref: string): string {
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
  if (typeof value === 'string') {
    // Beyond 15 significant digits a number would lose precision in Excel.
    if (kind === 'number' && NUMBER.test(value) && value.split(/e/i)[0]!.replace(/^[+-]?[0.]*|\./g, '').length <= 15) {
      return `<c r="${ref}"><v>${value}</v></c>`
    }
    if (kind === 'time') {
      const m = value.match(TIME_OF_DAY)
      if (m && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3]) < 60) {
        const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4] ?? 0}`)
        return `<c r="${ref}" s="4"><v>${seconds / 86400}</v></c>`
      }
    } else if (kind === 'date' || kind === 'datetime') {
      const t = parseTimestamp(value)
      const serial = t ? Number(t.micros) / 86_400_000_000 + EXCEL_EPOCH : 0
      if (t && serial >= EXCEL_LEAP_BUG) return `<c r="${ref}" s="${kind === 'date' ? 2 : 3}"><v>${serial}</v></c>`
    }
  }
  return textCell(ref, cellText(value))
}

function xlsxExporter(write: Write): Exporter {
  const zip = new ZipWriter(write)
  let kinds: XlsxKind[] | undefined
  let names: string[] = []
  let sheet: ReturnType<ZipWriter['entry']> | undefined
  let row = 1
  const start = async () => {
    if (sheet) return sheet
    for (const [name, xml] of XLSX_PARTS) {
      const part = zip.entry(name)
      await part.write(encoder.encode(xml))
      await part.close()
    }
    sheet = zip.entry('xl/worksheets/sheet1.xml')
    const header = names.map((n, i) => textCell(`${columnName(i)}1`, n, ' s="1"')).join('')
    await sheet.write(encoder.encode(`${XLSX_SHEET_START}<row r="1">${header}</row>`))
    return sheet
  }
  return {
    columns: (columns) => {
      if (columns.length > 16384) throw xlsxLimit()
      names = columns.map((c) => c.name)
      kinds = columns.map((c) => xlsxKind(c.type))
    },
    rows: async (rows) => {
      const entry = await start()
      if (row - 1 + rows.length > 1_048_575) throw xlsxLimit()
      const xml = rows.map((cells) => {
        row++
        const cs = cells.map((v, i) => (v === null ? '' : xlsxCell(v, kinds![i] ?? 'text', `${columnName(i)}${row}`)))
        return `<row r="${row}">${cs.join('')}</row>`
      })
      await entry.write(encoder.encode(xml.join('')))
    },
    finish: async () => {
      if (!kinds) throw needColumns()
      const entry = await start()
      await entry.write(encoder.encode('</sheetData></worksheet>'))
      await entry.close()
      await zip.finish()
    },
    dispose: async () => {},
  }
}
