// Data import end to end, offline: DuckDB from node_modules reads the files, SQLite and DuckDB are the targets.
// Postgres to DuckDB runs when the docker-compose service is reachable.
import { afterAll, beforeAll, test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from '../core/drivers/duckdb-native.ts'
import { createTableSql, targetType } from '../core/import-sql.ts'
import { type ImportPlan, type ImportProgress, type ImportSource, previewImport, runImport } from '../core/import.ts'
import type { SplitDialect } from '../core/sql-split.ts'
import { AppError, type ConnectionConfig } from '../core/types.ts'
import { Workbench } from '../core/workbench.ts'
import { assert, assertEquals, assertRejects } from './assert.ts'
import { reachable, tempDir, testConnections } from './helpers.ts'

let dir: string
let wb: Workbench
let excel = false
let counter = 0

const configs: Record<string, ConnectionConfig> = {
  duck: { id: 'duck', name: 'duck', dialect: 'duckdb', file: ':memory:' },
}
configs.pg = testConnections.postgres

const file = (name: string) => join(dir, name)
const noProgress = (): ImportProgress => ({ read: 0, inserted: 0, updated: 0, failed: 0 })

async function duckCopy(sql: string) {
  const conn = await connect(':memory:import-fixture', false, false)
  try {
    ;(await conn.query(sql)).close()
  } finally {
    conn.close()
  }
}

beforeAll(async () => {
  dir = await tempDir()
  configs.lite = { id: 'lite', name: 'lite', dialect: 'sqlite', file: join(dir, 'target.db') }
  wb = new Workbench(async (id) => configs[id]!)
  await writeFile(file('a.csv'), 'id,name,amount\n1,anna,1.5\n2,bob,2.5\n3,cleo,3.5\n')
  await writeFile(file('a.tsv'), 'id\tname\tamount\n1\tanna\t1.5\n2\tbob\t2.5\n3\tcleo\t3.5\n')
  await writeFile(
    file('a.json'),
    JSON.stringify([
      { id: 1, name: 'anna', amount: 1.5 },
      { id: 2, name: 'bob', amount: 2.5 },
      { id: 3, name: 'cleo', amount: 3.5 },
    ]),
  )
  await writeFile(
    file('a.ndjson'),
    '{"id":1,"name":"anna","amount":1.5}\n{"id":2,"name":"bob","amount":2.5}\n{"id":3,"name":"cleo","amount":3.5}\n',
  )
  await duckCopy(
    `copy (select * from (values (1, 'anna', 1.5), (2, 'bob', 2.5), (3, 'cleo', 3.5)) t(id, name, amount)) to '${file('a.parquet')}' (format parquet)`,
  )
  try {
    await duckCopy('install excel; load excel')
    await duckCopy(
      `load excel; copy (select * from (values (1, 'anna', 1.5), (2, 'bob', 2.5), (3, 'cleo', 3.5)) t(id, name, amount)) to '${file('a.xlsx')}' (format xlsx, header true)`,
    )
    excel = true
  } catch {
    // The excel extension is not available offline.
  }
  await wb.execute('t', 'duck', 'create table src (id integer, name varchar)', 1, 10)
})

afterAll(async () => {
  await wb.closeAll()
  await rm(dir, { recursive: true, force: true })
})

/** A plan loading `source` into `schema.table` of `lite` (or another target) with every column, types translated. */
async function plan(
  source: ImportSource,
  table: string,
  overrides: Partial<ImportPlan> = {},
  sourceDialect: SplitDialect = 'duckdb',
  target: { connectionId: string; schema: string; dialect: SplitDialect } = {
    connectionId: 'lite',
    schema: 'main',
    dialect: 'sqlite',
  },
): Promise<ImportPlan> {
  const { columns } = await previewImport(wb, source, sourceDialect)
  return {
    source,
    sourceDialect,
    target: { ...target, table },
    columns: columns.map((c, i) => ({
      source: i,
      name: c.name,
      type: targetType(c.type, sourceDialect, target.dialect),
    })),
    strategy: 'append',
    keys: [],
    batchSize: 500,
    onError: 'stop',
    ...overrides,
  }
}

const count = async (connection: string, table: string) =>
  Number((await wb.execute('q', connection, `select count(*) from ${table}`, 1, 10)).resultSets[0]!.rows[0]![0])

const rowsOf = async (connection: string, sql: string) =>
  (await wb.execute('q', connection, sql, 100, 10)).resultSets[0]!.rows

function create(p: ImportPlan, keys: string[] = []): ImportPlan {
  const { dialect, schema, table } = p.target
  const ddl = createTableSql(
    dialect,
    schema,
    table,
    p.columns.map((c) => ({ name: c.name, type: c.type, key: keys.includes(c.name) })),
  )
  return { ...p, target: { ...p.target, create: ddl } }
}

test('files of every format are previewed and imported into a new table', async () => {
  const names = ['a.csv', 'a.tsv', 'a.json', 'a.ndjson', 'a.parquet', ...(excel ? ['a.xlsx'] : [])]
  for (const name of names) {
    const source: ImportSource = { kind: 'file', path: file(name) }
    const preview = await previewImport(wb, source, 'duckdb')
    assertEquals(
      preview.columns.map((c) => c.name),
      ['id', 'name', 'amount'],
      name,
    )
    assertEquals(preview.rows.length, 3, name)
    const table = `t${++counter}`
    const summary = await runImport(
      wb,
      name,
      create(await plan(source, table)),
      noProgress(),
      new AbortController().signal,
    )
    assertEquals([summary.read, summary.inserted, summary.failed, summary.error], [3, 3, 0, undefined], name)
    assertEquals(await count('lite', table), 3, name)
    assertEquals((await rowsOf('lite', `select name from ${table} where id = 2`))[0], ['bob'], name)
  }
})

test('append, truncate and upsert', async () => {
  const source: ImportSource = { kind: 'file', path: file('a.csv') }
  const run = (p: ImportPlan) => runImport(wb, 'strategies', p, noProgress(), new AbortController().signal)
  await run(create(await plan(source, 'strat')))
  await run(await plan(source, 'strat'))
  assertEquals(await count('lite', 'strat'), 6)
  await run(await plan(source, 'strat', { strategy: 'truncate' }))
  assertEquals(await count('lite', 'strat'), 3)

  await run(
    create(await plan(source, 'up', {}, 'duckdb', { connectionId: 'duck', schema: 'main', dialect: 'duckdb' }), ['id']),
  )
  await wb.execute('t', 'duck', "update up set name = 'changed' where id < 3", 1, 10)
  await wb.execute('t', 'duck', 'delete from up where id = 3', 1, 10)
  const upsert = await run(
    await plan(source, 'up', { strategy: 'upsert', keys: ['id'] }, 'duckdb', {
      connectionId: 'duck',
      schema: 'main',
      dialect: 'duckdb',
    }),
  )
  assertEquals([upsert.inserted, upsert.updated, upsert.error], [1, 2, undefined])
  assertEquals(await rowsOf('duck', 'select id, name from up order by id'), [
    ['1', 'anna'],
    ['2', 'bob'],
    ['3', 'cleo'],
  ])
})

test('failed rows are skipped or stop the import', async () => {
  const path = file('nulls.csv')
  await writeFile(path, 'id,name\n1,a\n2,b\n3,\n4,d\n')
  const source: ImportSource = { kind: 'file', path }
  for (const table of ['skip', 'stop']) {
    await wb.execute('t', 'lite', `create table ${table} (id integer, name text not null)`, 1, 10)
  }
  const skip = await runImport(
    wb,
    'skip',
    await plan(source, 'skip', { onError: 'skip' }),
    noProgress(),
    new AbortController().signal,
  )
  assertEquals([skip.inserted, skip.failed, skip.errors.length, skip.error], [3, 1, 1, undefined])
  assertEquals(await count('lite', 'skip'), 3)

  const stop = await runImport(
    wb,
    'stop',
    await plan(source, 'stop', { batchSize: 2 }),
    noProgress(),
    new AbortController().signal,
  )
  assert(stop.error)
  assertEquals([stop.inserted, stop.failed], [2, 2])
  assertEquals(await count('lite', 'stop'), 2)
})

test('cancelling stops the import and keeps the batches written', async () => {
  const source: ImportSource = { kind: 'query', connectionId: 'duck', sql: 'select range as id from range(100000)' }
  const base = await plan(source, 'cancelled')
  const progress = noProgress()
  const abort = new AbortController()
  const timer = setInterval(() => progress.inserted > 0 && abort.abort(), 1)
  try {
    const summary = await runImport(wb, 'cancel', create({ ...base, batchSize: 100 }), progress, abort.signal)
    assert(summary.cancelled)
    assertEquals(summary.error, undefined)
    assert(summary.inserted > 0 && summary.inserted < 100000)
  } finally {
    clearInterval(timer)
  }
})

test('a table is copied between engines', async () => {
  await wb.execute(
    't',
    'duck',
    `create table mixed as select 1 as i, 12.50::decimal(10,2) as d, timestamp '2024-01-02 03:04:05' as ts, 'ab'::blob as b, 'x''y' as s, true as f`,
    1,
    10,
  )
  const source: ImportSource = { kind: 'table', connectionId: 'duck', schema: 'main', table: 'mixed' }
  const summary = await runImport(
    wb,
    'copy',
    create(await plan(source, 'mixed')),
    noProgress(),
    new AbortController().signal,
  )
  assertEquals([summary.inserted, summary.error], [1, undefined])
  assertEquals(await rowsOf('lite', 'select i, d, ts, b, s, f from mixed'), [
    [1, 12.5, '2024-01-02T03:04:05', '0x6162', "x'y", 1],
  ])
})

test.skipIf(!(await reachable(testConnections.postgres)))('a Postgres table is copied to DuckDB', async () => {
  await wb.execute('t', 'pg', 'drop table if exists import_src', 1, 10)
  await wb.execute(
    't',
    'pg',
    `create table import_src as select i as id, 'n' || i as name, (i * 1.25)::numeric(10,2) as amount from generate_series(1, 5) i`,
    1,
    10,
  )
  const source: ImportSource = { kind: 'table', connectionId: 'pg', schema: 'public', table: 'import_src' }
  const target = { connectionId: 'duck', schema: 'main', dialect: 'duckdb' as const }
  const p = create(await plan(source, 'from_pg', {}, 'postgres', target))
  const summary = await runImport(wb, 'pg', p, noProgress(), new AbortController().signal)
  assertEquals([summary.inserted, summary.error], [5, undefined])
  assertEquals(await rowsOf('duck', 'select name, amount from from_pg where id = 4'), [['n4', '5.00']])
  await wb.execute('t', 'pg', 'drop table import_src', 1, 10)
})

test('only a read-only query can be imported', async () => {
  const source: ImportSource = { kind: 'query', connectionId: 'duck', sql: 'delete from src' }
  await assertRejects(() => previewImport(wb, source, 'duckdb'), AppError, 'read-only')
})

test('unsupported files and strategies are rejected', async () => {
  await assertRejects(
    () => previewImport(wb, { kind: 'file', path: file('x.txt') }, 'duckdb'),
    AppError,
    'Not a supported data file',
  )
  const p = await plan({ kind: 'file', path: file('a.csv') }, 'strategy_check', { strategy: 'upsert', keys: ['id'] })
  await assertRejects(
    () =>
      runImport(
        wb,
        'invalid',
        { ...p, target: { ...p.target, dialect: 'clickhouse' } },
        noProgress(),
        new AbortController().signal,
      ),
    AppError,
    'not supported by the target',
  )
})
