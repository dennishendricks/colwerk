// Data compare: pull adapter, key order, literals, and end-to-end runs on DuckDB and SQLite.
import { test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compareData, compareKeys, literal, pull } from '../core/compare/data.ts'
import { SCRIPT_LIMIT } from '../core/compare/types.ts'
import { AppError, type CellValue, type ConnectionConfig } from '../core/types.ts'
import { Workbench } from '../core/workbench.ts'
import { assert, assertEquals, assertRejects } from './assert.ts'
import { tempDir } from './helpers.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('pull holds at most one batch while the consumer is slow', async () => {
  let produced = 0
  const rows = pull(async (sink) => {
    for (let b = 0; b < 5; b++) {
      produced++
      await sink.rows([[b * 3], [b * 3 + 1], [b * 3 + 2]])
    }
  })
  const seen: CellValue[] = []
  for (let row; (row = await rows.next());) {
    seen.push(row[0]!)
    await sleep(5)
    // The stream continues only after the batch has been read completely.
    assertEquals(produced, Math.floor((seen.length - 1) / 3) + 1)
  }
  assertEquals(
    seen,
    Array.from({ length: 15 }, (_, i) => i),
  )
})

test('pull passes on a failure of the stream and ends the stream on close', async () => {
  const failing = pull(async (sink) => {
    await sink.rows([[1]])
    throw new Error('boom')
  })
  assertEquals(await failing.next(), [1])
  await assertRejects(() => failing.next(), Error, 'boom')

  let stopped = false
  const endless = pull(async (sink) => {
    try {
      for (;;) await sink.rows([[1]])
    } catch {
      stopped = true
    }
  })
  await endless.next()
  endless.close()
  await sleep(10)
  assert(stopped)
})

test('compareKeys orders numbers numerically and text by code point', () => {
  assert(compareKeys('number', '10', '9') > 0)
  assert(compareKeys('number', 9, 10) < 0)
  assert(compareKeys('number', '-1.5', '-1.25') < 0)
  assert(compareKeys('number', '-0', '0') === 0)
  assert(compareKeys('number', '12345678901234567890', '12345678901234567891') < 0)
  assertEquals(compareKeys('number', '1.50', '1.5'), 0)
  assert(compareKeys('text', '10', '9') < 0)
  // U+1F600 is a surrogate pair in UTF-16, which `<` would sort before U+FFFF.
  assert(compareKeys('text', '\u{1F600}', '￿') > 0)
  assert(compareKeys('guid', 'abc', 'ABD') < 0)
})

test('literals per dialect', () => {
  assertEquals(literal('postgres', null, 'text'), 'null')
  assertEquals(literal('postgres', true, 'boolean'), 'true')
  assertEquals(literal('mssql', false, 'bit'), '0')
  assertEquals(literal('mysql', 5, 'int'), '5')
  assertEquals(literal('postgres', '12345678901234567890', 'numeric(30,0)'), '12345678901234567890')
  assertEquals(literal('postgres', 'NaN', 'double precision'), `'NaN'::float8`)
  assertEquals(literal('postgres', "it's", 'text'), `'it''s'`)
  assertEquals(literal('mysql', "a\\b'c", 'varchar(10)'), `'a\\\\b''c'`)
  assertEquals(literal('mssql', 'ä', 'nvarchar(10)'), `N'ä'`)
  assertEquals(literal('postgres', '0xdeadbeef', 'bytea'), `'\\xdeadbeef'::bytea`)
  assertEquals(literal('duckdb', '0xdeadbeef', 'BLOB'), `from_hex('deadbeef')`)
  assertEquals(literal('mysql', '0xdeadbeef', 'blob'), '0xdeadbeef')
  assertEquals(literal('mysql', '0x', 'blob'), `''`)
  assertEquals(literal('mssql', '0xdeadbeef', 'varbinary(max)'), '0xdeadbeef')
  assertEquals(literal('sqlite', '0xdeadbeef', 'BLOB'), `X'deadbeef'`)
  assertEquals(literal('postgres', { a: [1, "x'"] }, 'jsonb'), `'{"a":[1,"x''"]}'`)
  assertEquals(literal('postgres', 'text', 'json'), `'"text"'`)
  assertEquals(literal('duckdb', '{"a":1}', 'JSON'), `'{"a":1}'`)
})

