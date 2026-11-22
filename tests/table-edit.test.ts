import { test } from 'bun:test'
import {
  buildEditTarget,
  type Changes,
  editBlocker,
  editorKind,
  editStatements,
  type EditTarget,
  singleTableSource,
  sqlLiteral,
} from '../core/table-edit.ts'
import { AppError, type ConnectionConfig, type CellValue, type ColumnInfo, type IndexInfo } from '../core/types.ts'
import { Workbench } from '../core/workbench.ts'
import { assertEquals, assertRejects } from './assert.ts'
import { reachable, testConnections } from './helpers.ts'

test('editBlocker: read-only connections and engines without transactions', () => {
  assertEquals(editBlocker({ dialect: 'postgres' }), undefined)
  assertEquals(editBlocker({ dialect: 'postgres', readOnly: true }), 'connection')
  assertEquals(editBlocker({ dialect: 'clickhouse' }), 'dialect')
  assertEquals(editBlocker({ dialect: 'iceberg' }), 'dialect')
})

test('singleTableSource: accepted', () => {
  assertEquals(singleTableSource('select * from orders', 'postgres'), { name: 'orders' })
  const sql = 'select a, b from sales."Order Items" o where a = 1 order by b limit 5'
  assertEquals(singleTableSource(sql, 'postgres'), { schema: 'sales', name: 'Order Items' })
  assertEquals(singleTableSource('select a from sales.`Order Items` as o limit 5;', 'mysql'), {
    schema: 'sales',
    name: 'Order Items',
  })
  assertEquals(singleTableSource('select top 10 * from [dbo].[t]', 'mssql'), { schema: 'dbo', name: 't' })
  assertEquals(singleTableSource('select * from t where id in (select id from u join v on u.a = v.a)', 'postgres'), {
    name: 't',
  })
})

test('singleTableSource: rejected', () => {
  for (const sql of [
    'select * from a join b on a.id = b.id',
    'select * from a, b',
    'select a, count(*) from t group by a',
    'select distinct a from t',
    'select a from t union select a from u',
    'with c as (select 1) select * from c',
    'select * from (select 1) x',
    'select 1',
    'select * from t; select * from u',
  ]) {
    assertEquals(singleTableSource(sql, 'postgres'), undefined, sql)
  }
  assertEquals(singleTableSource('select a into t2 from t', 'mssql'), undefined)
})

const column = (name: string, type = 'integer', extra: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  type,
  nullable: false,
  primaryKey: false,
  indexes: [],
  comment: null,
  ...extra,
})
const index = (columns: string[], extra: Partial<IndexInfo> = {}): IndexInfo => ({
  name: 'i',
  columns,
  unique: true,
  primary: false,
  ...extra,
})
const result = (...names: string[]) => names.map((name) => ({ name, type: '' }))

test('buildEditTarget: primary key, unique key and missing keys', () => {
  const columns = [
    column('id', 'integer', { primaryKey: true }),
    column('code'),
    column('note', 'text', { nullable: true }),
  ]
  const built = buildEditTarget('postgres', 'public', 't', result('id', 'note'), columns, [])
  assertEquals(built, {
    target: {
      dialect: 'postgres',
      schema: 'public',
      table: 't',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'note', type: 'text', nullable: true },
      ],
      key: [0],
    },
  })
  const unique = columns.map((c) => ({ ...c, primaryKey: false }))
  const byCode = buildEditTarget('postgres', 'public', 't', result('code'), unique, [
    index(['note']),
    index(['code']),
    index(['id'], { primary: true }),
  ])
  assertEquals('target' in byCode && byCode.target.key, [0])
  assertEquals(buildEditTarget('postgres', 'public', 't', result('note'), unique, [index(['note'])]), {
    block: 'noKey',
  })
  assertEquals(buildEditTarget('postgres', 'public', 't', result('note'), columns, []), {
    block: 'keyMissing',
    columns: ['id'],
  })
})

test('buildEditTarget: column mapping', () => {
  const columns = [column('id', 'integer', { primaryKey: true }), column('Name', 'text'), column('data', 'bytea')]
  const built = buildEditTarget(
    'postgres',
    'public',
    't',
    result('ID', 'name', 'upper(name)', 'data', 'id'),
    columns,
    [],
  )
  assertEquals('target' in built && built.target.columns.map((c) => c?.name), [
    'id',
    'Name',
    undefined,
    undefined,
    undefined,
  ])
})

