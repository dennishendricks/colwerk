// SQL of data imports: type translation between dialects, CREATE TABLE and the load strategies.
import { test } from 'bun:test'
import {
  beginSql,
  canonicalType,
  createTableSql,
  existingKeysSql,
  strategies,
  targetType,
  truncateSql,
  upsertSql,
} from '../core/import-sql.ts'
import type { SplitDialect } from '../core/sql-split.ts'
import { assertEquals, assertRejects, assertStringIncludes } from './assert.ts'

const dialects: SplitDialect[] = ['postgres', 'mysql', 'mssql', 'duckdb', 'sqlite', 'clickhouse']

test('types are translated to every target dialect', () => {
  const rendered = (type: string, source: SplitDialect) => dialects.map((d) => targetType(type, source, d))
  assertEquals(rendered('int8', 'postgres'), ['bigint', 'bigint', 'bigint', 'bigint', 'integer', 'Int64'])
  assertEquals(rendered('numeric(12,2)', 'postgres'), [
    'numeric(12,2)',
    'decimal(12,2)',
    'decimal(12,2)',
    'decimal(12,2)',
    'numeric',
    'Decimal(12,2)',
  ])
  assertEquals(rendered('timestamptz', 'postgres'), [
    'timestamptz',
    'timestamp(6)',
    'datetimeoffset',
    'timestamptz',
    'text',
    "DateTime64(6, 'UTC')",
  ])
  assertEquals(rendered('character varying(40)', 'postgres'), [
    'varchar(40)',
    'varchar(40)',
    'nvarchar(40)',
    'varchar',
    'text',
    'String',
  ])
  assertEquals(rendered('bytea', 'postgres'), ['bytea', 'longblob', 'varbinary(max)', 'blob', 'blob', 'String'])
  assertEquals(rendered('jsonb', 'postgres'), ['jsonb', 'json', 'nvarchar(max)', 'json', 'text', 'String'])
  assertEquals(rendered('Int8', 'clickhouse'), ['smallint', 'smallint', 'smallint', 'smallint', 'integer', 'Int16'])
  assertEquals(rendered('Nullable(Decimal(18, 2))', 'clickhouse'), [
    'numeric(18,2)',
    'decimal(18,2)',
    'decimal(18,2)',
    'decimal(18,2)',
    'numeric',
    'Decimal(18,2)',
  ])
  assertEquals(canonicalType("DateTime64(3, 'UTC')", 'clickhouse'), { kind: 'timestamptz' })
  assertEquals(canonicalType('timestamp', 'mysql'), { kind: 'timestamptz' })
  assertEquals(canonicalType('timestamp', 'postgres'), { kind: 'timestamp' })
  assertEquals(canonicalType('float', 'mysql'), { kind: 'real' })
  assertEquals(canonicalType('float', 'mssql'), { kind: 'double' })
  assertEquals(canonicalType('tinyint(1)', 'mysql'), { kind: 'boolean' })
  assertEquals(canonicalType('datetimeoffset', 'mssql'), { kind: 'timestamptz' })
  assertEquals(canonicalType('nvarchar(max)', 'mssql'), { kind: 'text' })
  assertEquals(canonicalType('HUGEINT', 'duckdb'), { kind: 'decimal', precision: 38, scale: 0 })
  assertEquals(canonicalType('STRUCT(a INTEGER)', 'duckdb'), { kind: 'json' })
})

test('key columns of text become indexable', () => {
  assertEquals(targetType('text', 'postgres', 'mysql', true), 'varchar(255)')
  assertEquals(targetType('text', 'postgres', 'mssql', true), 'nvarchar(450)')
})

