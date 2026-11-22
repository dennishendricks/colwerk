import { test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { crc32, inflateRawSync } from 'node:zlib'
import { tempDir } from './helpers.ts'
import { assert, assertEquals } from './assert.ts'
import { duckdbDriver } from '../core/drivers/duckdb.ts'
import { createExporter, type ExportFormat, type ExportOptions } from '../core/export.ts'
import type { AppError, CellValue, ResultColumn } from '../core/types.ts'

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

async function encode(format: ExportFormat, { columns, rows } = table, options?: ExportOptions): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const exporter = createExporter(format, async (chunk) => void chunks.push(chunk), options)
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

test('export: csv quotes fields and distinguishes NULL from empty string', async () => {
  assertEquals(
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(await encode('csv')),
    [
      '\uFEFF"id";"dec";"ts";"text";"json";"odd"',
      '"1";"12.50";"2024-01-02T03:04:05.123456";"a,""b""\nc";"{""k"":[1]}";"7"',
      '"2";;;"";;"x"',
      '',
    ].join('\r\n'),
  )
})

async function readParquet(data: Uint8Array, sql: (file: string) => string[]): Promise<CellValue[][][]> {
  const dir = await tempDir()
  const session = await duckdbDriver.connect({ id: 'export-test', name: 'duck', dialect: 'duckdb', file: ':memory:' })
  try {
    const file = `${dir}/out.parquet`
    await writeFile(file, data)
    const results = []
    for (const query of sql(`'${file}'`)) {
      results.push((await session.execute(query, { rowLimit: 100 })).resultSets[0]!.rows)
    }
    return results
  } finally {
    await session.close()
    await rm(dir, { recursive: true })
  }
}

test('export: parquet keeps types where every value converts', async () => {
  const [types, values] = await readParquet(await encode('parquet'), (file) => [
    `select column_name, column_type from (describe select * from ${file})`,
    `select dec::varchar, ts::varchar, text, json, odd from ${file} order by id`,
  ])
  assertEquals(types, [
    ['id', 'INTEGER'],
    ['dec', 'DECIMAL(12,2)'],
    ['ts', 'TIMESTAMP'],
    ['text', 'VARCHAR'],
    ['json', 'VARCHAR'],
    ['odd', 'VARCHAR'],
  ])
  assertEquals(values, [
    ['12.50', '2024-01-02 03:04:05.123456', 'a,"b"\nc', '{"k":[1]}', '7'],
    [null, null, '', null, 'x'],
  ])
})

test('export: parquet maps further types and renames repeated columns', async () => {
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
      [
        -3,
        '9007199254740993',
        '2024-02-29',
        '13:14:15.5',
        '2024-01-02T03:04:05.123456+01:00',
        '0E984725-C51C-4BF4-9960-E1C80E27ABA0',
        true,
        1.5,
        '2024-02-30',
      ],
      [null, '-1', '1969-12-31', '00:00:00', '2024-01-02T03:04:05Z', null, false, null, null],
    ],
  })
  const [types, values] = await readParquet(data, (file) => [
    `select column_name, column_type from (describe select * from ${file})`,
    `select id, id_1::varchar, d::varchar, t::varchar, epoch_us(tz), u::varchar, b, r, bad from ${file}`,
  ])
  assertEquals(types, [
    ['id', 'SMALLINT'],
    ['id_1', 'BIGINT'],
    ['d', 'DATE'],
    ['t', 'TIME'],
    ['tz', 'TIMESTAMP WITH TIME ZONE'],
    ['u', 'UUID'],
    ['b', 'BOOLEAN'],
    ['r', 'FLOAT'],
    ['bad', 'VARCHAR'],
  ])
  assertEquals(values, [
    [
      -3,
      '9007199254740993',
      '2024-02-29',
      '13:14:15.5',
      '1704161045123456',
      '0e984725-c51c-4bf4-9960-e1c80e27aba0',
      true,
      1.5,
      '2024-02-30',
    ],
    [null, '-1', '1969-12-31', '00:00:00', '1704164645000000', null, false, null, null],
  ])
})

const text = async (format: ExportFormat, data = table, options?: ExportOptions) =>
  new TextDecoder().decode(await encode(format, data, options))

const jsonRows = [
  '{"id":1,"dec":"12.50","ts":"2024-01-02T03:04:05.123456","text":"a,\\"b\\"\\nc","json":{"k":[1]},"odd":"7"}',
  '{"id":2,"dec":null,"ts":null,"text":"","json":null,"odd":"x"}',
]

test('export: json is an array of objects, ndjson has one object per line', async () => {
  assertEquals(await text('json'), `[\n${jsonRows.join(',\n')}\n]\n`)
  assertEquals(await text('ndjson'), `${jsonRows.join('\n')}\n`)
  assertEquals(await text('json', { columns, rows: [] }), '[]\n')
  assertEquals(await text('ndjson', { columns, rows: [] }), '')
})

test('export: markdown writes the header also without rows', async () => {
  assertEquals(
    await text('markdown'),
    [
      '| id | dec | ts | text | json | odd |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | 12.50 | 2024-01-02T03:04:05.123456 | a,"b"<br>c | {"k":[1]} | 7 |',
      '| 2 |  |  |  |  | x |',
      '',
    ].join('\n'),
  )
  assertEquals(await text('markdown', { columns: columns.slice(0, 2), rows: [] }), '| id | dec |\n| --- | --- |\n')
})

