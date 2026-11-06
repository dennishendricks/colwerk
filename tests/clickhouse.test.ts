// ClickHouse driver against the container of docker-compose.yml (skipped when not reachable). ClickHouse has no
// foreign keys, unique keys or transactions, so it gets its own cases instead of the contract in drivers.test.ts.
import { afterAll, test } from 'bun:test'
import { loadDriver } from '../core/registry.ts'
import { DbError, type QueryResult, type Session } from '../core/types.ts'
import { assert, assertEquals, assertMatch, assertRejects } from './assert.ts'
import { reachable, testConnections } from './helpers.ts'

const config = testConnections.clickhouse
const ignore = !(await reachable(config))
let shared: Session | undefined
const session = async () => (shared ??= await (await loadDriver('clickhouse')).connect(config))
afterAll(() => shared?.close())

const rows = (r: QueryResult) => {
  assertEquals(r.resultSets.length, 1)
  return r.resultSets[0]!.rows
}

test.skipIf(ignore)('clickhouse: unified value model', async () => {
  const r = await (
    await session()
  ).execute(
    `select 9007199254740993::Int64 as big, 18446744073709551615::UInt64 as ubig,
       toDecimal128('12345678901234567890.123', 3) as dec, toDateTime64('2024-01-02 03:04:05.123456', 6, 'UTC') as ts,
       toDate('2024-01-02') as d, null as n, [1, 2] as a, map('k', 1) as m,
       CAST((1, 'x'), 'Tuple(a Int32, b String)') as t, nan as f`,
    { rowLimit: 1 },
  )
  assertEquals(rows(r), [
    [
      '9007199254740993',
      '18446744073709551615',
      '12345678901234567890.123',
      '2024-01-02T03:04:05.123456Z',
      '2024-01-02',
      null,
      [1, 2],
      { k: 1 },
      { a: 1, b: 'x' },
      'nan',
    ],
  ])
  assertEquals(r.resultSets[0]!.columns[2]!.type, 'Decimal(38, 3)')
})

test.skipIf(ignore)('clickhouse: row limit, scripts and session state', async () => {
  const s = await session()
  const limited = (await s.execute('select * from orders', { rowLimit: 100 })).resultSets[0]!
  assertEquals(limited.rows.length, 100)
  assert(limited.truncated)
  const exact = (await s.execute('select * from orders where id <= 5', { rowLimit: 5 })).resultSets[0]!
  assertEquals([exact.rows.length, exact.truncated], [5, false])

  // Temporary tables live in the HTTP session.
  await s.execute('create temporary table t (x Int32)', { rowLimit: 1 })
  assertEquals((await s.execute('insert into t select number from numbers(7)', { rowLimit: 1 })).affectedRows, 7)
  const script = await s.execute(
    'select * from orders; insert into t select number from numbers(7); select count() from t',
    {
      rowLimit: 10,
    },
  )
  assertEquals(
    script.resultSets.map((set) => [set.rows.length, set.truncated]),
    [
      [10, true],
      [1, false],
    ],
  )
  assertEquals(script.resultSets[1]!.rows, [['14']])
  assertEquals(await s.transactionState(), undefined)
})

test.skipIf(ignore)('clickhouse: errors and their position', async () => {
  const s = await session()
  for (const sql of ['select 1 frm x', "select 1;\n  select 'ä' frm x"]) {
    const err = await assertRejects(() => s.execute(sql, { rowLimit: 1 }), DbError)
    assertEquals(err.position, sql.length - 1, sql)
  }
  const unknown = await assertRejects(() => s.execute('select * from does_not_exist', { rowLimit: 1 }), DbError)
  assertEquals(unknown.code, '60')
  // An error after the first rows were sent.
  await assertRejects(
    () => s.execute(`select throwIf(number = 300000, 'boom') from numbers(1000000)`, { rowLimit: 10_000_000 }),
    DbError,
    'boom',
  )
  assertEquals(rows(await s.execute('select 1 as x', { rowLimit: 1 })), [[1]])
})

test.skipIf(ignore)('clickhouse: stream and cancel', async () => {
  const s = await session()
  let count = 0
  await s.stream('select id from orders', {
    columns: () => {},
    rows: async (r) => {
      count += r.length
      await new Promise((resolve) => setTimeout(resolve, 1))
    },
  })
  assertEquals(count, 50_000)
  await assertRejects(
    () =>
      s.stream('select id from orders', {
        columns: () => {},
        rows: async () => {
          throw new Error('client gone')
        },
      }),
    Error,
    'client gone',
  )

  const started = performance.now()
  const running = assertRejects(() => s.execute('select count() from numbers(100000000000)', { rowLimit: 1 }), Error)
  await new Promise((resolve) => setTimeout(resolve, 500))
  await s.cancel()
  assertMatch((await running).message, /cancelled/)
  assert(performance.now() - started < 10_000, 'cancel took too long')
  assertEquals(rows(await s.execute('select 1 as x', { rowLimit: 1 })), [[1]])
})

test.skipIf(ignore)('clickhouse: introspection', async () => {
  const s = await session()
  assert((await s.introspect({ kind: 'databases' })).some((d) => d.name === 'dbm'))
  assertEquals(await s.introspect({ kind: 'schemas' }), [{ name: 'dbm' }])
  const tables = await s.introspect({ kind: 'tables', schema: 'dbm' })
  assertEquals(
    tables.find((t) => t.name === 'orders'),
    {
      schema: 'dbm',
      name: 'orders',
      kind: 'table',
      rowEstimate: 50_000,
      comment: 'Orders',
      partitioning: 'toYYYYMM(placed_at)',
      clustering: 'ORDER BY (id)',
    },
  )
  assertEquals(tables.find((t) => t.name === 'order_totals')?.kind, 'view')
  const columns = Object.fromEntries(
    (await s.introspect({ kind: 'columns', schema: 'dbm', table: 'orders' })).map((c) => [c.name, c]),
  )
  assertEquals([columns.id!.primaryKey, columns.id!.nullable], [true, false])
  assertEquals(columns.customer_id!.indexes, ['orders_customer_idx'])
  assertEquals(columns.total!.comment, 'Order total')
  assertEquals(await s.introspect({ kind: 'indexes', schema: 'dbm', table: 'orders' }), [
    { name: 'PRIMARY KEY', columns: ['id'], unique: false, primary: true },
    { name: 'orders_customer_idx', columns: ['customer_id'], unique: false, primary: false },
  ])
  assertMatch(await s.introspect({ kind: 'ddl', schema: 'dbm', name: 'orders', object: 'table' }), /^CREATE TABLE/)
  assertMatch(await s.introspect({ kind: 'ddl', schema: 'dbm', name: 'order_totals', object: 'view' }), /sum\(total\)/)

  await s.execute('create or replace function colwerk_add_ch as (a) -> a + 1', { rowLimit: 1 })
  try {
    assert((await s.introspect({ kind: 'routines', schema: 'dbm' })).some((r) => r.name === 'colwerk_add_ch'))
    assertMatch(await s.introspect({ kind: 'ddl', schema: 'dbm', name: 'colwerk_add_ch', object: 'routine' }), /a \+ 1/)
  } finally {
    await s.execute('drop function if exists colwerk_add_ch', { rowLimit: 1 })
  }
  await assertRejects(() => s.introspect({ kind: 'ddl', schema: 'dbm', name: 'nope', object: 'view' }))
})
