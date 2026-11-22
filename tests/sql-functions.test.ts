import { test } from 'bun:test'
import { assert, assertEquals } from './assert.ts'
import { SQL_FUNCTIONS } from '../app/utils/sql-functions.ts'
import type { SplitDialect } from '../app/utils/sql-split.ts'

const has = (dialect: SplitDialect, name: string) => SQL_FUNCTIONS[dialect].some(([n]) => n === name)

test('functions: no duplicates per dialect, 60 or more each', () => {
  for (const [dialect, list] of Object.entries(SQL_FUNCTIONS)) {
    const names = list.map(([name]) => name)
    assertEquals(
      names.filter((n, i) => names.indexOf(n) !== i),
      [],
      dialect,
    )
    assert(names.length >= 60, `${dialect}: ${names.length}`)
  }
})

test('functions: only those of the dialect', () => {
  assertEquals(
    [has('postgres', 'date_trunc'), has('duckdb', 'date_trunc'), has('mssql', 'date_trunc')],
    [true, true, false],
  )
  assertEquals(
    (Object.keys(SQL_FUNCTIONS) as SplitDialect[]).filter((d) => has(d, 'getdate')),
    ['mssql'],
  )
  assertEquals(
    (Object.keys(SQL_FUNCTIONS) as SplitDialect[]).filter((d) => has(d, 'toStartOfDay')),
    ['clickhouse'],
  )
})