test('CREATE TABLE per dialect', () => {
  const columns = [
    { name: 'id', type: 'bigint', key: true },
    { name: 'name', type: 'text', key: false },
  ]
  assertEquals(
    createTableSql('postgres', 'public', 't', columns),
    'create table "public"."t" (\n  "id" bigint not null,\n  "name" text,\n  primary key ("id")\n)',
  )
  assertEquals(
    createTableSql('mysql', 'db', 't', [{ name: 'k', type: targetType('text', 'postgres', 'mysql', true), key: true }]),
    'create table `db`.`t` (\n  `k` varchar(255) not null,\n  primary key (`k`)\n)',
  )
  assertEquals(
    createTableSql('clickhouse', 'dbm', 't', [
      { name: 'id', type: 'Int64', key: true },
      { name: 'v', type: 'String', key: false },
      { name: 'w', type: 'Nullable(Int32)', key: false },
    ]),
    'create table "dbm"."t" (\n  "id" Int64 not null,\n  "v" Nullable(String),\n  "w" Nullable(Int32)\n)\nengine = MergeTree\norder by ("id")',
  )
  assertStringIncludes(
    createTableSql('clickhouse', 'dbm', 't', [{ name: 'v', type: 'String', key: false }]),
    'order by tuple()',
  )
  assertStringIncludes(createTableSql('mssql', 'dbo', 't', columns), '[dbo].[t]')
  assertStringIncludes(createTableSql('sqlite', 'main', 't', columns), 'primary key ("id")')
  assertStringIncludes(createTableSql('duckdb', 'main', 't', columns), 'primary key ("id")')
})

test('upsert per dialect', async () => {
  const columns = [
    { name: 'id', type: 'integer' },
    { name: 'v', type: 'text' },
  ]
  const table = ['public', 't']
  const rows = [[1, 'a']]
  assertEquals(
    upsertSql('postgres', table, columns, ['id'], rows),
    `insert into "public"."t" ("id", "v") values\n  (1, 'a')\non conflict ("id") do update set "v" = excluded."v"`,
  )
  assertStringIncludes(upsertSql('duckdb', table, [columns[0]!], ['id'], [[1]]), 'on conflict ("id") do nothing')
  assertEquals(
    upsertSql('mysql', table, columns, ['id'], rows),
    "insert into `public`.`t` (`id`, `v`) values\n  (1, 'a')\non duplicate key update `v` = values(`v`)",
  )
  assertStringIncludes(upsertSql('mysql', table, [columns[0]!], ['id'], [[1]]), 'on duplicate key update `id` = `id`')
  assertEquals(
    upsertSql('mssql', table, columns, ['id'], rows),
    [
      'merge into [public].[t] with (holdlock) as target',
      "using (values (1, N'a')) as source ([id], [v])",
      'on target.[id] = source.[id]',
      'when matched then update set [v] = source.[v]',
      'when not matched then insert ([id], [v]) values (source.[id], source.[v]);',
    ].join('\n'),
  )
  assertEquals(upsertSql('mssql', table, [columns[0]!], ['id'], [[1]]).includes('when matched'), false)
  await assertRejects(
    async () => upsertSql('clickhouse', table, columns, ['id'], rows),
    Error,
    'does not support upserts',
  )
})

test('existing keys, truncate, transactions and strategies', () => {
  const keys = [
    { name: 'a', type: 'integer' },
    { name: 'b', type: 'text' },
  ]
  assertEquals(
    existingKeysSql('postgres', ['t'], keys, [
      [1, 'x'],
      [null, 'y'],
      [2, 'z'],
    ]),
    `select count(*) from "t" where ("a" = 1 and "b" = 'x') or ("a" = 2 and "b" = 'z')`,
  )
  assertEquals(existingKeysSql('postgres', ['t'], keys, [[null, 'y']]), undefined)
  assertEquals(truncateSql('sqlite', ['t']), 'delete from "t"')
  assertEquals(truncateSql('mysql', ['d', 't']), 'truncate table `d`.`t`')
  assertEquals(dialects.map(beginSql), [
    'begin',
    'start transaction',
    'begin transaction',
    'begin transaction',
    'begin',
    undefined,
  ])
  assertEquals(strategies('postgres', false), ['append', 'truncate', 'upsert'])
  assertEquals(strategies('clickhouse', false), ['append', 'truncate'])
  assertEquals(strategies('postgres', true), ['append'])
})