interface Engine {
  dialect: 'duckdb' | 'sqlite'
  create: string
  /** Inserts the rows 1..n. */
  fill: (n: number) => string
  /** Value of the column `name` is set to `x` for these ids, `amount` etc. stay. */
  columns: string[]
}

const duckdb: Engine = {
  dialect: 'duckdb',
  create: `create table t (id integer primary key, name varchar, amount decimal(10,2), ts timestamp, b blob, flag boolean, j json)`,
  fill: (
    n,
  ) => `insert into t select i, 'name ' || i, (i * 7 % 100000)::decimal(10,2) / 100, timestamp '2024-01-01' + to_seconds(i),
    encode('b' || i), i % 2 = 0, ('{"a":' || i || '}')::json from range(1, ${n + 1}) r(i)`,
  columns: ['id', 'name', 'amount', 'ts', 'b', 'flag', 'j'],
}
const sqlite: Engine = {
  dialect: 'sqlite',
  create: `create table t (id integer primary key, name text, amount real, ts text, b blob, flag integer, j text)`,
  fill: (n) => `with recursive r(i) as (select 1 union all select i + 1 from r where i < ${n})
    insert into t select i, 'name ' || i, (i * 7 % 100000) / 100.0, '2024-01-01T00:00:00', cast('b' || i as blob), i % 2, '{"a":' || i || '}' from r`,
  columns: ['id', 'name', 'amount', 'ts', 'b', 'flag', 'j'],
}

async function setup(engine: Engine) {
  const dir = await tempDir()
  const config = (id: string): ConnectionConfig => ({
    id,
    name: id,
    dialect: engine.dialect,
    file: engine.dialect === 'sqlite' ? join(dir, `${id}.db`) : ':memory:',
  })
  const configs: Record<string, ConnectionConfig> = { 'cmp-a': config('cmp-a'), 'cmp-b': config('cmp-b') }
  const wb = new Workbench(async (id) => configs[id]!)
  const run = (id: string, sql: string) => wb.execute(`setup-${id}`, id, sql, 10, 120)
  const schema = engine.dialect === 'sqlite' ? 'main' : 'main'
  const compare = (path?: string, signal = new AbortController().signal) =>
    compareData(
      wb,
      engine.dialect,
      {
        id: 'cmp-test',
        source: { connectionId: 'cmp-a', schema, table: 't' },
        target: { connectionId: 'cmp-b', schema, table: 't' },
        path,
      },
      signal,
    )
  for (const id of ['cmp-a', 'cmp-b']) await run(id, engine.create)
  return { dir, wb, run, compare }
}

for (const engine of [duckdb, sqlite]) {
  test(`${engine.dialect}: data compare finds the differences and its script makes both sides equal`, async () => {
    const { wb, run, compare } = await setup(engine)
    try {
      const n = 5000
      await run('cmp-a', engine.fill(n))
      await run('cmp-b', engine.fill(n))
      // Differences around batch borders: missing rows, changed values (also to and from NULL), an extra row.
      await run('cmp-b', `delete from t where id in (1000, 1001, 2048)`)
      await run('cmp-b', `update t set name = 'it''s changed' where id = 2049`)
      await run(
        'cmp-b',
        `update t set amount = 0, flag = ${engine.dialect === 'sqlite' ? '2' : 'not flag'} where id = 4999`,
      )
      await run('cmp-b', `update t set j = null where id = 10`)
      await run('cmp-b', `insert into t (id, name) values (6000, 'extra')`)
      const result = await compare()
      assertEquals(result.counts, { same: n - 6, onlyInSource: 3, onlyInTarget: 1, different: 3 })
      assertEquals(result.keys, ['id'])
      assertEquals(result.statements, 7)
      assertEquals(
        result.samples.different.map((d) => [d.source[0], d.changed]),
        [
          [10, ['j']],
          [2049, ['name']],
          [4999, ['amount', 'flag']],
        ],
      )
      assertEquals(
        result.samples.onlyInSource.map((r) => r[0]),
        [1000, 1001, 2048],
      )
      assert(result.script!.startsWith('-- Sync main.t → main.t (Colwerk)\nbegin;\ndelete from'), result.script!)
      await run('cmp-b', result.script!)
      const after = await compare()
      assertEquals(after.counts, { same: n, onlyInSource: 0, onlyInTarget: 0, different: 0 })
    } finally {
      await wb.closeAll()
    }
  })

  test(`${engine.dialect}: a script beyond the limit is written to the file in chunks`, async () => {
    const { dir, wb, run, compare } = await setup(engine)
    try {
      const n = SCRIPT_LIMIT + 500
      await run('cmp-a', engine.fill(n))
      await run('cmp-b', engine.fill(300))
      await run('cmp-b', `update t set name = 'changed'`)
      await run('cmp-b', `insert into t (id, name) values (20001, 'x'), (20002, 'y')`)
      const withoutPath = await compare()
      assertEquals(withoutPath.script, null)
      assertEquals(withoutPath.statements, n - 300 + 300 + 2)
      const path = join(dir, 'sync.sql')
      const result = await compare(path)
      assertEquals(result.script, null)
      assertEquals(result.counts, { same: 0, onlyInSource: n - 300, onlyInTarget: 2, different: 300 })
      const lines = (await readFile(path, 'utf8')).trimEnd().split('\n')
      assertEquals(lines.slice(0, 3), [
        '-- Sync main.t → main.t (Colwerk)',
        'begin;',
        'delete from "main"."t" where "id" = 20001;',
      ])
      assertEquals(lines.at(-1), 'commit;')
      assertEquals(lines.length, result.statements + 3)
      await run('cmp-b', lines.join('\n'))
      const after = await compare()
      assertEquals(after.counts, { same: n, onlyInSource: 0, onlyInTarget: 0, different: 0 })
    } finally {
      await wb.closeAll()
    }
  })
}

