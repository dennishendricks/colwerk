// Files connections (data files and URLs as views of an in-memory DuckDB database). Local files run offline; Excel
// and https need DuckDB's excel and httpfs extensions and are skipped when they cannot be installed. S3 and GCS
// need cloud accounts and are not tested here (their secrets are checked as SQL), like Unity and OneLake.
import { afterAll, beforeAll, test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from '../core/drivers/duckdb-native.ts'
import { addFileSources, fileSecrets, viewNames } from '../core/drivers/lakehouse.ts'
import { driverStatus, loadDriver } from '../core/registry.ts'
import { AppError, type ConnectionConfig, DbError, type Session } from '../core/types.ts'
import { assert, assertEquals } from './assert.ts'
import { tempDir } from './helpers.ts'

let dir: string
let orders: string
let customers: string
let ndjson: string
let events: string
let items: string

async function duckdb(sql: string, load: string[] = []) {
  const conn = await connect(':memory:files-fixture', false, false)
  try {
    for (const statement of [...load.flatMap((e) => [`install ${e}`, `load ${e}`]), sql]) {
      ;(await conn.query(statement)).close()
    }
  } finally {
    conn.close()
  }
}

// Tried while the tests are collected, because skipIf needs the answer then.
const extensions = await duckdb('select 1', ['excel', 'httpfs']).then(
  () => true,
  () => false,
)

beforeAll(async () => {
  dir = await tempDir()
  orders = join(dir, 'orders.csv')
  customers = join(dir, 'customers.tsv')
  events = join(dir, 'events.json')
  ndjson = join(dir, 'events.ndjson')
  items = join(dir, 'items.parquet')
  await writeFile(orders, 'id;customer;total\n1;10;5.5\n2;11;7.25\n3;10;1\n')
  await writeFile(customers, 'id\tname\n10\tAda\n11\tGrace\n')
  await writeFile(events, JSON.stringify([{ kind: 'a' }, { kind: 'b' }]))
  await writeFile(ndjson, '{"kind":"a"}\n{"kind":"b"}\n{"kind":"c"}\n')
  await duckdb(`copy (select i::bigint as id, 'x' || i as label from range(1, 4) t(i)) to '${items}' (format parquet)`)
})

afterAll(() => rm(dir, { recursive: true }))

const rows = async (s: Session, sql: string) => (await s.execute(sql, { rowLimit: 100 })).resultSets[0]!.rows

test('files: every source is a view, and the views can be joined', async () => {
  const config: ConnectionConfig = {
    id: 'files-views',
    name: 'files',
    dialect: 'files',
    sources: [orders, customers, events, ndjson, items],
  }
  const s = await (await loadDriver('files')).connect(config)
  try {
    assertEquals(await s.introspect({ kind: 'schemas' }), [{ name: 'main' }])
    assertEquals(
      (await s.introspect({ kind: 'tables', schema: 'main' })).map((t) => [t.name, t.kind]),
      [
        ['customers', 'view'],
        ['events', 'view'],
        ['events_2', 'view'],
        ['items', 'view'],
        ['orders', 'view'],
      ],
    )
    assertEquals(
      await rows(
        s,
        'select c.name, sum(o.total) from orders o join customers c on c.id = o.customer group by 1 order by 1',
      ),
      [
        ['Ada', 6.5],
        ['Grace', 7.25],
      ],
    )
    assertEquals(await rows(s, 'select count(*) from events_2'), [['3']])
  } finally {
    await s.close()
  }
})

test('viewNames: sanitised, prefixed and numbered', () => {
  assertEquals(viewNames(['/d/2024 Sales-Report.csv']), ['t_2024_sales_report'])
  assertEquals(viewNames(['/d/a.csv', 'C:\\d\\A.tsv', 's3://b/k/a.parquet.gz', 'https://h/p/a%20b.json?x=1']), [
    'a',
    'a_2',
    'a_3',
    'a_b',
  ])
  assertEquals(viewNames(['/d/.csv', '/d/---.csv']), ['t_', 't__2'])
})

test('fileSecrets: S3, GCS and token credentials as DuckDB secrets', () => {
  const base: ConnectionConfig = { id: 'x', name: 'x', dialect: 'files', user: 'key', password: `se'cret` }
  assertEquals(fileSecrets({ ...base, auth: 's3' }), [
    `create or replace secret colwerk_files (type s3, key_id 'key', secret 'se''cret', region 'us-east-1')`,
  ])
  assertEquals(fileSecrets({ ...base, auth: 's3', region: 'eu-west-1', host: 'https://minio.example.com:9000/' }), [
    `create or replace secret colwerk_files (type s3, key_id 'key', secret 'se''cret', region 'eu-west-1', endpoint 'minio.example.com:9000', url_style 'path')`,
  ])
  assertEquals(fileSecrets({ ...base, auth: 's3', host: 'http://localhost:9000' }), [
    `create or replace secret colwerk_files (type s3, key_id 'key', secret 'se''cret', region 'us-east-1', endpoint 'localhost:9000', url_style 'path', use_ssl false)`,
  ])
  assertEquals(fileSecrets({ ...base, auth: 'gcs' }), [
    `create or replace secret colwerk_files (type gcs, key_id 'key', secret 'se''cret')`,
  ])
  assertEquals(fileSecrets({ ...base, auth: 'token' }), [
    `create or replace secret colwerk_files (type http, bearer_token 'se''cret')`,
  ])
  assertEquals(fileSecrets({ ...base, auth: 'none' }), [])
})

test('addFileSources: new views show up in open sessions; unreadable sources are reported', async () => {
  const config: ConnectionConfig = { id: 'files-add', name: 'files', dialect: 'files', sources: [orders] }
  const s = await (await loadDriver('files')).connect(config)
  try {
    const fresh = join(dir, 'new.csv')
    await writeFile(fresh, 'a,b\n1,2\n3,4\n')
    const notes = join(dir, 'notes.txt')
    await writeFile(notes, 'text')
    const missing = join(dir, 'missing.csv')
    const result = await addFileSources(config, [fresh, notes, missing, orders])
    assertEquals(result.added, [
      { source: fresh, name: 'new' },
      { source: orders, name: 'orders' },
    ])
    assertEquals(
      result.failed.map((f) => f.source),
      [notes, missing],
    )
    const [unsupported, unreadable] = result.failed.map((f) => f.error)
    assert(unsupported instanceof AppError && unsupported.key === 'unsupportedFile')
    assert(unreadable instanceof DbError && !(unreadable instanceof AppError))
    assertEquals(await rows(s, 'select count(*) from "new"'), [['2']])
  } finally {
    await s.close()
  }
})

test('driverStatus: the files driver is installed once DuckDB is', async () => {
  assertEquals((await driverStatus()).find((d) => d.dialect === 'files')?.installed, true)
})

test.skipIf(!extensions)('files: Excel workbooks', async () => {
  const xlsx = join(dir, 'book.xlsx')
  await duckdb(`copy (select 1 as a, 'b' as b) to '${xlsx}' (format xlsx, header true)`, ['excel'])
  const s = await (
    await loadDriver('files')
  ).connect({ id: 'files-xlsx', name: 'files', dialect: 'files', sources: [xlsx] })
  try {
    assertEquals(await rows(s, 'select a, b from book'), [[1, 'b']])
  } finally {
    await s.close()
  }
})

test.skipIf(!extensions)('files: https sources with a bearer token', async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      req.headers.get('authorization') === 'Bearer secret'
        ? new Response('a,b\n1,2\n', { headers: { 'content-type': 'text/csv' } })
        : new Response('denied', { status: 401 }),
  })
  const url = `http://127.0.0.1:${server.port}/data.csv`
  try {
    const config: ConnectionConfig = {
      id: 'files-http',
      name: 'files',
      dialect: 'files',
      auth: 'token',
      password: 'secret',
      sources: [url],
    }
    const s = await (await loadDriver('files')).connect(config)
    try {
      assertEquals(await rows(s, 'select a, b from data'), [['1', '2']])
    } finally {
      await s.close()
    }
    const denied = await addFileSources({ ...config, id: 'files-http-denied', password: 'wrong', sources: [] }, [url])
    assertEquals(denied.added, [])
    assertEquals(denied.failed.length, 1)
  } finally {
    await server.stop(true)
  }
})
