import { test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { duckdbDriver } from '../core/drivers/duckdb.ts'
import { AppError, type ConnectionConfig, type Session } from '../core/types.ts'
import { assert, assertEquals, assertMatch, assertRejects } from './assert.ts'
import { tempDir } from './helpers.ts'

const run = (s: Session, sql: string) => s.execute(sql, { rowLimit: 100 })

async function withFiles(fn: (db: string, txt: string, config: ConnectionConfig) => Promise<void>) {
  const dir = await tempDir()
  const db = `${dir}/data.duckdb`
  const txt = `${dir}/secret.txt`
  await writeFile(txt, 'a,b\n1,2\n')
  const config: ConnectionConfig = { id: 'sandbox-test', name: 'duck', dialect: 'duckdb', file: db }
  const editor = await duckdbDriver.connect(config)
  await run(editor, 'create table t(i int)')
  await run(editor, 'insert into t values (1), (2)')
  await editor.close()
  try {
    await fn(db, txt, config)
  } finally {
    await rm(dir, { recursive: true })
  }
}

const sandbox = (config: ConnectionConfig) => duckdbDriver.connect({ ...config, mcpSandbox: true })

test('duckdb sandbox: reads the tables, but no files, writes or settings', () =>
  withFiles(async (_db, txt, config) => {
    const s = await sandbox(config)
    try {
      assertEquals((await run(s, 'select i from t order by i')).resultSets[0]!.rows, [[1], [2]])
      for (const sql of [`select * from read_text('${txt}')`, `select * from read_csv('${txt}')`]) {
        const e = await assertRejects(() => run(s, sql))
        assertMatch(e.message, /external access|disabled/i)
      }
      await assertRejects(() => run(s, 'create table x(i int)'))
      await assertRejects(() => run(s, 'set enable_external_access = true'))
    } finally {
      await s.close()
    }
  }))

test('duckdb sandbox: refuses a file the editor holds for writing, accepts it read-only or once closed', () =>
  withFiles(async (_db, _txt, config) => {
    const editor = await duckdbDriver.connect(config)
    const e = await assertRejects(() => sandbox(config))
    assert(e instanceof AppError && e.key === 'mcpDuckdbInUse')
    await editor.close()
    await (await sandbox(config)).close()
    const readOnly = await duckdbDriver.connect({ ...config, readOnly: true })
    try {
      await (await sandbox(config)).close()
    } finally {
      await readOnly.close()
    }
  }))

test('duckdb sandbox: an in-memory database is empty and cannot read files either', () =>
  withFiles(async (_db, txt) => {
    const s = await duckdbDriver.connect({
      id: 'sandbox-memory',
      name: 'mem',
      dialect: 'duckdb',
      file: ':memory:',
      mcpSandbox: true,
    })
    try {
      await assertRejects(() => run(s, `select * from read_text('${txt}')`))
    } finally {
      await s.close()
    }
  }))