test('data compare reports missing keys and unsupported types', async () => {
  const { wb, run, compare } = await setup({
    ...duckdb,
    create: 'create table t (id integer, name varchar, tags integer[])',
  })
  try {
    await run('cmp-a', `insert into t values (1, 'a', [1])`)
    await run('cmp-b', `insert into t values (1, 'a', [1])`)
    const noKey = await assertRejects(() => compare(), AppError)
    assertEquals(noKey.key, 'compareNoKey')
    // With a key, the list column is the problem.
    const unsupported = await assertRejects(
      () =>
        compareData(
          wb,
          'duckdb',
          {
            id: 'cmp-test',
            keys: ['id'],
            source: { connectionId: 'cmp-a', schema: 'main', table: 't' },
            target: { connectionId: 'cmp-b', schema: 'main', table: 't' },
          },
          new AbortController().signal,
        ),
      AppError,
    )
    assertEquals(unsupported.key, 'compareUnsupportedType')
    assertEquals(unsupported.params, { column: 'tags', type: 'INTEGER[]' })
  } finally {
    await wb.closeAll()
  }
})

test('data compare rejects keys that are NULL or not unique', async () => {
  const { wb, run, compare } = await setup({ ...duckdb, create: 'create table t (id integer, name varchar)' })
  const compareKeyed = (keys: string[]) =>
    compareData(
      wb,
      'duckdb',
      {
        id: 'cmp-test',
        keys,
        source: { connectionId: 'cmp-a', schema: 'main', table: 't' },
        target: { connectionId: 'cmp-b', schema: 'main', table: 't' },
      },
      new AbortController().signal,
    )
  try {
    await run('cmp-a', `insert into t values (1, 'a'), (null, 'c')`)
    await run('cmp-b', `insert into t values (2, 'a')`)
    assertEquals((await assertRejects(() => compareKeyed(['id']), AppError)).key, 'compareNullKey')
    await run('cmp-a', `delete from t where id is null`)
    await run('cmp-a', `insert into t values (1, 'b')`)
    assertEquals((await assertRejects(() => compareKeyed(['id']), AppError)).key, 'compareOrder')
    assertEquals((await compareKeyed(['id', 'name'])).counts.onlyInSource, 2)
    assertEquals((await assertRejects(() => compare(), AppError)).key, 'compareNoKey')
  } finally {
    await wb.closeAll()
  }
})

test('data compare can be cancelled', async () => {
  const { wb, run, compare } = await setup(duckdb)
  try {
    await run('cmp-a', duckdb.fill(200_000))
    await run('cmp-b', duckdb.fill(10))
    const controller = new AbortController()
    const running = assertRejects(() => compare(undefined, controller.signal), AppError)
    controller.abort()
    assertEquals((await running).key, 'cancelled')
  } finally {
    await wb.closeAll()
  }
})
