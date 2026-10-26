import { assertEquals } from 'jsr:@std/assert@1'
import { DuckDBInstance } from '@duckdb/node-api'
import { createExporter, type ExportFormat } from '../core/export.ts'
import type { CellValue, ResultColumn } from '../core/types.ts'

const columns: ResultColumn[] = [
  { name: 'id', type: 'integer' },
  { name: 'dec', type: 'numeric(12,2)' },
  { name: 'ts', type: 'timestamp without time zone' },
  { name: 'text', type: 'text' },
  { name: 'json', type: 'jsonb' },
  // Declared as integer, but a value does not convert: must stay VARCHAR instead of failing.
  { name: 'odd', type: 'integer' },
]
const rows: CellValue[][] = [
  [1, '12.50', '2024-01-02T03:04:05.123456', 'a,"b"\nc', { k: [1] }, '7'],
  [2, null, null, '', null, 'x'],
]

async function encode(format: ExportFormat): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const exporter = createExporter(format, async chunk => void chunks.push(chunk))
  try {
    exporter.columns(columns)
    await exporter.rows(rows.slice(0, 1))
    await exporter.rows(rows.slice(1))
    await exporter.finish()
  } finally {
    await exporter.dispose()
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  chunks.reduce((offset, c) => (out.set(c, offset), offset + c.length), 0)
  return out
}

Deno.test('export: csv quotes fields and distinguishes NULL from empty string', async () => {
  assertEquals(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await encode('csv')), [
    '\uFEFF"id";"dec";"ts";"text";"json";"odd"',
    '"1";"12.50";"2024-01-02T03:04:05.123456";"a,""b""\nc";"{""k"":[1]}";"7"',
    '"2";;;"";;"x"',
    '',
  ].join('\r\n'))
})

Deno.test('export: parquet keeps types where every value converts', async () => {
  const dir = await Deno.makeTempDir()
  try {
    const file = `${dir}/out.parquet`
    await Deno.writeFile(file, await encode('parquet'))
    const conn = await (await DuckDBInstance.create()).connect()
    const types = (await conn.runAndReadAll(`select column_name, column_type from (describe select * from '${file}')`)).getRows()
    assertEquals(types, [['id', 'INTEGER'], ['dec', 'DECIMAL(12,2)'], ['ts', 'TIMESTAMP'], ['text', 'VARCHAR'], ['json', 'VARCHAR'], ['odd', 'VARCHAR']])
    const values = (await conn.runAndReadAll(`select dec::varchar, ts::varchar, text, json, odd from '${file}' order by id`)).getRows()
    assertEquals(values, [['12.50', '2024-01-02 03:04:05.123456', 'a,"b"\nc', '{"k":[1]}', '7'], [null, null, '', null, 'x']])
    conn.closeSync()
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
