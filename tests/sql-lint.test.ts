import { test } from 'bun:test'
import { assert, assertEquals } from './assert.ts'
import { lintSql, type LintOptions } from '../app/utils/sql-lint.ts'
import type { SchemaModel } from '../app/utils/sql-scope.ts'
import type { SplitDialect } from '../app/utils/sql-split.ts'

// The tables of docker/init/postgres.sql, plus a second schema for the other cases.
const model: SchemaModel = {
  defaultSchema: 'public',
  tables: {
    public: {
      customers: ['id', 'email', 'name', 'created_at'],
      order_items: ['order_id', 'line', 'qty'],
    },
    sales: {
      orders: ['id', 'customer_id', 'total', 'payload', 'placed_at'],
      order_totals: ['customer_id', 'total'],
    },
  },
  foreignKeys: [],
  functions: [],
}

const on: LintOptions = { names: true, writes: true }
const lint = (sql: string, dialect: SplitDialect = 'postgres', options = on) => lintSql(sql, dialect, model, options)
const keys = (sql: string, dialect: SplitDialect = 'postgres') => lint(sql, dialect).map((d) => d.key)

const valid: [string, SplitDialect?][] = [
  ['select * from customers'],
  ['select c.id, o.total from customers c join sales.orders o on o.customer_id = c.id'],
  ['select c.id, o.id from customers c, sales.orders o where c.id = o.customer_id'],
  ['with t as (select id from customers) select t.id from t'],
  ['with recursive s(i) as (select 1 union all select i + 1 from s where i < 10) select i from s'],
  ['select * from customers c where exists (select 1 from sales.orders o where o.customer_id = c.id)'],
  ['select id, (select count(*) from sales.orders o where o.customer_id = c.id) n from customers c'],
  ['select c.name, x.n from customers c, lateral (select count(*) n from sales.orders o where o.customer_id = c.id) x'],
  ['select * from (values (1, 2)) as v(a, b) where a = 1'],
  ['insert into customers (id, email) select id, email from customers where id > 5'],
  ['insert into sales.orders (id, customer_id, total) select o.id, c.id, 1 from customers c, sales.orders o'],
  ['update sales.orders o set total = c.id from customers c where c.id = o.customer_id'],
  ['delete from sales.orders o using customers c where c.id = o.customer_id and c.name is null'],
  ['select "Name" from (select name as "Name" from customers) q'],
  ['select C.ID, o.TOTAL from CUSTOMERS c join SALES.ORDERS o on o.customer_id = c.id'],
  ['select c.id as cid, o.total from customers c join sales.orders o on o.customer_id = c.id order by cid, total'],
  ['select c.id, o.total from customers c join sales.orders o using (id)'],
  ['select * from customers natural join sales.order_totals'],
  ['select * from pg_catalog.pg_tables where schemaname = $1'],
  ['select * from pg_tables'],
  ['select * from information_schema.columns where table_name = $1'],
  ['create temp table t (x int); select x from t'],
  [
    'select extract(year from created_at), cast(id as text), substring(name from 2) from customers c join sales.orders o on true',
  ],
  ['select * from generate_series(1, 3) g(n) join customers c on c.id = g.n'],
  ['select count(*) from customers c join sales.orders o on o.customer_id = c.id group by c.name order by count(*)'],
  ['select 1', 'mysql'],
  ['select 1 from dual', 'mysql'],
  ['select * from `customers` c join `sales`.`orders` o on o.customer_id = c.id', 'mysql'],
  ['select * from #tmp t join @vars v on v.id = t.id', 'mssql'],
  ['select * from [public].[customers] c join [sales].[orders] o on o.customer_id = c.id', 'mssql'],
  ['update t set total = 1 from sales.orders t join customers c on c.id = t.customer_id where c.id = 1', 'mssql'],
  [
    `merge into sales.orders as t using (select 1 as id, 2 as total) as s on t.id = s.id
      when matched then update set total = s.total when not matched then insert (id, total) values (s.id, s.total)`,
    'mssql',
  ],
  [
    'select o.id, row_number() over (partition by o.customer_id order by placed_at desc) rn from customers c join sales.orders o on true',
  ],
  [`select * from read_csv('a.csv') r join missing_table m on m.id = r.id`, 'duckdb'],
  ['select * from range(10) r(i), customers c where c.id = r.i', 'duckdb'],
  ['select * from numbers(10) n join anything a on a.x = n.number', 'clickhouse'],
  ['select * from sqlite_master where name = ?', 'sqlite'],
  // The reads of tests/drivers.test.ts
  ['select * from sales.orders'],
  ['select * from sales.orders where id <= 5'],
  ['select id, total from sales.orders'],
  ['select customer_id, sum(total) as total from sales.orders group by customer_id'],
  ['select 1 as x'],
  ['select 1 as a; select 2 as b'],
  [`select current_setting('server_version_num')::int >= 180000`],
  [`select 1 from pg_extension where extname = 'postgis'`],
  ['select 1\nGO\nselect 2 as b', 'mssql'],
]

test('lint: valid queries have no warnings', () => {
  assert(valid.length >= 25)
  for (const [sql, dialect] of valid) assertEquals(lint(sql, dialect), [], sql)
})

test('lint: unknown tables and columns, ambiguous names, writes without WHERE', () => {
  assertEquals(lint('select * from ordrs'), [{ from: 14, to: 19, key: 'unknownTable', params: { name: 'ordrs' } }])
  assertEquals(lint('select * from sales.ordrs')[0]?.params, { name: 'sales.ordrs' })
  assertEquals(lint('select o.totl from sales.orders o'), [
    { from: 9, to: 13, key: 'unknownColumn', params: { table: 'orders', name: 'totl' } },
  ])
  assertEquals(lint('select id from customers c join sales.orders o on o.customer_id = c.id'), [
    { from: 7, to: 9, key: 'ambiguousColumn', params: { name: 'id', tables: 'c, o' } },
  ])
  assertEquals(keys('delete from sales.orders'), ['missingWhere'])
  assertEquals(keys('with x as (select 1) update sales.orders set total = 0'), ['missingWhere'])
  assertEquals(lint('update sales.orders set total = 0')[0]?.params, { statement: 'UPDATE' })
  assertEquals(keys('update sales.orders set total = 0 where id = 1'), [])
  // Each statement on its own.
  assertEquals(keys('delete from sales.orders where id = 1; delete from customers'), ['missingWhere'])
})

test('lint: switches', () => {
  const sql = 'delete from ordrs'
  assertEquals(
    lint(sql, 'postgres', { names: false, writes: true }).map((d) => d.key),
    ['missingWhere'],
  )
  assertEquals(
    lint(sql, 'postgres', { names: true, writes: false }).map((d) => d.key),
    ['unknownTable'],
  )
  assertEquals(lint(sql, 'postgres', { names: false, writes: false }), [])
})

test('lint: dynamic dialects never report unknown names', () => {
  assertEquals(keys('select o.totl from sales.orders o join nowhere n on true', 'duckdb'), [])
  assertEquals(keys('select * from ordrs', 'clickhouse'), [])
  // Ambiguity is a mistake in every dialect.
  assertEquals(keys('select id from customers c join sales.orders o on true', 'duckdb'), ['ambiguousColumn'])
})
