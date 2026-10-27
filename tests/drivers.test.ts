// Contract tests every driver must pass. Network databases come from docker-compose.yml and are
// skipped when not reachable; DuckDB runs in memory.
import { assert, assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1'
import { loadDriver } from '../core/registry.ts'
import { type ConnectionConfig, DbError, type QueryResult, type Session } from '../core/types.ts'
import { reachable, testConnections } from './helpers.ts'

/** Rows of the only result set. */
function rows(r: QueryResult) {
  assertEquals(r.resultSets.length, 1)
  return r.resultSets[0]!.rows
}

interface Case {
  config: ConnectionConfig
  setup?: string[]
  /** Must return columns big, dec, ts, bin, n. */
  values: string
  ts: string
  /** Schema containing `orders` (FK customer_id → customers.id, index orders_customer_idx). */
  schema: string
  customersSchema: string
  sleep: string
  createTemp: string
  insertSeven: string
  /** Two statements, the second returns column `b`. */
  multi: string
  /** Idempotent: comment 'Orders' on `orders`, 'Order total' on `orders.total`, fresh statistics. */
  annotate: string[]
}

const cases: Case[] = [
  {
    config: testConnections.postgres,
    values: `select 9007199254740993::bigint as big, 12345678901234567890.123::numeric as dec,
      '2024-01-02 03:04:05.123456'::timestamp as ts, '\\xdeadbeef'::bytea as bin, null::int as n`,
    ts: '2024-01-02T03:04:05.123456',
    schema: 'sales',
    customersSchema: 'public',
    sleep: 'select pg_sleep(30)',
    createTemp: 'create temp table t (x int)',
    insertSeven: 'insert into t select generate_series(1, 7)',
    multi: 'select 1 as a; select 2 as b',
    annotate: [`comment on table sales.orders is 'Orders'`, `comment on column sales.orders.total is 'Order total'`, 'analyze sales.orders'],
  },
  {
    config: testConnections.mysql,
    values: `select cast(9007199254740993 as signed) as big, cast(12345678901234567890.123 as decimal(30,3)) as \`dec\`,
      cast('2024-01-02 03:04:05.123456' as datetime(6)) as ts, unhex('deadbeef') as bin, null as n`,
    ts: '2024-01-02T03:04:05.123456',
    schema: 'dbm',
    customersSchema: 'dbm',
    sleep: 'select sleep(30)',
    createTemp: 'create temporary table t (x int)',
    insertSeven: 'insert into t select seq from seq_1_to_7',
    multi: 'select 1 as a; select 2 as b',
    annotate: [`alter table orders comment = 'Orders'`, `alter table orders modify total decimal(12, 2) not null comment 'Order total'`, 'analyze table orders'],
  },
  {
    config: testConnections.mssql,
    values: `select cast(9007199254740993 as bigint) as big, cast(1234567890.125 as decimal(18,3)) as dec,
      cast('2024-01-02 03:04:05.123' as datetime2(3)) as ts, 0xDEADBEEF as bin, null as n`,
    ts: '2024-01-02T03:04:05.123',
    schema: 'sales',
    customersSchema: 'dbo',
    sleep: `waitfor delay '00:00:30'`,
    createTemp: 'create table #t (x int)',
    insertSeven: 'insert into #t select value from generate_series(1, 7)',
    multi: 'select 1 as a; select 2 as b',
    annotate: [
      `if not exists (select 1 from sys.extended_properties where major_id = object_id('sales.orders') and minor_id = 0)
         exec sp_addextendedproperty 'MS_Description', 'Orders', 'SCHEMA', 'sales', 'TABLE', 'orders'`,
      `if not exists (select 1 from sys.extended_properties where major_id = object_id('sales.orders') and minor_id = columnproperty(object_id('sales.orders'), 'total', 'ColumnId'))
         exec sp_addextendedproperty 'MS_Description', 'Order total', 'SCHEMA', 'sales', 'TABLE', 'orders', 'COLUMN', 'total'`,
    ],
  },
  {
    config: { id: 'duck-test', name: 'duck', dialect: 'duckdb', file: ':memory:' },
    setup: [
      'create schema sales',
      'create table sales.customers (id bigint primary key, email varchar unique)',
      'create table sales.orders (id bigint primary key, customer_id bigint references sales.customers(id), total decimal(12,2))',
      'create index orders_customer_idx on sales.orders(customer_id)',
      'create view sales.order_totals as select customer_id, sum(total) as total from sales.orders group by 1',
      'insert into sales.customers select i, i::varchar from range(1, 201) t(i)',
      'insert into sales.orders select i, 1 + i % 200, i * 1.37 from range(1, 50001) t(i)',
    ],
    values: `select 9007199254740993::bigint as big, 12345678901234567890.123::decimal(38,3) as dec,
      timestamp '2024-01-02 03:04:05.123456' as ts, '\\xDE\\xAD\\xBE\\xEF'::blob as bin, null as n`,
    ts: '2024-01-02T03:04:05.123456',
    schema: 'sales',
    customersSchema: 'sales',
    sleep: 'select count(*) from range(100000000000) a',
    createTemp: 'create temp table t (x int)',
    insertSeven: 'insert into t select * from range(7)',
    multi: 'select 1 as a; select 2 as b',
    annotate: [`comment on table sales.orders is 'Orders'`, `comment on column sales.orders.total is 'Order total'`],
  },
]

for (const c of cases) {
  const name = c.config.dialect
  const ignore = c.config.host ? !(await reachable(c.config)) : false
  const opts = { ignore, sanitizeResources: false, sanitizeOps: false }
  let shared: Session | undefined

  async function session(): Promise<Session> {
    if (!shared) {
      shared = await (await loadDriver(c.config.dialect)).connect(c.config)
      for (const stmt of c.setup ?? []) await shared.execute(stmt, { rowLimit: 1 })
    }
    return shared
  }

  Deno.test({ name: `${name}: unified value model`, ...opts }, async () => {
    const r = (await (await session()).execute(c.values, { rowLimit: 10 })).resultSets[0]!
    assertEquals(r.columns.map(col => col.name), ['big', 'dec', 'ts', 'bin', 'n'])
    const [big, dec, ts, bin, n] = r.rows[0]!
    assertEquals(big, '9007199254740993')
    assertEquals(typeof dec, 'string')
    if (name !== 'mssql') assertEquals(dec, '12345678901234567890.123')
    assertEquals(ts, c.ts)
    assertEquals(String(bin).toLowerCase(), '0xdeadbeef')
    assertEquals(n, null)
  })

  Deno.test({ name: `${name}: row limit`, ...opts }, async () => {
    const s = await session()
    const r = (await s.execute(`select * from ${c.schema}.orders`, { rowLimit: 100 })).resultSets[0]!
    assertEquals(r.rows.length, 100)
    assert(r.truncated)
    const exact = (await s.execute(`select * from ${c.schema}.orders where id <= 5`, { rowLimit: 5 })).resultSets[0]!
    assertEquals(exact.rows.length, 5)
    assertEquals(exact.truncated, false)
    // The session stays usable after a truncated read.
    assertEquals(rows(await s.execute('select 1 as x', { rowLimit: 10 })), [[1]])
  })

  Deno.test({ name: `${name}: session state, DML, multiple statements, errors`, ...opts }, async () => {
    const s = await session()
    await s.execute(c.createTemp, { rowLimit: 1 })
    const ins = await s.execute(c.insertSeven, { rowLimit: 1 })
    if (name !== 'duckdb') assertEquals(ins.affectedRows, 7)
    const tableName = name === 'mssql' ? '#t' : 't'
    assertEquals(rows(await s.execute(`select count(*) as n from ${tableName}`, { rowLimit: 1 }))[0]![0]!.toString(), '7')
    const multi = await s.execute(c.multi, { rowLimit: 10 })
    assertEquals(multi.resultSets.map(r => r.columns.map(col => col.name)), [['a'], ['b']])
    // A truncated result set neither cuts off nor skips the statements after it.
    const script = await s.execute(`select * from ${c.schema}.orders; ${c.insertSeven}; select count(*) as n from ${tableName}`, { rowLimit: 10 })
    assertEquals(script.resultSets.length, 2)
    assertEquals(script.resultSets[0]!.rows.length, 10)
    assert(script.resultSets[0]!.truncated)
    assertEquals(script.resultSets[1]!.rows[0]![0]!.toString(), '14')
    await assertRejects(() => s.execute('select * from does_not_exist', { rowLimit: 1 }))
    assertEquals(rows(await s.execute('select 1 as x', { rowLimit: 10 })), [[1]])
  })

  Deno.test({ name: `${name}: error position`, ...opts }, async () => {
    const s = await session()
    // [script, text from the reported position on]; MSSQL only reports the line (position: its first non-blank character).
    const errors: [string, string][] = [
      ['select 1 frm x', name === 'mssql' ? 'select 1 frm x' : 'x'],
      ['select 1;\n  select 2 frm x', name === 'mssql' ? 'select 2 frm x' : 'x'],
    ]
    if (name === 'mssql') errors.push(['select 1\nGO\n  select 2 frm x', 'select 2 frm x'])
    for (const [sql, rest] of errors) {
      const err = await assertRejects(() => s.execute(sql, { rowLimit: 1 }), DbError)
      assertEquals(err.position, sql.length - rest.length, sql)
    }
  })

  Deno.test({ name: `${name}: transaction state`, ...opts }, async () => {
    const s = await session()
    const begin = name === 'mysql' ? 'begin' : 'begin transaction'
    assertEquals(await s.transactionState(), 'idle')
    await s.execute(begin, { rowLimit: 1 })
    assertEquals(await s.transactionState(), 'open')
    await s.execute('commit', { rowLimit: 1 })
    assertEquals(await s.transactionState(), 'idle')
    // Postgres aborts the transaction on any error, DuckDB only on runtime errors (not on binder errors);
    // MySQL and SQL Server keep it usable after this error.
    await s.execute(begin, { rowLimit: 1 })
    await assertRejects(() => s.execute(name === 'duckdb' ? `select 'x'::int` : 'select * from does_not_exist', { rowLimit: 1 }))
    assertEquals(await s.transactionState(), name === 'postgres' || name === 'duckdb' ? 'failed' : 'open')
    await s.execute('rollback', { rowLimit: 1 })
    assertEquals(await s.transactionState(), 'idle')
  })

  if (name === 'postgres') {
    Deno.test({ name: `${name}: date and timestamp arrays keep the unified string form`, ...opts }, async () => {
      const [[ts, d, tz]] = rows(await (await session()).execute(
        `select array['2024-01-02 03:04:05.123456'::timestamp, null] as ts, array['2024-01-02'::date] as d,
           array['2024-01-02 03:04:05+00'::timestamptz] as tz`, { rowLimit: 1 })) as [[string[], string[], string[]]]
      assertEquals(ts, ['2024-01-02T03:04:05.123456', null])
      assertEquals(d, ['2024-01-02'])
      assertMatch(tz[0]!, /^2024-01-0[12]T\d{2}:\d{2}:05[+-]\d{2}:\d{2}$/)
    })
  }

  if (name === 'mssql') {
    Deno.test({ name: `${name}: GO separates batches`, ...opts }, async () => {
      const r = await (await session()).execute(`declare @x int = 1\nselect @x as a\nGO\nselect 2 as b`, { rowLimit: 10 })
      assertEquals(r.resultSets.map(s => s.rows), [[[1]], [[2]]])
      await assertRejects(() => (session().then(s => s.execute(`select 1\nGO\nselect * from does_not_exist`, { rowLimit: 1 }))), Error, 'Batch 2:')
    })
  }

  Deno.test({ name: `${name}: stream`, ...opts }, async () => {
    const s = await session()
    let columns: string[] = []
    let count = 0
    let maxBatch = 0
    await s.stream(`select id, total from ${c.schema}.orders`, {
      columns: cols => (columns = cols.map(col => col.name)),
      // A slow consumer: the driver must wait instead of buffering everything.
      rows: async (rows) => {
        count += rows.length
        maxBatch = Math.max(maxBatch, rows.length)
        await new Promise(r => setTimeout(r, 1))
      },
    })
    assertEquals(columns, ['id', 'total'])
    assertEquals(count, 50_000)
    assert(maxBatch <= 2048, `batch of ${maxBatch} rows`)

    // A failing sink aborts the statement; the session stays usable.
    let seen = 0
    await assertRejects(() => s.stream(`select id from ${c.schema}.orders`, {
      columns: () => {},
      rows: async (rows) => {
        seen += rows.length
        throw new Error('client gone')
      },
    }), Error, 'client gone')
    assert(seen <= 2048, `${seen} rows after abort`)
    assertEquals(rows(await s.execute('select 1 as x', { rowLimit: 10 })), [[1]])
  })

  Deno.test({ name: `${name}: cancel`, ...opts }, async () => {
    const s = await session()
    const started = performance.now()
    const running = assertRejects(() => s.execute(c.sleep, { rowLimit: 1 }))
    await new Promise(r => setTimeout(r, 500))
    await s.cancel()
    await running
    assert(performance.now() - started < 10_000, 'cancel took too long')
    assertEquals(rows(await s.execute('select 1 as x', { rowLimit: 10 })), [[1]])
  })

  Deno.test({ name: `${name}: introspection`, ...opts }, async () => {
    const s = await session()
    const schemas = (await s.introspect({ kind: 'schemas' })).map(x => x.name)
    assert(schemas.includes(c.schema), `schemas: ${schemas}`)
    for (const stmt of c.annotate) await s.execute(stmt, { rowLimit: 1 })
    const tables = await s.introspect({ kind: 'tables', schema: c.schema })
    const orders = tables.find(t => t.name === 'orders')!
    assertEquals(orders.kind, 'table')
    assertEquals(orders.comment, 'Orders')
    assertEquals(orders.partitioning, null)
    // Statistics are approximate: InnoDB samples pages.
    assert(orders.rowEstimate! > 25_000 && orders.rowEstimate! < 100_000, `rowEstimate: ${orders.rowEstimate}`)
    const view = tables.find(t => t.name === 'order_totals')!
    assertEquals(view.kind, 'view')
    assertEquals(view.rowEstimate, null)
    assertEquals(view.comment, null)
    const cols = Object.fromEntries((await s.introspect({ kind: 'columns', schema: c.schema, table: 'orders' })).map(col => [col.name, col]))
    assertEquals(cols.id!.primaryKey, true)
    assertEquals(cols.id!.nullable, false)
    assertEquals(cols.customer_id!.primaryKey, false)
    assertEquals(cols.customer_id!.references, { schema: c.customersSchema, table: 'customers', column: 'id' })
    assertEquals(cols.customer_id!.indexes, ['orders_customer_idx'])
    assertMatch(cols.total!.type, /^(numeric|decimal)\(12,\s?2\)$/i)
    assertEquals(cols.total!.comment, 'Order total')
    assertEquals(cols.id!.comment, null)
  })

  Deno.test({ name: `${name}: close`, ...opts }, async () => {
    await shared?.close()
  })
}
