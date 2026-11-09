// Lakehouse drivers (DuckDB with extensions, downloaded on first use). Delta reads tables written here; Iceberg
// runs against the REST catalog of docker-compose.yml and is skipped when it is not reachable. Unity Catalog and
// OneLake need cloud accounts and are not tested here.
import { afterAll, beforeAll, test } from 'bun:test'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from '../core/drivers/duckdb-native.ts'
import { installExtensions, missingExtensions } from '../core/drivers/lakehouse.ts'
import { driverStatus, loadDriver } from '../core/registry.ts'
import type { ConnectionConfig, Session } from '../core/types.ts'
import { assert, assertEquals, assertMatch, assertRejects } from './assert.ts'
import { reachable, tempDir } from './helpers.ts'

let dir: string

/** A Delta table of one Parquet file, written as Spark would: the data file and the first commit of the log. */
async function deltaTable(root: string, name: string, select: string, fields: [string, string][]) {
  const table = join(root, name)
  await mkdir(join(table, '_delta_log'), { recursive: true })
  const conn = await connect(':memory:delta-fixture', false, false)
  try {
    ;(await conn.query(`copy (${select}) to '${join(table, 'part-0.parquet')}' (format parquet)`)).close()
  } finally {
    conn.close()
  }
  const schema = {
    type: 'struct',
    fields: fields.map(([n, type]) => ({ name: n, type, nullable: true, metadata: {} })),
  }
  const log = [
    { protocol: { minReaderVersion: 1, minWriterVersion: 2 } },
    {
      metaData: {
        id: crypto.randomUUID(),
        format: { provider: 'parquet', options: {} },
        schemaString: JSON.stringify(schema),
        partitionColumns: [],
        configuration: {},
        createdTime: Date.now(),
      },
    },
    {
      add: {
        path: 'part-0.parquet',
        partitionValues: {},
        size: (await stat(join(table, 'part-0.parquet'))).size,
        modificationTime: Date.now(),
        dataChange: true,
      },
    },
  ]
  await writeFile(join(table, '_delta_log', '00000000000000000000.json'), log.map((l) => JSON.stringify(l)).join('\n'))
}

beforeAll(async () => {
  dir = await tempDir()
  await deltaTable(
    dir,
    'orders',
    'select i::bigint as id, (i * 1.37)::decimal(12,2) as total from range(1, 1001) t(i)',
    [
      ['id', 'long'],
      ['total', 'decimal(12,2)'],
    ],
  )
  await mkdir(join(dir, 'not_a_table'))
})

afterAll(() => rm(dir, { recursive: true }))

test('lakehouse: extensions are installed on request and reported', async () => {
  await installExtensions('delta')
  assertEquals(await missingExtensions('delta'), [])
  assertEquals((await driverStatus()).find((d) => d.dialect === 'delta')?.installed, true)
})

test('delta: the tables of a folder are listed and queried as tables', async () => {
  const config: ConnectionConfig = { id: 'lake-delta', name: 'delta', dialect: 'delta', file: dir }
  const s = await (await loadDriver('delta')).connect(config)
  try {
    assertEquals(await s.introspect({ kind: 'schemas' }), [{ name: 'main' }])
    const tables = await s.introspect({ kind: 'tables', schema: 'main' })
    assertEquals(
      tables.map((t) => [t.name, t.kind]),
      [['orders', 'table']],
    )
    assertEquals((await s.execute('select count(*), sum(total) from orders', { rowLimit: 1 })).resultSets[0]!.rows, [
      ['1000', '685685.00'],
    ])
    assertMatch(await s.introspect({ kind: 'ddl', schema: 'main', name: 'orders', object: 'table' }), /delta_scan/)
    const columns = await s.introspect({ kind: 'columns', schema: 'main', table: 'orders' })
    assertEquals(
      columns.map((c) => [c.name, c.type]),
      [
        ['id', 'BIGINT'],
        ['total', 'DECIMAL(12,2)'],
      ],
    )

    // A table added later shows up when the tables are listed again.
    await deltaTable(dir, 'customers', `select 1::bigint as id, 'a' as email`, [
      ['id', 'long'],
      ['email', 'string'],
    ])
    assertEquals(
      (await s.introspect({ kind: 'tables', schema: 'main' })).map((t) => t.name),
      ['customers', 'orders'],
    )
  } finally {
    await s.close()
  }

  // The folder of a single table.
  const single = await (
    await loadDriver('delta')
  ).connect({ ...config, id: 'lake-delta-one', file: join(dir, 'orders') })
  try {
    assertEquals(
      (await single.introspect({ kind: 'tables', schema: 'main' })).map((t) => t.name),
      ['orders'],
    )
  } finally {
    await single.close()
  }

  await assertRejects(() =>
    loadDriver('delta').then((d) => d.connect({ ...config, id: 'lake-delta-missing', file: join(dir, 'missing') })),
  )
})

const iceberg: ConnectionConfig = {
  id: 'lake-iceberg',
  name: 'iceberg',
  dialect: 'iceberg',
  host: 'http://127.0.0.1:58181',
  database: 'warehouse',
  auth: 'none',
}

test.skipIf(!(await reachable({ ...iceberg, host: '127.0.0.1', port: 58181 })))(
  'iceberg: REST catalog with namespaces as schemas',
  async () => {
    const namespace = `colwerk_${crypto.randomUUID().slice(0, 8)}`
    let s: Session | undefined = await (await loadDriver('iceberg')).connect(iceberg)
    try {
      await s.execute(
        `create schema iceberg.${namespace};
         create table iceberg.${namespace}.orders (id bigint, total decimal(12,2));
         insert into iceberg.${namespace}.orders select i, i * 1.37 from range(1, 1001) t(i)`,
        { rowLimit: 1 },
      )
      await s.close()
      // A new session starts in one of the catalog's namespaces.
      s = await (await loadDriver('iceberg')).connect(iceberg)
      assertEquals((await s.execute('select current_database()', { rowLimit: 1 })).resultSets[0]!.rows, [['iceberg']])
      assert((await s.introspect({ kind: 'schemas' })).some((x) => x.name === namespace))
      assertEquals(
        (await s.introspect({ kind: 'tables', schema: namespace })).map((t) => [t.name, t.kind]),
        [['orders', 'table']],
      )
      assertEquals(
        (await s.introspect({ kind: 'columns', schema: namespace, table: 'orders' })).map((c) => c.type),
        ['BIGINT', 'DECIMAL(12,2)'],
      )
      const sum = await s.execute(`select count(*), sum(total) from ${namespace}.orders`, { rowLimit: 1 })
      assertEquals(sum.resultSets[0]!.rows, [['1000', '685685.00']])
    } finally {
      await s
        ?.execute(`drop table if exists iceberg.${namespace}.orders; drop schema if exists iceberg.${namespace}`, {
          rowLimit: 1,
        })
        .catch(() => {})
      await s?.close()
    }
  },
)
