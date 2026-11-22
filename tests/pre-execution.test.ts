// Dry run of data-modifying statements and the checks before running a query.
import { test } from 'bun:test'
import { AppError, type CellValue, type ConnectionConfig, type ResultSet } from '../core/types.ts'
import { clickhouseScans, mssqlScans, mysqlScans, postgresScans } from '../core/plan-check.ts'
import { dmlKind } from '../core/sql-dml.ts'
import { Workbench } from '../core/workbench.ts'
import { assertEquals, assertRejects } from './assert.ts'
import { reachable, testConnections } from './helpers.ts'

test('dmlKind: exactly one data-modifying statement', () => {
  const cases: [string, ReturnType<typeof dmlKind>][] = [
    ['update t set a = 1', 'update'],
    ['with x as (select 1) delete from t where a in (select * from x)', 'delete'],
    ['insert into t select 1', 'insert'],
    ['merge into t using s on t.a = s.a when matched then delete', 'merge'],
    ['select * from t', undefined],
    ['create table t (a int)', undefined],
    ['update t set a = 1; select 1', undefined],
    ['with d as (delete from t) select * from d', undefined],
    [`select 'update'`, undefined],
  ]
  for (const [sql, kind] of cases) assertEquals(dmlKind(sql, 'postgres'), kind, sql)
})

function workbench(config: ConnectionConfig) {
  return new Workbench(async () => config)
}

const embedded: ConnectionConfig[] = [
  { id: 'dry-duck', name: 'duck', dialect: 'duckdb', file: ':memory:' },
  { id: 'dry-sqlite', name: 'sqlite', dialect: 'sqlite', file: ':memory:' },
]

for (const config of embedded) {
  test(`${config.dialect}: dry run reports the affected rows and rolls back`, async () => {
    const wb = workbench(config)
    const id = config.id
    const count = async () => (await wb.execute('tab', id, 'select count(*) from t', 1, 10)).resultSets[0]!.rows[0]![0]
    await wb.execute('tab', id, 'create table t as select 1 as x union all select 2 union all select 3', 1, 10)
    const result = await wb.dryRun('tab', id, 'delete from t where x < 3', 10)
    assertEquals(result.affectedRows, 2)
    assertEquals(Number(await count()), 3)
    await assertRejects(() => wb.dryRun('tab', id, 'select 1', 10), AppError, 'single INSERT')
    await assertRejects(() => wb.dryRun('tab', id, 'delete from t; delete from t', 10), AppError, 'single INSERT')
    await wb.closeAll()
  })
}

test('dry run is refused on read-only connections and unsupported engines', async () => {
  const readOnly = workbench({ ...embedded[0]!, readOnly: true })
  const e1 = await assertRejects(() => readOnly.dryRun('tab', 'dry-duck', 'delete from t', 10), AppError)
  assertEquals(e1.key, 'dryRunReadOnly')
  const clickhouse = workbench(testConnections.clickhouse)
  const e2 = await assertRejects(() => clickhouse.dryRun('tab', 'ch', 'delete from t', 10), AppError)
  assertEquals(e2.key, 'dryRunUnsupported')
})

test.skipIf(!(await reachable(testConnections.mysql)))('mysql: dry run needs transactional tables', async () => {
  const wb = workbench(testConnections.mysql)
  const id = testConnections.mysql.id
  await wb.execute('tab', id, 'create table dry_myisam (x int) engine = MyISAM', 1, 10)
  await wb.execute('tab', id, 'create table dry_innodb (x int) engine = InnoDB', 1, 10)
  try {
    await wb.execute('tab', id, 'insert into dry_innodb values (1), (2)', 1, 10)
    const e = await assertRejects(() => wb.dryRun('tab', id, 'delete from dry_myisam', 10), AppError)
    assertEquals(e.key, 'dryRunNonTransactional')
    assertEquals((await wb.dryRun('tab', id, 'delete from dry_innodb', 10)).affectedRows, 2)
    assertEquals((await wb.execute('tab', id, 'select count(*) from dry_innodb', 1, 10)).resultSets[0]!.rows, [['2']])
  } finally {
    await wb.execute('tab', id, 'drop table dry_myisam', 1, 10)
    await wb.execute('tab', id, 'drop table dry_innodb', 1, 10)
    await wb.closeAll()
  }
})

const resultSet = (names: string[], rows: string[][]): ResultSet => ({
  columns: names.map((name) => ({ name, type: 'text' })),
  rows,
  truncated: false,
})

test('plan parsers find the tables a plan reads completely', () => {
  const pg: CellValue = [
    {
      Plan: {
        'Node Type': 'Nested Loop',
        Plans: [
          { 'Node Type': 'Seq Scan', 'Relation Name': 'orders', Schema: 'public' },
          { 'Node Type': 'Index Scan' },
        ],
      },
    },
  ]
  const orders = [{ schema: 'public', table: 'orders' }]
  assertEquals(postgresScans(pg), orders)
  assertEquals(postgresScans(JSON.stringify(pg)), orders)

  const v1 = {
    query_block: {
      nested_loop: [
        { table: { table_name: 'o', access_type: 'ALL', rows_examined_per_scan: 5000 } },
        { table: { access_type: 'ref' } },
      ],
    },
  }
  assertEquals(mysqlScans(JSON.stringify(v1)), [{ table: 'o', rows: 5000 }])
  const maria = { query_block: { table: { table_name: 't', access_type: 'ALL', rows: 12 } } }
  assertEquals(mysqlScans(JSON.stringify(maria)), [{ table: 't', rows: 12 }])

  const mssql = resultSet(
    ['PhysicalOp', 'Argument'],
    [
      ['Clustered Index Scan', 'OBJECT:([dbm].[dbo].[orders].[PK_orders] AS [o]), WHERE:(x)'],
      ['Index Seek', 'OBJECT:([dbm].[dbo].[items].[IX_items]), SEEK:(y)'],
    ],
  )
  assertEquals(mssqlScans(mssql), [{ schema: 'dbo', table: 'orders' }])

  const ch = resultSet(['database', 'table', 'parts', 'rows', 'marks'], [['dbm', 'events', '3', '2500000', '310']])
  assertEquals(clickhouseScans(ch), [{ schema: 'dbm', table: 'events', rows: 2_500_000 }])
})

test('plan check does nothing on embedded engines', async () => {
  const wb = workbench(embedded[0]!)
  assertEquals(await wb.planWarnings('tab', 'dry-duck', 'select * from range(10)'), [])
  await wb.closeAll()
})

test.skipIf(!(await reachable(testConnections.postgres)))(
  'postgres: warns about a full scan until an index exists',
  async () => {
    const config = { ...testConnections.postgres, scanRowThreshold: 1000 }
    const wb = workbench(config)
    const id = config.id
    await wb.execute('tab', id, 'create table plan_t as select g as x from generate_series(1, 5000) g', 1, 10)
    try {
      await wb.execute('tab', id, 'analyze plan_t', 1, 10)
      const warnings = await wb.planWarnings('tab', id, 'select * from plan_t where x = 5')
      assertEquals(
        warnings.map((w) => w.table),
        ['public.plan_t'],
      )
      assertEquals(Math.round(warnings[0]!.rows / 1000), 5)
      await wb.execute('tab', id, 'create index on plan_t (x)', 1, 10)
      await wb.execute('tab', id, 'analyze plan_t', 1, 10)
      assertEquals(await wb.planWarnings('tab', id, 'select * from plan_t where x = 5'), [])
    } finally {
      await wb.execute('tab', id, 'drop table plan_t', 1, 10)
      await wb.closeAll()
    }
  },
)
