// Contract tests every driver must pass. Network databases come from docker-compose.yml and are
// skipped when not reachable; DuckDB and SQLite run in memory.
import { test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { assert, assertEquals, assertMatch, assertRejects } from './assert.ts'
import { join } from 'node:path'
import { loadDriver } from '../core/registry.ts'
import { type ConnectionConfig, DbError, type QueryResult, type Session } from '../core/types.ts'
import { reachable, tempDir, testConnections } from './helpers.ts'

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
  /** Idempotent: function `colwerk_add_so(a)` returning a + 1 (and procedure `colwerk_touch_so` where supported) in `schema`. */
  routines: string[]
  dropRoutines: string[]
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
    annotate: [
      `comment on table sales.orders is 'Orders'`,
      `comment on column sales.orders.total is 'Order total'`,
      'analyze sales.orders',
    ],
    routines: [
      `create or replace function sales.colwerk_add_so(a int) returns int language sql as 'select a + 1'`,
      `create or replace procedure sales.colwerk_touch_so() language sql as 'select 1'`,
    ],
    dropRoutines: [
      'drop function if exists sales.colwerk_add_so(int)',
      'drop procedure if exists sales.colwerk_touch_so()',
    ],
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
    annotate: [
      `alter table orders comment = 'Orders'`,
      `alter table orders modify total decimal(12, 2) not null comment 'Order total'`,
      'analyze table orders',
    ],
    routines: [
      'drop function if exists colwerk_add_so',
      'create function colwerk_add_so(a int) returns int deterministic return a + 1',
      'drop procedure if exists colwerk_touch_so',
      'create procedure colwerk_touch_so() select 1',
    ],
    dropRoutines: ['drop function if exists colwerk_add_so', 'drop procedure if exists colwerk_touch_so'],
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
    routines: [
      'create or alter function sales.colwerk_add_so(@a int) returns int as begin return @a + 1 end',
      'create or alter procedure sales.colwerk_touch_so as select 1',
    ],
    dropRoutines: ['drop function if exists sales.colwerk_add_so', 'drop procedure if exists sales.colwerk_touch_so'],
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
    routines: ['create or replace macro sales.colwerk_add_so(a) as a + 1'],
    dropRoutines: ['drop macro if exists sales.colwerk_add_so'],
  },
  {
    config: { id: 'sqlite-test', name: 'sqlite', dialect: 'sqlite', file: ':memory:' },
    setup: [
      'create table customers (id integer primary key, email text unique)',
      'create table orders (id integer primary key, customer_id integer references customers(id), total decimal(12,2))',
      'create index orders_customer_idx on orders(customer_id)',
      'create view order_totals as select customer_id, sum(total) as total from orders group by 1',
      'insert into customers with recursive s(i) as (select 1 union all select i + 1 from s where i < 200) select i, i from s',
      'insert into orders with recursive s(i) as (select 1 union all select i + 1 from s where i < 50000) select i, 1 + i % 200, i * 1.37 from s',
    ],
    // No decimal or timestamp types: such values are stored as text (or as a lossy REAL).
    values: `select 9007199254740993 as big, '12345678901234567890.123' as dec, '2024-01-02T03:04:05.123456' as ts, x'deadbeef' as bin, null as n`,
    ts: '2024-01-02T03:04:05.123456',
    schema: 'main',
    customersSchema: 'main',
    sleep: 'with recursive c(x) as (select 1 union all select x + 1 from c where x < 100000000) select count(*) from c',
    createTemp: 'create temp table t (x int)',
    insertSeven:
      'insert into t with recursive s(i) as (select 1 union all select i + 1 from s where i < 7) select i from s',
    multi: 'select 1 as a; select 2 as b',
    // No comments on tables and columns, no stored routines.
    annotate: ['analyze'],
    routines: [],
    dropRoutines: [],
  },
]

