import { createReadStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareDuckdb } from './registry.ts'
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
// Parquet needs its footer at the end, so rows are staged in a temporary on-disk DuckDB database
// (bounded memory) and converted with DuckDB's Parquet writer; the finished file is then copied to `write`.

/** Best-effort mapping of driver type names to DuckDB types; unknown types stay VARCHAR. */
function duckdbType(type: string): string | undefined {
  const t = type.toLowerCase()
  const dec = t.match(/^(?:decimal|numeric)\((\d+),\s*(\d+)\)$/)
  if (dec) return Number(dec[1]) <= 38 ? `DECIMAL(${dec[1]},${dec[2]})` : undefined
  if (/^(bool|boolean|bit)$/.test(t)) return 'BOOLEAN'
  if (/^(tinyint|smallint|int2|tiny|short|utinyint)$/.test(t)) return 'SMALLINT'
  if (/^(int|integer|int4|int24|mediumint|year|usmallint)$/.test(t)) return 'INTEGER'
  if (/^(bigint|int8|long|longlong|uinteger)$/.test(t)) return 'BIGINT'
  if (/^(real|float4)$/.test(t)) return 'REAL'
  if (/^(double|double precision|float|float8)$/.test(t)) return 'DOUBLE'
  if (/^(date|newdate)$/.test(t)) return 'DATE'
  if (/^(time|time without time zone)$/.test(t)) return 'TIME'
  if (/^(timestamp with time zone|timestamptz|datetimeoffset)$/.test(t)) return 'TIMESTAMPTZ'
  if (/^(timestamp2?|timestamp without time zone|datetime2?|smalldatetime|timestamp_(s|ms|ns))$/.test(t)) return 'TIMESTAMP'
  if (/^(uuid|uniqueidentifier)$/.test(t)) return 'UUID'
  return undefined
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

function parquetExporter(write: Write): Exporter {
  let columns: ResultColumn[] | undefined
  let staging: Promise<Staging> | undefined
  const stage = () => (staging ??= openStaging(columns!))
  return {
    columns: (c) => {
      columns = c
    },
    rows: async (rows) => {
      const { appender } = await stage()
      for (const row of rows) {
        for (const v of row) {
          if (v === null) appender.appendNull()
          else appender.appendVarchar(cellText(v))
        }
        appender.endRow()
      }
    },
    finish: async () => {
      if (!columns) throw new DbError('The statement returned no result set.')
      const { conn, appender, dir } = await stage()
      appender.closeSync()
      // A target type is only used when every value of the column converts; otherwise it stays VARCHAR.
      const targets = columns.map(c => duckdbType(c.type))
      const checks = targets.map((t, i) => t ? `count(*) filter (where c${i} is not null and try_cast(c${i} as ${t}) is null) = 0` : 'false')
      const ok = (await conn.runAndReadAll(`select ${checks.join(', ')} from staging`)).getRows()[0] as boolean[]
      const select = columns.map((c, i) => `${ok[i] ? `cast(c${i} as ${targets[i]})` : `c${i}`} as ${quote(c.name)}`)
      const file = join(dir, 'export.parquet')
      await conn.run(`copy (select ${select.join(', ')} from staging) to '${file.replaceAll("'", "''")}' (format parquet)`)
      for await (const chunk of createReadStream(file)) await write(chunk as Uint8Array)
    },
    dispose: async () => {
      await staging?.then(s => s.dispose(), () => {})
    },
  }
}

type Staging = Awaited<ReturnType<typeof openStaging>>

async function openStaging(columns: ResultColumn[]) {
  await prepareDuckdb()
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const dir = await mkdtemp(join(tmpdir(), 'dbm-export-'))
  const instance = await DuckDBInstance.create(join(dir, 'staging.duckdb'))
  const conn = await instance.connect()
  const dispose = () => {
    conn.closeSync()
    instance.closeSync()
    return rm(dir, { recursive: true, force: true })
  }
  try {
    await conn.run(`create table staging (${columns.map((_, i) => `c${i} varchar`).join(', ')})`)
    return { dir, conn, appender: await conn.createAppender('staging'), dispose }
  } catch (e) {
    await dispose()
    throw e
  }
}
