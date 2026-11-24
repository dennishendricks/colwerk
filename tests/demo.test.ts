// Demo database of the guided tours: the setup runs again on every tour start and restores deleted rows
import { test } from 'bun:test'
import { DEMO_SETUP_SQL } from '../core/demo.ts'
import { duckdbDriver } from '../core/drivers/duckdb.ts'
import { assertEquals } from './assert.ts'

test('demo: setup creates the tables, can run again and restores deleted rows', async () => {
  const s = await duckdbDriver.connect({ id: 'demo-test', name: 'demo', dialect: 'duckdb', file: ':memory:' })
  const counts = async () =>
    (
      await s.execute(
        'select (select count(*) from customers), (select count(*) from products), (select count(*) from orders)',
        { rowLimit: 1 },
      )
    ).resultSets[0]!.rows[0]
  try {
    await s.execute(DEMO_SETUP_SQL, { rowLimit: 1 })
    assertEquals(await counts(), ['50', '5', '200'])
    await s.execute('delete from orders where id <= 10', { rowLimit: 1 })
    await s.execute(DEMO_SETUP_SQL, { rowLimit: 1 })
    assertEquals(await counts(), ['50', '5', '200'])
    const fks = await s.execute(
      "select count(*) from duckdb_constraints() where constraint_type = 'FOREIGN KEY' and table_name = 'orders'",
      { rowLimit: 1 },
    )
    assertEquals(fks.resultSets[0]!.rows[0], ['2'])
  } finally {
    await s.close()
  }
})
