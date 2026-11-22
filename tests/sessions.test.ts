// Session monitor against the containers of docker-compose.yml (skipped when not reachable): blocking relations,
// cancelling and terminating, and what each engine cannot do.
import { test } from 'bun:test'
import { drivers, loadDriver } from '../core/registry.ts'
import { AppError, type ConnectionConfig, type ServerSession, type Session } from '../core/types.ts'
import { assertEquals, assertRejects } from './assert.ts'
import { reachable, testConnections } from './helpers.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls until `find` returns a session (the monitor sees a statement a moment after it was sent). */
async function waitFor(monitor: Session, find: (all: ServerSession[]) => ServerSession | undefined) {
  for (let i = 0; i < 50; i++) {
    const found = find(await monitor.sessions!())
    if (found) return found
    await sleep(100)
  }
  throw new Error('session not listed within 5 s')
}

const sql = { rowLimit: 1 }
const pidOf = async (s: Session, query: string) => String((await s.execute(query, sql)).resultSets[0]!.rows[0]![0])
const errorKey = async (fn: () => Promise<unknown>) => ((await assertRejects(fn, AppError)) as AppError).key

async function withSessions(config: ConnectionConfig, run: (a: Session, b: Session, m: Session) => Promise<void>) {
  const driver = await loadDriver(config.dialect)
  const opened: Session[] = []
  try {
    for (let i = 0; i < 3; i++) opened.push(await driver.connect(config))
    await run(opened[0]!, opened[1]!, opened[2]!)
  } finally {
    await Promise.all(opened.map((s) => s.close().catch(() => {})))
  }
}

test('only network databases with sessions offer the monitor', () => {
  const actions = (dialect: string) => drivers.find((d) => d.dialect === dialect)!.capabilities.sessionActions
  assertEquals(actions('postgres'), ['cancel', 'terminate'])
  assertEquals(actions('mysql'), ['cancel', 'terminate'])
  assertEquals(actions('mssql'), ['terminate'])
  assertEquals(actions('clickhouse'), ['cancel'])
  for (const dialect of ['duckdb', 'sqlite', 'iceberg']) assertEquals(actions(dialect), [])
})

// A holds a row lock in a transaction, B waits for it.
const locking = {
  postgres: {
    begin: 'begin',
    id: 'select pg_backend_pid()',
    update: `update public.customers set name = name where id = 1`,
    cancel: true,
  },
  mysql: {
    begin: 'start transaction',
    id: 'select connection_id()',
    update: `update customers set name = name where id = 1`,
    cancel: true,
  },
  mssql: {
    begin: 'begin transaction',
    id: 'select @@spid',
    update: `update dbo.customers set name = name where id = 1`,
    cancel: false,
  },
} as const

for (const [dialect, c] of Object.entries(locking)) {
  const config = testConnections[dialect as keyof typeof locking]
  test.skipIf(!(await reachable(config)))(
    `${dialect}: blocking relations, cancel and terminate`,
    async () => {
      await withSessions(config, async (a, b, m) => {
        const [idA, idB] = [await pidOf(a, c.id), await pidOf(b, c.id)]
        await a.execute(c.begin, sql)
        await a.execute(c.update, sql)
        const waiting = assertRejects(() => b.execute(c.update, sql))
        const blocked = await waitFor(m, (all) => all.find((s) => s.id === idB && s.blockedBy.includes(idA)))
        assertEquals(blocked.active, true)
        const holder = (await m.sessions!()).find((s) => s.id === idA)!
        assertEquals(holder.active, true)

        if (c.cancel) {
          await m.stopSession!(idB, 'cancel')
        } else {
          assertEquals(await errorKey(() => m.stopSession!(idB, 'cancel')), 'sessionActionUnsupported')
          await m.stopSession!(idB, 'terminate')
        }
        await waiting
        await m.stopSession!(idA, 'terminate')
        // SQL Server's pool opens a new connection, so a session is gone when the monitor no longer lists it.
        await waitFor(m, (all) => (all.some((s) => s.id === idA) ? undefined : ({} as ServerSession)))
        assertEquals(await errorKey(() => m.stopSession!('not-a-number', 'terminate')), 'sessionNotFound')
      })
    },
    20_000,
  )
}

test.skipIf(!(await reachable(testConnections.postgres)))('postgres: a missing session cannot be stopped', async () => {
  await withSessions(testConnections.postgres, async (_a, _b, m) => {
    assertEquals(await errorKey(() => m.stopSession!('999999999', 'cancel')), 'sessionNotStopped')
  })
})

test.skipIf(!(await reachable(testConnections.clickhouse)))(
  'clickhouse: running queries can be cancelled',
  async () => {
    await withSessions(testConnections.clickhouse, async (a, _b, m) => {
      const running = assertRejects(() =>
        a.execute('select /* colwerk-monitor-test */ count() from numbers(100000000000)', sql),
      )
      const found = await waitFor(m, (all) => all.find((s) => s.query?.includes('colwerk-monitor-test')))
      assertEquals(found.active, true)
      assertEquals(found.blockedBy, [])
      assertEquals(await errorKey(() => m.stopSession!(found.id, 'terminate')), 'sessionActionUnsupported')
      await m.stopSession!(found.id, 'cancel')
      await running
    })
  },
)