test('export: insert writes statements of batchSize rows', async () => {
  const options: ExportOptions = { dialect: 'postgres', table: ['public', 't'], batchSize: 1 }
  const head = 'insert into "public"."t" ("id", "dec", "ts", "text", "json", "odd") values\n  '
  assertEquals(
    await text('insert', table, options),
    [
      `${head}(1, 12.50, '2024-01-02T03:04:05.123456', 'a,"b"\nc', '{"k":[1]}', 7);`,
      `${head}(2, NULL, NULL, '', NULL, 'x');`,
      '',
    ].join('\n\n'),
  )
  assertEquals((await text('insert', table, { ...options, batchSize: 10 })).match(/^insert/gm)?.length, 1)
  assertEquals(await text('insert', { columns, rows: [] }, options), '')
})

test('export: insert needs a target table', () => {
  try {
    createExporter('insert', async () => {})
  } catch (e) {
    assertEquals((e as AppError).key, 'insertTableRequired')
    return
  }
  throw new Error('expected an error')
})

/** Entries of a ZIP file (name → content), read via the central directory; checks the CRC of each entry. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (view.getUint32(end, true) !== 0x06054b50) end--
  const entries = new Map<string, string>()
  let at = view.getUint32(end + 16, true)
  for (let i = view.getUint16(end + 10, true); i > 0; i--) {
    const [crc, csize] = [view.getUint32(at + 16, true), view.getUint32(at + 20, true)]
    const [nameLength, extra, comment] = [at + 28, at + 30, at + 32].map((o) => view.getUint16(o, true)) as [
      number,
      number,
      number,
    ]
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    const local = view.getUint32(at + 42, true)
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = inflateRawSync(bytes.subarray(start, start + csize))
    assertEquals(crc32(data) >>> 0, crc)
    entries.set(name, data.toString())
    at += 46 + nameLength + extra + comment
  }
  return entries
}

test('export: xlsx is a workbook with typed cells', async () => {
  const entries = unzip(await encode('xlsx'))
  assertEquals(
    [...entries.keys()],
    [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ],
  )
  const sheet = entries.get('xl/worksheets/sheet1.xml')!
  assert(sheet.includes('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">id</t></is></c>'))
  assert(sheet.includes('<c r="A2"><v>1</v></c>'))
  assert(sheet.includes('<c r="B2"><v>12.50</v></c>'))
  assert(/<c r="C2" s="3"><v>45293\.1278\d*<\/v><\/c>/.test(sheet))
  assert(sheet.includes('<c r="D2" t="inlineStr"><is><t xml:space="preserve">a,&quot;b&quot;\nc</t></is></c>'))
  assert(sheet.includes('<c r="E2" t="inlineStr"><is><t xml:space="preserve">{&quot;k&quot;:[1]}</t></is></c>'))
  // NULL has no cell.
  assert(sheet.includes('<row r="3"><c r="A3"><v>2</v></c><c r="D3" t="inlineStr">'))
  assert(sheet.endsWith('</sheetData></worksheet>'))
})

test('export: xlsx keeps what does not fit its column as text', async () => {
  const sheet = unzip(
    await encode('xlsx', {
      columns: [
        { name: 'n', type: 'numeric(30,0)' },
        { name: 'd', type: 'date' },
        { name: 't', type: 'time' },
        { name: 'b', type: 'boolean' },
      ],
      rows: [['12345678901234567890', '1800-01-01', '13:00:00', true]],
    }),
  ).get('xl/worksheets/sheet1.xml')!
  assert(sheet.includes('<c r="A2" t="inlineStr"><is><t xml:space="preserve">12345678901234567890</t></is></c>'))
  assert(sheet.includes('<c r="B2" t="inlineStr">'))
  assert(sheet.includes('<c r="C2" s="4"><v>0.5416666666666666</v></c>'))
  assert(sheet.includes('<c r="D2" t="b"><v>1</v></c>'))
})

test('export: xlsx rejects more columns than a sheet holds', async () => {
  const exporter = createExporter('xlsx', async () => {})
  const wide = Array.from({ length: 16_385 }, (_, i) => ({ name: `c${i}`, type: 'integer' }))
  try {
    exporter.columns(wide)
  } catch (e) {
    assertEquals((e as AppError).key, 'xlsxLimit')
    return
  }
  throw new Error('expected an error')
})

// DuckDB's `excel` extension is downloaded on first use, so this part is skipped without network.
const excel = await (async () => {
  const session = await duckdbDriver.connect({ id: 'excel-test', name: 'duck', dialect: 'duckdb', file: ':memory:' })
  try {
    await session.execute('install excel', { rowLimit: 1 })
    await session.execute('load excel', { rowLimit: 1 })
    return true
  } catch {
    return false
  } finally {
    await session.close()
  }
})()

test.skipIf(!excel)('export: duckdb reads the xlsx file back', async () => {
  const dir = await tempDir()
  const session = await duckdbDriver.connect({ id: 'excel-test', name: 'duck', dialect: 'duckdb', file: ':memory:' })
  try {
    await session.execute('load excel', { rowLimit: 1 })
    const file = `${dir}/out.xlsx`
    await writeFile(file, await encode('xlsx'))
    // `odd` mixes numbers and text, so only the typed columns are read.
    const result = await session.execute(
      `select id, dec, ts::varchar, text from read_xlsx('${file}', header = true, range = 'A1:D3') order by id`,
      { rowLimit: 10 },
    )
    assertEquals(result.resultSets[0]!.rows, [
      [1, 12.5, '2024-01-02 03:04:05.123456', 'a,"b"\nc'],
      [2, null, null, ''],
    ])
  } finally {
    await session.close()
    await rm(dir, { recursive: true })
  }
})
