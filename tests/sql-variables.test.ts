import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import type { SplitDialect } from '../core/sql-split.ts'
import { findVariables, originalOffset, substituteVariables, variableNames } from '../app/utils/sql-variables.ts'

const names = (sql: string, dialect: SplitDialect = 'postgres') => findVariables(sql, dialect).map((u) => u.name)

test('variables: code and single-quoted strings', () => {
  assertEquals(names(`select * from t where d = '\${day}' and n > \${min}`), ['day', 'min'])
})

test('variables: comments and quoted identifiers are ignored', () => {
  assertEquals(names('select 1 -- ${a}\n, /* ${b} */ "${c}"'), [])
  assertEquals(names('select `${a}`, 1 # ${b}', 'mysql'), [])
  assertEquals(names('select [${a}]', 'mssql'), [])
  assertEquals(names('select 1 # ${a}', 'postgres'), ['a'])
})

test('variables: dollar-quoted bodies are ignored, parameters and casts untouched', () => {
  for (const dialect of ['postgres', 'duckdb'] as const) {
    assertEquals(names('select $$ ${a} $$, $tag$ ${b} $tag$, ${c}', dialect), ['c'])
    assertEquals(names('select $1, $name, $$x$$::text, a::int, ${d}', dialect), ['d'])
  }
  // Not a dollar quote in MySQL, so the variable is code there.
  assertEquals(names('select $$ ${a} $$', 'mysql'), ['a'])
})

test('variables: ClickHouse parameters are not variables', () => {
  assertEquals(names('select {x:UInt8}, {y:String}, ${z}', 'clickhouse'), ['z'])
})

test('variables: names follow identifier rules', () => {
  assertEquals(names('${a1} ${_b} ${1a} ${a-b} ${} ${ a }'), ['a1', '_b'])
})

test('variables: repeated use is listed once, in order', () => {
  const uses = findVariables('${b} ${a} ${b}', 'postgres')
  assertEquals(uses.length, 3)
  assertEquals(variableNames(uses), ['b', 'a'])
})

test('substitute: plain text, no quoting', () => {
  const sql = `select \${col} from t where d = '\${d}' and \${col} > 1`
  const uses = findVariables(sql, 'postgres')
  assertEquals(
    substituteVariables(sql, uses, { col: 'price', d: '2024-01-01' }),
    `select price from t where d = '2024-01-01' and price > 1`,
  )
})

test('position mapping back to the original text', () => {
  const sql = 'select ${a}, x, ${b}, y'
  const uses = findVariables(sql, 'postgres')
  const values = { a: 'longer value', b: '' }
  const out = substituteVariables(sql, uses, values)
  assertEquals(out, 'select longer value, x, , y')
  assertEquals(originalOffset(uses, values, 0), 0)
  // Inside the first value: start of `${a}`.
  assertEquals(originalOffset(uses, values, out.indexOf('value')), 7)
  // After the values: `x`, `y` map to their original place.
  assertEquals(sql[originalOffset(uses, values, out.indexOf('x'))], 'x')
  assertEquals(sql[originalOffset(uses, values, out.indexOf('y'))], 'y')
  assertEquals(originalOffset(uses, {}, 5), 5)
})