for (const c of cases) {
  const name = c.config.dialect
  const ignore = c.config.host ? !(await reachable(c.config)) : false
  let shared: Session | undefined

  async function session(): Promise<Session> {
    if (!shared) {
      shared = await (await loadDriver(c.config.dialect)).connect(c.config)
      for (const stmt of c.setup ?? []) await shared.execute(stmt, { rowLimit: 1 })
    }
    return shared
  }

  test.skipIf(ignore)(`${name}: unified value model`, async () => {
    const r = (await (await session()).execute(c.values, { rowLimit: 10 })).resultSets[0]!
    assertEquals(
      r.columns.map((col) => col.name),
      ['big', 'dec', 'ts', 'bin', 'n'],
    )
    const [big, dec, ts, bin, n] = r.rows[0]!
    assertEquals(big, '9007199254740993')
    assertEquals(typeof dec, 'string')
    if (name !== 'mssql') assertEquals(dec, '12345678901234567890.123')
    assertEquals(ts, c.ts)
    assertEquals(String(bin).toLowerCase(), '0xdeadbeef')
    assertEquals(n, null)
  })

  test.skipIf(ignore)(`${name}: row limit`, async () => {
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

  test.skipIf(ignore)(`${name}: session state, DML, multiple statements, errors`, async () => {
    const s = await session()
    await s.execute(c.createTemp, { rowLimit: 1 })
    const ins = await s.execute(c.insertSeven, { rowLimit: 1 })
    if (name !== 'duckdb') assertEquals(ins.affectedRows, 7)
    const tableName = name === 'mssql' ? '#t' : 't'
    assertEquals(
      rows(await s.execute(`select count(*) as n from ${tableName}`, { rowLimit: 1 }))[0]![0]!.toString(),
      '7',
    )
    const multi = await s.execute(c.multi, { rowLimit: 10 })
    assertEquals(
      multi.resultSets.map((r) => r.columns.map((col) => col.name)),
      [['a'], ['b']],
    )
    // A truncated result set neither cuts off nor skips the statements after it.
    const script = await s.execute(
      `select * from ${c.schema}.orders; ${c.insertSeven}; select count(*) as n from ${tableName}`,
      { rowLimit: 10 },
    )
    assertEquals(script.resultSets.length, 2)
    assertEquals(script.resultSets[0]!.rows.length, 10)
    assert(script.resultSets[0]!.truncated)
    assertEquals(script.resultSets[1]!.rows[0]![0]!.toString(), '14')
    await assertRejects(() => s.execute('select * from does_not_exist', { rowLimit: 1 }))
    assertEquals(rows(await s.execute('select 1 as x', { rowLimit: 10 })), [[1]])
  })

  test.skipIf(ignore)(`${name}: error position`, async () => {
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

  test.skipIf(ignore)(`${name}: transaction state`, async () => {
    const s = await session()
    const begin = name === 'mysql' ? 'begin' : 'begin transaction'
    assertEquals(await s.transactionState(), 'idle')
    await s.execute(begin, { rowLimit: 1 })
    assertEquals(await s.transactionState(), 'open')
    await s.execute('commit', { rowLimit: 1 })
    assertEquals(await s.transactionState(), 'idle')
    // Postgres aborts the transaction on any error, DuckDB only on runtime errors (not on binder errors);
    // MySQL, SQL Server and SQLite keep it usable after this error.
    await s.execute(begin, { rowLimit: 1 })
    await assertRejects(() =>
      s.execute(name === 'duckdb' ? `select 'x'::int` : 'select * from does_not_exist', { rowLimit: 1 }),
    )
    assertEquals(await s.transactionState(), name === 'postgres' || name === 'duckdb' ? 'failed' : 'open')
    await s.execute('rollback', { rowLimit: 1 })
    assertEquals(await s.transactionState(), 'idle')
  })

  if (name === 'duckdb') {
    test.skipIf(ignore)(`${name}: v1Storage creates the file in the storage format of DuckDB 1.4`, async () => {
      const dir = await tempDir()
      try {
        for (const v1Storage of [true, false]) {
          const s = await (
            await loadDriver(name)
          ).connect({
            ...c.config,
            id: `duck-v1-${v1Storage}`,
            file: join(dir, `${v1Storage}.duckdb`),
            v1Storage,
          })
          try {
            const sql = `select map_extract_value(tags, 'storage_version') from duckdb_databases() where database_name = current_database()`
            assertEquals(rows(await s.execute(sql, { rowLimit: 1 })), [[v1Storage ? 'v1.4.0+' : 'v2.0.0+']])
          } finally {
            await s.close()
          }
        }
      } finally {
        await rm(dir, { recursive: true })
      }
    })

    test.skipIf(ignore)(`${name}: GEOMETRY as WKT`, async () => {
      const res = await (
        await session()
      ).execute(`select 'POLYGON((0 0, 1 0, 1 1, 0 0))'::GEOMETRY as g, 'POINT(1 2)'::GEOMETRY('OGC:CRS84') as crs`, {
        rowLimit: 1,
      })
      assertEquals(
        res.resultSets[0]!.columns.map((c) => c.type),
        ['GEOMETRY', `GEOMETRY('OGC:CRS84')`],
      )
      assertEquals(rows(res), [['POLYGON ((0 0, 1 0, 1 1, 0 0))', 'POINT (1 2)']])
    })

    test.skipIf(ignore)(`${name}: a VARIANT value equals the value it was cast from`, async () => {
      const s = await session()
      const values = [
        'true',
        'false',
        '-5::tinyint',
        '-300::smallint',
        '-70000::integer',
        '-5000000000::bigint',
        '-170141183460469231731687303715884105727::hugeint',
        '200::utinyint',
        '60000::usmallint',
        '4000000000::uinteger',
        '18000000000000000000::ubigint',
        '340282366920938463463374607431768211455::uhugeint',
        '1.5::float',
        '-2.25::double',
        `'nan'::double`,
        '-12.345::decimal(5,3)',
        '123456789.12::decimal(11,2)',
        '-1234567890123456.78::decimal(18,2)',
        '12345678901234567890.123::decimal(38,3)',
        `repeat('ä', 200)`,
        `'\\xDE\\xAD'::blob`,
        `'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid`,
        `date '2024-01-02'`,
        `date '-0044-03-15'`,
        `time '03:04:05.123456'`,
        `'03:04:05.123456789'::time_ns`,
        `timestamp_s '2024-01-02 03:04:05'`,
        `timestamp_ms '2024-01-02 03:04:05.123'`,
        `timestamp '2024-01-02 03:04:05.123456'`,
        `timestamp_ns '2024-01-02 03:04:05.123456789'`,
        `'03:04:05+02:30'::timetz`,
        `'2024-01-02 03:04:05+00'::timestamptz`,
        `'2024-01-02 03:04:05.123456789+00'::timestamptz_ns`,
        `interval '1 month 2 days 3 seconds'`,
        '12345678901234567890123::bignum',
        `'10110'::bit`,
        `'POINT(1 2)'::geometry`,
        `[1, null, 3]`,
        `{'a': 1, 'b': [{'c': 'x'}], 'd': null}`,
        'null',
      ]
      await s.execute(`set timezone = 'UTC'`, { rowLimit: 1 })
      const res = await s.execute(
        `select ${values.map((v, i) => `${v} as v${i}, (${v})::variant as w${i}`).join(', ')}`,
        { rowLimit: 1 },
      )
      const [row] = rows(res) as unknown[][]
      values.forEach((v, i) => assertEquals(row![2 * i + 1], row![2 * i], v))
    })
  }

  if (name === 'mysql') {
    test.skipIf(ignore)(`${name}: geometry as WKT with SRID`, async () => {
      const res = await (
        await session()
      ).execute(`select ST_GeomFromText('POINT(1 2)', 4326) as g, ST_GeomFromText('LINESTRING(0 0, 1 1)') as l`, {
        rowLimit: 1,
      })
      assertEquals(rows(res), [['SRID=4326;POINT (1 2)', 'LINESTRING (0 0, 1 1)']])
    })

    test.skipIf(ignore)(`${name}: scripts with DELIMITER create routines`, async () => {
      const s = await session()
      const res = await s.execute(
        `DELIMITER //
create temporary table if not exists delim_t (x int) //
drop procedure if exists delim_p //
create procedure delim_p() begin insert into delim_t values (1); insert into delim_t values (2); end //
DELIMITER ;
call delim_p(); select count(*) as n from delim_t; drop procedure delim_p;`,
        { rowLimit: 10 },
      )
      assertEquals(rows(res), [['2']])
    })
  }

  if (name === 'postgres') {
    // Only when PostGIS is installed in the test database (the postgres image of docker-compose.yml has none).
    const postgis =
      !ignore &&
      rows(await (await session()).execute(`select 1 from pg_extension where extname = 'postgis'`, { rowLimit: 1 }))
        .length > 0
    test.skipIf(!postgis)(`${name}: PostGIS geometry and geography as EWKT`, async () => {
      const s = await session()
      const sql = `select 'SRID=4326;POINT(7.1 50.7)'::geometry as g, 'POINT Z (1 2 3)'::geometry as z,
        'LINESTRING(0 0, 1 1)'::geography as geo, null::geometry as n`
      const expected = [['SRID=4326;POINT (7.1 50.7)', 'POINT Z (1 2 3)', 'SRID=4326;LINESTRING (0 0, 1 1)', null]]
      assertEquals(rows(await s.execute(sql, { rowLimit: 1 })), expected)
      const streamed: unknown[][] = []
      await s.stream(sql, {
        columns: () => {},
        rows: async (r) => {
          streamed.push(...r)
        },
      })
      assertEquals(streamed, expected)
    })

    test.skipIf(ignore)(`${name}: date and timestamp arrays keep the unified string form`, async () => {
      const [[ts, d, tz]] = rows(
        await (
          await session()
        ).execute(
          `select array['2024-01-02 03:04:05.123456'::timestamp, null] as ts, array['2024-01-02'::date] as d,
           array['2024-01-02 03:04:05+00'::timestamptz] as tz`,
          { rowLimit: 1 },
        ),
      ) as [[string[], string[], string[]]]
      assertEquals(ts, ['2024-01-02T03:04:05.123456', null])
      assertEquals(d, ['2024-01-02'])
      assertMatch(tz[0]!, /^2024-01-0[12]T\d{2}:\d{2}:05[+-]\d{2}:\d{2}$/)
    })

    test.skipIf(ignore)(`${name}: search path`, async () => {
      const s = await (await loadDriver(name)).connect({ ...c.config, searchPath: 'sales, public' })
      try {
        assertEquals(rows(await s.execute('show search_path', { rowLimit: 1 })), [['sales, public']])
      } finally {
        await s.close()
      }
    })
  }

  if (name === 'mssql') {
    test.skipIf(ignore)(`${name}: GO separates batches`, async () => {
      const r = await (
        await session()
      ).execute(`declare @x int = 1\nselect @x as a\nGO\nselect 2 as b`, {
        rowLimit: 10,
      })
      assertEquals(
        r.resultSets.map((s) => s.rows),
        [[[1]], [[2]]],
      )
      await assertRejects(
        () => session().then((s) => s.execute(`select 1\nGO\nselect * from does_not_exist`, { rowLimit: 1 })),
        Error,
        'Batch 2:',
      )
    })

    test.skipIf(ignore)(`${name}: session language and date format`, async () => {
      const s = await (
        await loadDriver(name)
      ).connect({
        ...c.config,
        language: 'Deutsch',
        dateFormat: 'ymd',
        connectRetries: 0,
        multiSubnetFailover: true,
      })
      try {
        assertEquals(
          rows(
            await s.execute(
              `select @@language as lang, date_format from sys.dm_exec_sessions where session_id = @@spid`,
              { rowLimit: 1 },
            ),
          ),
          [['Deutsch', 'ymd']],
        )
      } finally {
        await s.close()
      }
    })
  }

  test.skipIf(ignore)(`${name}: stream`, async () => {
    const s = await session()
    let columns: string[] = []
    let count = 0
    let maxBatch = 0
    await s.stream(`select id, total from ${c.schema}.orders`, {
      columns: (cols) => (columns = cols.map((col) => col.name)),
      // A slow consumer: the driver must wait instead of buffering everything.
      rows: async (rows) => {
        count += rows.length
        maxBatch = Math.max(maxBatch, rows.length)
        await new Promise((r) => setTimeout(r, 1))
      },
    })
    assertEquals(columns, ['id', 'total'])
    assertEquals(count, 50_000)
    assert(maxBatch <= 2048, `batch of ${maxBatch} rows`)

    // A failing sink aborts the statement; the session stays usable.
    let seen = 0
    await assertRejects(
      () =>
        s.stream(`select id from ${c.schema}.orders`, {
          columns: () => {},
          rows: async (rows) => {
            seen += rows.length
            throw new Error('client gone')
          },
        }),
      Error,
      'client gone',
    )
    assert(seen <= 2048, `${seen} rows after abort`)
    assertEquals(rows(await s.execute('select 1 as x', { rowLimit: 10 })), [[1]])
  })

  test.skipIf(ignore)(`${name}: cancel`, async () => {
    const s = await session()
    const started = performance.now()
    const running = assertRejects(() => s.execute(c.sleep, { rowLimit: 1 }))
    await new Promise((r) => setTimeout(r, 500))
    await s.cancel()
    await running
    assert(performance.now() - started < 10_000, 'cancel took too long')
    assertEquals(rows(await s.execute('select 1 as x', { rowLimit: 10 })), [[1]])
  })

  test.skipIf(ignore)(`${name}: introspection`, async () => {
    const s = await session()
    const schemas = (await s.introspect({ kind: 'schemas' })).map((x) => x.name)
    assert(schemas.includes(c.schema), `schemas: ${schemas}`)
    const databases = (await s.introspect({ kind: 'databases' })).map((x) => x.name)
    assert(databases.includes(c.config.database ?? 'memory'), `databases: ${databases}`)
    for (const stmt of c.annotate) await s.execute(stmt, { rowLimit: 1 })
    const tables = await s.introspect({ kind: 'tables', schema: c.schema })
    const orders = tables.find((t) => t.name === 'orders')!
    assertEquals(orders.kind, 'table')
    assertEquals(orders.comment, name === 'sqlite' ? null : 'Orders')
    assertEquals(orders.partitioning, null)
    // Statistics are approximate: InnoDB samples pages.
    assert(orders.rowEstimate! > 25_000 && orders.rowEstimate! < 100_000, `rowEstimate: ${orders.rowEstimate}`)
    const view = tables.find((t) => t.name === 'order_totals')!
    assertEquals(view.kind, 'view')
    assertEquals(view.rowEstimate, null)
    assertEquals(view.comment, null)
    const cols = Object.fromEntries(
      (await s.introspect({ kind: 'columns', schema: c.schema, table: 'orders' })).map((col) => [col.name, col]),
    )
    assertEquals(cols.id!.primaryKey, true)
    assertEquals(cols.id!.nullable, false)
    assertEquals(cols.customer_id!.primaryKey, false)
    assertEquals(cols.customer_id!.references, { schema: c.customersSchema, table: 'customers', column: 'id' })
    assertEquals(cols.customer_id!.indexes, ['orders_customer_idx'])
    assertMatch(cols.total!.type, /^(numeric|decimal)\(12,\s?2\)$/i)
    assertEquals(cols.total!.comment, name === 'sqlite' ? null : 'Order total')
    assertEquals(cols.id!.comment, null)
  })

  test.skipIf(ignore)(`${name}: indexes, routines, DDL`, async () => {
    const s = await session()
    const indexes = await s.introspect({ kind: 'indexes', schema: c.schema, table: 'orders' })
    assertEquals(
      indexes.filter((i) => i.primary).map((i) => [i.columns, i.unique]),
      [[['id'], true]],
    )
    assertEquals(
      indexes.find((i) => i.name === 'orders_customer_idx'),
      {
        name: 'orders_customer_idx',
        columns: ['customer_id'],
        unique: false,
        primary: false,
      },
    )

    for (const stmt of c.routines) await s.execute(stmt, { rowLimit: 1 })
    if (name === 'sqlite') assertEquals(await s.introspect({ kind: 'routines', schema: c.schema }), [])
    else {
      try {
        const routines = await s.introspect({ kind: 'routines', schema: c.schema })
        assertEquals(
          routines.find((r) => r.name === 'colwerk_add_so'),
          { name: 'colwerk_add_so', kind: 'function' },
        )
        if (name !== 'duckdb') assertEquals(routines.find((r) => r.name === 'colwerk_touch_so')?.kind, 'procedure')
        assert(!routines.some((r) => ['sum', 'abs', 'now'].includes(r.name)), 'built-in functions listed')
        assertMatch(
          await s.introspect({ kind: 'ddl', schema: c.schema, name: 'colwerk_add_so', object: 'routine' }),
          /colwerk_add_so[\s\S]*\+ 1/,
        )
      } finally {
        for (const stmt of c.dropRoutines) await s.execute(stmt, { rowLimit: 1 })
      }
    }

    const table = await s.introspect({ kind: 'ddl', schema: c.schema, name: 'orders', object: 'table' })
    assertMatch(table, /^create table/i)
    for (const part of [/customer_id/, /references/i, /orders_customer_idx/]) assertMatch(table, part)
    assertMatch(
      await s.introspect({ kind: 'ddl', schema: c.schema, name: 'order_totals', object: 'view' }),
      /^create\b[\s\S]*view[\s\S]*sum\(/i,
    )
    await assertRejects(() =>
      s.introspect({ kind: 'ddl', schema: c.schema, name: 'does_not_exist_so', object: 'view' }),
    )
  })

  test.skipIf(ignore)(`${name}: close`, async () => {
    await shared?.close()
  })
}
