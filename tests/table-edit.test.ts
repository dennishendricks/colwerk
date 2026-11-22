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
import type { CellValue, ColumnInfo, IndexInfo } from '../core/types.ts'
import { assertEquals } from './assert.ts'

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
