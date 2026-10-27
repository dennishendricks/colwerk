// Workbench behaviour on top of the drivers: timeout, cancelling on tab close, DuckDB read-only, introspection cache.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { join } from 'node:path'
import type { ConnectionConfig } from '../core/types.ts'
import { Workbench } from '../core/workbench.ts'

const opts = { sanitizeResources: false, sanitizeOps: false }
const SLOW = 'select count(*) from range(100000000000) a'

function workbench(config: ConnectionConfig) {
  return new Workbench(async () => config)
}

Deno.test({ name: 'timeout cancels the statement', ...opts }, async () => {
  const wb = workbench({ id: 'wb-timeout', name: 'duck', dialect: 'duckdb', file: ':memory:' })
  const started = performance.now()
  await assertRejects(() => wb.execute('tab', 'wb-timeout', SLOW, 1, 1), Error, 'did not finish within 1 s')
  assert(performance.now() - started < 5_000, 'timeout took too long')
  assertEquals((await wb.execute('tab', 'wb-timeout', 'select 1 as x', 10, 1)).resultSets[0]!.rows, [[1]])
  await wb.closeAll()
})

Deno.test({ name: 'closing a tab cancels its statement', ...opts }, async () => {
  const wb = workbench({ id: 'wb-close', name: 'duck', dialect: 'duckdb', file: ':memory:' })
  const started = performance.now()
  const running = assertRejects(() => wb.execute('tab', 'wb-close', SLOW, 1, 600))
  await new Promise(r => setTimeout(r, 500))
  await wb.cancel('tab')
  await wb.closeTab('tab')
  await running
  assert(performance.now() - started < 5_000, 'cancel took too long')
  await wb.closeAll()
})

// The metadata session stays open while the tab session connects; before, the second connect hung forever
// once the first instance object had been garbage-collected (needs `--v8-flags=--expose-gc`).
Deno.test({ name: 'duckdb: file reconnects after garbage collection', ...opts }, async () => {
  const dir = await Deno.makeTempDir()
  const config: ConnectionConfig = { id: 'wb-gc', name: 'duck', dialect: 'duckdb', file: join(dir, 'gc.duckdb') }
  const wb = workbench(config)
  await wb.introspect('wb-gc', { kind: 'schemas' })
  const gc = (globalThis as { gc?: () => void }).gc
  assert(gc, 'run with --v8-flags=--expose-gc')
  for (let i = 0; i < 5; i++) {
    gc()
    await new Promise(r => setTimeout(r, 20))
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const hung = new Promise<never>((_, reject) => timer = setTimeout(() => reject(new Error('connect hung')), 5_000))
  try {
    assertEquals((await Promise.race([wb.execute('tab', 'wb-gc', 'select 1 as x', 10, 10), hung])).resultSets[0]!.rows, [[1]])
  } finally {
    clearTimeout(timer)
  }
  await wb.closeAll()
  await Deno.remove(dir, { recursive: true })
})

Deno.test({ name: 'duckdb: read-only file', ...opts }, async () => {
  const dir = await Deno.makeTempDir()
  const file = join(dir, 'ro.duckdb')
  const config: ConnectionConfig = { id: 'wb-ro', name: 'duck', dialect: 'duckdb', file }
  const wb = workbench(config)
  await wb.execute('tab', 'wb-ro', 'create table t as select 1 as x', 1, 10)
  // Switching an existing connection to read-only, as after editing it.
  await wb.closeConnection('wb-ro')
  config.readOnly = true
  assertEquals((await wb.execute('tab', 'wb-ro', 'select x from t', 10, 10)).resultSets[0]!.rows, [[1]])
  await assertRejects(() => wb.execute('tab', 'wb-ro', 'insert into t values (2)', 1, 10), Error, 'read-only')
  await wb.closeAll()
  await Deno.remove(dir, { recursive: true })
})

Deno.test({ name: 'refreshing a table drops its cached indexes; DDL is never cached', ...opts }, async () => {
  const wb = workbench({ id: 'wb-cache', name: 'duck', dialect: 'duckdb', file: ':memory:' })
  const indexes = async () => (await wb.introspect('wb-cache', { kind: 'indexes', schema: 'main', table: 't' })).map(i => i.name)
  const ddl = () => wb.introspect('wb-cache', { kind: 'ddl', schema: 'main', name: 't', object: 'table' })
  await wb.execute('tab', 'wb-cache', 'create table t (x int)', 1, 10)
  assertEquals(await indexes(), [])
  assert(!(await ddl()).includes('t_x'))
  await wb.execute('tab', 'wb-cache', 'create index t_x on t (x)', 1, 10)
  assertEquals(await indexes(), [])
  assert((await ddl()).includes('t_x'))
  await wb.introspect('wb-cache', { kind: 'columns', schema: 'main', table: 't' }, true)
  assertEquals(await indexes(), ['t_x'])
  await wb.closeAll()
})