const target = (dialect: EditTarget['dialect']): EditTarget => ({
  dialect,
  schema: 's',
  table: 't',
  columns: [{ name: 'id', type: 'integer', nullable: false }, { name: 'v', type: 'text', nullable: true }, undefined],
  key: [0],
})
const rows: CellValue[][] = [
  [1, 'a', 'x'],
  [2, 'b', 'y'],
  [3, 'c', 'z'],
]
const changes = (): Changes => ({
  updated: new Map([[1, new Map([[1, { value: "O'Brien" }]])]]),
  inserted: [[{ default: true }, { value: 'n' }, { value: null }]],
  deleted: new Set([2]),
})

test('editStatements: delete, update, insert per engine', () => {
  const expected: Record<string, string[]> = {
    postgres: [
      `delete from "s"."t" where "id" = 3`,
      `update "s"."t" set "v" = 'O''Brien' where "id" = 2`,
      `insert into "s"."t" ("v") values ('n')`,
    ],
    mysql: [
      'delete from `s`.`t` where `id` = 3',
      "update `s`.`t` set `v` = 'O''Brien' where `id` = 2",
      "insert into `s`.`t` (`v`) values ('n')",
    ],
    mssql: [
      'delete from [s].[t] where [id] = 3',
      "update [s].[t] set [v] = N'O''Brien' where [id] = 2",
      "insert into [s].[t] ([v]) values (N'n')",
    ],
    duckdb: [
      `delete from "s"."t" where "id" = 3`,
      `update "s"."t" set "v" = 'O''Brien' where "id" = 2`,
      `insert into "s"."t" ("v") values ('n')`,
    ],
    sqlite: [
      `delete from "s"."t" where "id" = 3`,
      `update "s"."t" set "v" = 'O''Brien' where "id" = 2`,
      `insert into "s"."t" ("v") values ('n')`,
    ],
  }
  for (const [dialect, statements] of Object.entries(expected)) {
    assertEquals(editStatements(target(dialect as EditTarget['dialect']), rows, changes()), statements, dialect)
  }
})

test('editStatements: edited key, defaults, deleted rows, all-default insert', () => {
  const edited: Changes = {
    updated: new Map([
      [
        0,
        new Map([
          [0, { value: '10' }],
          [1, { default: true }],
        ]),
      ],
      [2, new Map([[1, { value: 'q' }]])],
    ]),
    inserted: [[{ default: true }, { default: true }, { value: null }]],
    deleted: new Set([2]),
  }
  assertEquals(editStatements(target('postgres'), rows, edited), [
    `delete from "s"."t" where "id" = 3`,
    `update "s"."t" set "id" = '10', "v" = default where "id" = 1`,
    `insert into "s"."t" default values`,
  ])
  assertEquals(editStatements(target('mysql'), rows, edited).at(-1), 'insert into `s`.`t` () values ()')
})

test('sqlLiteral', () => {
  assertEquals(sqlLiteral("O'Brien", 'postgres'), "'O''Brien'")
  assertEquals(sqlLiteral('a\\b', 'mysql'), "'a\\\\b'")
  assertEquals(sqlLiteral('a\\b', 'postgres'), "'a\\b'")
  assertEquals(sqlLiteral('x', 'mssql'), "N'x'")
  assertEquals(sqlLiteral(null, 'sqlite'), 'NULL')
  assertEquals(sqlLiteral(42, 'duckdb'), '42')
  assertEquals(sqlLiteral(true, 'postgres'), 'TRUE')
  assertEquals(sqlLiteral(false, 'mysql'), 'FALSE')
  assertEquals(sqlLiteral(true, 'mssql'), '1')
  assertEquals(sqlLiteral(false, 'sqlite'), '0')
  assertEquals(sqlLiteral({ a: "'" }, 'postgres'), `'{"a":"''"}'`)
  assertEquals(sqlLiteral('2024-05-01T10:20:30.123Z', 'mysql'), "'2024-05-01 10:20:30.123'")
  assertEquals(sqlLiteral('2024-05-01T10:20:30Z', 'postgres'), "'2024-05-01T10:20:30Z'")
})

test('editorKind', () => {
  const col = (type: string) => ({ name: 'c', type, nullable: true })
  assertEquals(editorKind(col('boolean'), 'postgres', ''), 'boolean')
  assertEquals(editorKind(col('bit'), 'mssql', ''), 'boolean')
  assertEquals(editorKind(col('bit'), 'postgres', ''), 'text')
  assertEquals(editorKind(col('date'), 'postgres', ''), 'date')
  assertEquals(editorKind(col('jsonb'), 'postgres', ''), 'long')
  assertEquals(editorKind(col('varchar'), 'postgres', 'a\nb'), 'long')
  assertEquals(editorKind(col('varchar'), 'postgres', 'a'.repeat(101)), 'long')
  assertEquals(editorKind(col('integer'), 'postgres', '1'), 'text')
})

