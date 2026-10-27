import { assertEquals } from 'jsr:@std/assert@1'
import { duckdbDriver } from '../core/drivers/duckdb.ts'
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
const table = { columns, rows }

async function encode(format: ExportFormat, { columns, rows } = table): Promise<Uint8Array> {
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

async function readParquet(data: Uint8Array, sql: (file: string) => string[]): Promise<CellValue[][][]> {
  const dir = await Deno.makeTempDir()
  const session = await duckdbDriver.connect({ id: 'export-test', name: 'duck', dialect: 'duckdb', file: ':memory:' })
  try {
    const file = `${dir}/out.parquet`
    await Deno.writeFile(file, data)
    const results = []
    for (const query of sql(`'${file}'`)) results.push((await session.execute(query, { rowLimit: 100 })).resultSets[0]!.rows)
    return results
  } finally {
    await session.close()
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test('export: parquet keeps types where every value converts', async () => {
  const [types, values] = await readParquet(await encode('parquet'), file => [
    `select column_name, column_type from (describe select * from ${file})`,
    `select dec::varchar, ts::varchar, text, json, odd from ${file} order by id`,
  ])
  assertEquals(types, [['id', 'INTEGER'], ['dec', 'DECIMAL(12,2)'], ['ts', 'TIMESTAMP'], ['text', 'VARCHAR'], ['json', 'VARCHAR'], ['odd', 'VARCHAR']])
  assertEquals(values, [['12.50', '2024-01-02 03:04:05.123456', 'a,"b"\nc', '{"k":[1]}', '7'], [null, null, '', null, 'x']])
})

Deno.test('export: parquet maps further types and renames repeated columns', async () => {
  const data = await encode('parquet', {
    columns: [
      { name: 'id', type: 'smallint' },
      { name: 'id', type: 'bigint' },
      { name: 'd', type: 'date' },
      { name: 't', type: 'time' },
      { name: 'tz', type: 'timestamptz' },
      { name: 'u', type: 'uuid' },
      { name: 'b', type: 'boolean' },
      { name: 'r', type: 'real' },
      // Feb 30 does not exist: stays VARCHAR.
      { name: 'bad', type: 'date' },
    ],
    rows: [
      [-3, '9007199254740993', '2024-02-29', '13:14:15.5', '2024-01-02T03:04:05.123456+01:00', '0E984725-C51C-4BF4-9960-E1C80E27ABA0', true, 1.5, '2024-02-30'],
      [null, '-1', '1969-12-31', '00:00:00', '2024-01-02T03:04:05Z', null, false, null, null],
    ],
  })
  const [types, values] = await readParquet(data, file => [
    `select column_name, column_type from (describe select * from ${file})`,
    `select id, id_1::varchar, d::varchar, t::varchar, epoch_us(tz), u::varchar, b, r, bad from ${file}`,
  ])
  assertEquals(types, [['id', 'SMALLINT'], ['id_1', 'BIGINT'], ['d', 'DATE'], ['t', 'TIME'], ['tz', 'TIMESTAMP WITH TIME ZONE'], ['u', 'UUID'], ['b', 'BOOLEAN'], ['r', 'FLOAT'], ['bad', 'VARCHAR']])
  assertEquals(values, [
    [-3, '9007199254740993', '2024-02-29', '13:14:15.5', '1704161045123456', '0e984725-c51c-4bf4-9960-e1c80e27aba0', true, 1.5, '2024-02-30'],
    [null, '-1', '1969-12-31', '00:00:00', '1704164645000000', null, false, null, null],
  ])
})
