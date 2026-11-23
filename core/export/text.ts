// Text formats that write every batch as it arrives: CSV, JSON, NDJSON, Markdown and INSERT statements.
import { Buffer } from 'node:buffer'
import { insertSql, maxInsertRows } from '../sql-literals.ts'
import {
  type CsvOptions,
  csvLine,
  defaultCsvOptions,
  jsonRecord,
  markdownField,
  markdownTable,
  uniqueNames,
} from '../values.ts'
import type { CellValue } from '../types.ts'
import { encoder, type Exporter, type ExportOptions, needColumns, type Write } from './common.ts'

// CSV with the separator, quoting and encoding of the settings, see `csvField`; CRLF line endings.
export function csvExporter(write: Write, options: CsvOptions = defaultCsvOptions): Exporter {
  let header: string | undefined
  const encode = textEncoder(options.encoding)
  const line = (fields: CellValue[]) => `${csvLine(fields, options)}\r\n`
  const takeHeader = () => {
    const h = header ?? ''
    header = ''
    return h
  }
  const bom = options.encoding === 'utf-8-bom' || options.encoding === 'utf-16le' ? '\uFEFF' : ''
  return {
    columns: (columns) => {
      header = bom + line(columns.map((c) => c.name))
    },
    rows: (rows) => write(encode(takeHeader() + rows.map(line).join(''))),
    finish: async () => {
      if (header) await write(encode(takeHeader()))
    },
    dispose: async () => {},
  }
}

// Windows-1252 has no encoder in TextEncoder: the table is the inverse of its decoder. Characters it cannot hold
// become `?`.
let cp1252: Map<string, number> | undefined
function textEncoder(encoding: CsvOptions['encoding']): (text: string) => Uint8Array {
  if (encoding === 'utf-16le') return (text) => Buffer.from(text, 'utf16le')
  if (encoding !== 'windows-1252') return (text) => encoder.encode(text)
  cp1252 ??= new Map(
    Array.from(new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i)), (c, i) => [c, i]),
  )
  const table = cp1252
  return (text) => Uint8Array.from(text, (c) => table.get(c) ?? 0x3f)
}

// JSON, NDJSON, Markdown and INSERT write every batch as it arrives. Like CSV, `columns` is synchronous and the
// head of the file follows with the first batch (or in `finish`).

// A JSON array of objects, one per line; `[]` without rows.
export function jsonExporter(write: Write): Exporter {
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
export function ndjsonExporter(write: Write): Exporter {
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
export function markdownExporter(write: Write): Exporter {
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
export function insertExporter(write: Write, { dialect, table, batchSize }: ExportOptions): Exporter {
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
