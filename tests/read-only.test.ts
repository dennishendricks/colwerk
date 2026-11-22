// Read-only enforcement by the database itself (the workbench's statement check is tested in workbench.test.ts).
import { test } from 'bun:test'
import { assertMatch, assertRejects } from './assert.ts'
import { loadDriver } from '../core/registry.ts'
import type { ConnectionConfig } from '../core/types.ts'
import { reachable, testConnections } from './helpers.ts'

const options = { rowLimit: 10 }

async function connect(config: ConnectionConfig, readOnly: boolean) {
  return (await loadDriver(config.dialect)).connect({ ...config, id: `ro-${config.id}`, readOnly })
}

test.skipIf(!(await reachable(testConnections.postgres)))('postgres: read-only session refuses writes', async () => {
  const s = await connect(testConnections.postgres, true)
  try {
    const err = await assertRejects(() => s.execute('create table ro_t (x int)', options), Error)
    assertMatch(err.message, /read-only/)
  } finally {
    await s.close()
  }
})

test.skipIf(!(await reachable(testConnections.mysql)))('mysql: read-only session refuses writes', async () => {
  const normal = await connect(testConnections.mysql, false)
  const s = await connect(testConnections.mysql, true)
  try {
    await normal.execute('create table ro_t (x int) engine = InnoDB', options)
    const err = await assertRejects(() => s.execute('insert into ro_t values (1)', options), Error)
    assertMatch(err.message, /READ ONLY/i)
  } finally {
    await s.close()
    await normal.execute('drop table if exists ro_t', options)
    await normal.close()
  }
})

test.skipIf(!(await reachable(testConnections.clickhouse)))(
  'clickhouse: read-only session refuses writes',
  async () => {
    const s = await connect(testConnections.clickhouse, true)
    try {
      const err = await assertRejects(() => s.execute('create table ro_t (x Int32) engine = Memory', options), Error)
      assertMatch(err.message, /readonly/i)
    } finally {
      await s.close()
    }
  },
)
