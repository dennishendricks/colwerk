import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { insertSql, maxInsertRows, qualifiedName, quoteIdent, sqlLiteral, stringLiteral } from '../core/sql-literals.ts'
import type { SplitDialect } from '../core/sql-split.ts'

const dialects: SplitDialect[] = ['postgres', 'mysql', 'mssql', 'duckdb', 'sqlite', 'clickhouse']
const pick = <T>(d: SplitDialect, byDialect: Partial<Record<SplitDialect, T>>, fallback: T) => byDialect[d] ?? fallback

for (const d of dialects) {
  test(`sql literals: ${d} identifiers and strings`, () => {
    assertEquals(
      quoteIdent(d, 'a"b`c]d'),
      pick(d, { mysql: '`a"b``c]d`', mssql: '[a"b`c]]d]', clickhouse: '"a\\"b`c]d"' }, '"a""b`c]d"'),
    )
    assertEquals(qualifiedName(d, ['s', 't']), `${quoteIdent(d, 's')}.${quoteIdent(d, 't')}`)
    assertEquals(
      stringLiteral(d, `it's a \\`),
      pick(d, { mysql: `'it\\'s a \\\\'`, clickhouse: `'it\\'s a \\\\'`, mssql: `N'it''s a \\'` }, `'it''s a \\'`),
    )
  })

  test(`sql literals: ${d} values`, () => {
    assertEquals(sqlLiteral(d, null), 'NULL')
    assertEquals(sqlLiteral(d, true), d === 'mssql' ? '1' : 'TRUE')
    assertEquals(sqlLiteral(d, false), d === 'mssql' ? '0' : 'FALSE')
    assertEquals(sqlLiteral(d, 1.5), '1.5')
    assertEquals(sqlLiteral(d, '12.50', 'numeric(12,2)'), '12.50')
    assertEquals(sqlLiteral(d, '12.50', 'Nullable(Int64)'), '12.50')
    assertEquals(sqlLiteral(d, '12.50', 'text'), stringLiteral(d, '12.50'))
    assertEquals(sqlLiteral(d, '12.50'), stringLiteral(d, '12.50'))
    assertEquals(sqlLiteral(d, { k: [1] }), stringLiteral(d, '{"k":[1]}'))
    const hex = pick(
      d,
      { postgres: `'\\xdeadbeef'::bytea`, mysql: `X'deadbeef'`, sqlite: `X'deadbeef'`, mssql: '0xdeadbeef' },
      `unhex('deadbeef')`,
    )
    assertEquals(sqlLiteral(d, '0xdeadbeef', 'bytea'), hex)
    assertEquals(sqlLiteral(d, '0xdeadbeef', 'varbinary(16)'), hex)
    const ts = '2024-01-02T03:04:05.123456+01:00'
    assertEquals(
      sqlLiteral(d, ts, 'timestamptz'),
      pick(
        d,
        { mysql: `'2024-01-02 02:04:05.123456'`, clickhouse: `parseDateTime64BestEffort('${ts}', 6)` },
        stringLiteral(d, ts),
      ),
    )
  })

  test(`sql literals: ${d} insert`, () => {
    const q = (n: string) => quoteIdent(d, n)
    assertEquals(
      insertSql(
        d,
        ['s', 't'],
        [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'text' },
        ],
        [
          [1, 'a'],
          [2, null],
        ],
      ),
      `insert into ${q('s')}.${q('t')} (${q('id')}, ${q('name')}) values\n  (1, ${stringLiteral(d, 'a')}),\n  (2, NULL)`,
    )
  })
}

test('sql literals: only SQL Server limits the rows of an INSERT', () => {
  assertEquals(maxInsertRows('mssql'), 1000)
  assertEquals(maxInsertRows('postgres'), Infinity)
})