// A save runs in a session of its own and is all or nothing.
const saveCases: { config: ConnectionConfig; create: string }[] = [
  {
    config: { id: 'edit-duck', name: 'duck', dialect: 'duckdb', file: ':memory:' },
    create: 'create table t (id int primary key, v varchar)',
  },
  {
    config: { id: 'edit-sqlite', name: 'lite', dialect: 'sqlite', file: ':memory:' },
    create: 'create table t (id integer primary key, v text)',
  },
]

for (const { config, create } of saveCases) {
  test(`${config.dialect}: applyEdits commits, or rolls everything back`, async () => {
    const wb = new Workbench(async () => config)
    const id = config.id
    const values = async () => (await wb.execute('tab', id, 'select v from t order by id', 10, 10)).resultSets[0]!.rows
    await wb.execute('tab', id, `${create}; insert into t values (1, 'a'), (2, 'b')`, 1, 10)
    const update = (n: number, v: string) => `update t set v = '${v}' where id = ${n}`
    const saved = await wb.applyEdits('tab', id, [update(1, 'x')], 10)
    assertEquals(saved.affectedRows, 1)
    assertEquals(await values(), [['x'], ['b']])
    const err = await assertRejects(() => wb.applyEdits('tab', id, [update(2, 'y'), update(99, 'z')], 10), AppError)
    assertEquals([err.key, err.params], ['editRowCount', { n: 2 }])
    assertEquals(await values(), [['x'], ['b']])
    await wb.closeAll()
  })
}

test('applyEdits refuses read-only connections and engines without transactions before connecting', async () => {
  const readOnly = new Workbench(async () => ({ id: 'edit-ro', name: 'duck', dialect: 'duckdb', readOnly: true }))
  const err = await assertRejects(() => readOnly.applyEdits('tab', 'edit-ro', ['delete from t'], 10), AppError)
  assertEquals(err.key, 'editReadOnly')
  // Unreachable: a connection attempt would fail with another error.
  const clickhouse = new Workbench(async () => ({ id: 'edit-ch', name: 'ch', dialect: 'clickhouse', port: 1 }))
  const other = await assertRejects(() => clickhouse.applyEdits('tab', 'edit-ch', ['delete from t'], 10), AppError)
  assertEquals(other.key, 'editUnsupported')
})

// Generated statements on a real (not temporary) table; MySQL and SQL Server count unchanged rows differently.
const containerCases: { config: ConnectionConfig; create: string }[] = [
  { config: testConnections.postgres, create: 'create table wb_edit_t (id int primary key, v varchar(20))' },
  { config: testConnections.mysql, create: 'create table wb_edit_t (id int primary key, v varchar(20))' },
]

for (const { config, create } of containerCases) {
  test.skipIf(!(await reachable(config)))(`${config.dialect}: grid edits round-trip`, async () => {
    const wb = new Workbench(async () => config)
    const id = config.id
    await wb.execute('tab', id, 'drop table if exists wb_edit_t', 1, 10)
    try {
      await wb.execute('tab', id, create, 1, 10)
      await wb.execute('tab', id, `insert into wb_edit_t values (1, 'a'), (2, 'b')`, 1, 10)
      const dialect = config.dialect as EditTarget['dialect']
      const t: EditTarget = {
        ...target(dialect),
        schema: config.dialect === 'postgres' ? 'public' : config.database!,
        table: 'wb_edit_t',
      }
      const edited: Changes = {
        updated: new Map([[0, new Map([[1, { value: "O'Brien" }]])]]),
        inserted: [[{ value: '3' }, { value: 'c' }, { value: null }]],
        deleted: new Set([1]),
      }
      const statements = editStatements(
        t,
        [
          [1, 'a'],
          [2, 'b'],
        ],
        edited,
      )
      assertEquals((await wb.applyEdits('tab', id, statements, 10)).affectedRows, 3)
      const rows = (await wb.execute('tab', id, 'select id, v from wb_edit_t order by id', 10, 10)).resultSets[0]!.rows
      assertEquals(rows, [
        [1, "O'Brien"],
        [3, 'c'],
      ])
    } finally {
      await wb.execute('tab', id, 'drop table if exists wb_edit_t', 1, 10)
      await wb.closeAll()
    }
  })
}
