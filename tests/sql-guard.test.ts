import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { unfilteredWrites, writingStatement } from '../core/sql-guard.ts'
import type { SplitDialect } from '../core/sql-split.ts'

const writes = (sql: string, d: SplitDialect) => writingStatement(sql, d) !== undefined
const kinds = (sql: string, d: SplitDialect) => unfilteredWrites(sql, d).map((r) => r.kind)

test('writingStatement: reads and session statements pass', () => {
  const cases: [string, SplitDialect][] = [
    ['select 1', 'postgres'],
    ['with a as (select 1) select * from a', 'postgres'],
    ['show tables', 'mysql'],
    ['set search_path to x', 'postgres'],
    ['set nocount on', 'mssql'],
    ['declare @x int = 1', 'mssql'],
    ['use db', 'mysql'],
    ['begin', 'postgres'],
    ['commit', 'postgres'],
    ['rollback', 'postgres'],
    ['start transaction read only', 'mysql'],
    ['pragma query_only = on', 'sqlite'],
    ['explain select * from t', 'postgres'],
  ]
  for (const [sql, d] of cases) assertEquals(writes(sql, d), false, `${d}: ${sql}`)
})

test('writingStatement: statements that may write are found', () => {
  const cases: [string, SplitDialect][] = [
    ['update t set a = 1', 'postgres'],
    ['insert into t values (1)', 'postgres'],
    ['create table t (x int)', 'postgres'],
    ['drop table x', 'postgres'],
    ['truncate t', 'postgres'],
    ['explain analyze delete from t', 'postgres'],
    ['select * into x from t', 'mssql'],
    ['with d as (delete from t returning *) select * from d', 'postgres'],
    ['begin update t set a = 1 end', 'mssql'],
    ["copy t to 'x'", 'duckdb'],
    ['call p()', 'mysql'],
    ['exec p', 'mssql'],
    ['DELIMITER //\ncreate procedure p() begin select 1; end//\nDELIMITER ;', 'mysql'],
  ]
  for (const [sql, d] of cases) assertEquals(writes(sql, d), true, `${d}: ${sql}`)
})

test('writingStatement: position of the first writing statement', () => {
  const sql = 'select 1; update t set a = 1'
  assertEquals(writingStatement(sql, 'postgres')?.from, sql.indexOf('update'))
})

test('unfilteredWrites: flags updates and deletes without WHERE and every truncate', () => {
  const cases: [string, SplitDialect, string][] = [
    ['update t set a = 1', 'postgres', 'update'],
    ['delete from t', 'mysql', 'delete'],
    ['delete from t returning *', 'postgres', 'delete'],
    ['update t set a = (select b from u where u.id = 1)', 'postgres', 'update'],
    [`update t set a = 'where'`, 'postgres', 'update'],
    ['delete from t -- where x', 'sqlite', 'delete'],
    ['with x as (select 1) delete from t', 'postgres', 'delete'],
    ['update t set a = u.b from u', 'postgres', 'update'],
  ]
  for (const [sql, d, kind] of cases) assertEquals(kinds(sql, d), [kind as 'update'], `${d}: ${sql}`)
  for (const d of ['postgres', 'mysql', 'mssql', 'duckdb', 'clickhouse'] as const) {
    assertEquals(kinds('truncate table t', d), ['truncate'], d)
    assertEquals(kinds('truncate t', d), ['truncate'], d)
  }
})

test('unfilteredWrites: filtered statements are not flagged', () => {
  const cases: [string, SplitDialect][] = [
    ['update t set a = 1 where id = 1', 'postgres'],
    ['delete from t where id = 1', 'mysql'],
    ['with x as (select 1 where true) update t set a = 1 where id = 1', 'postgres'],
    ['update a join b on a.id = b.id set a.x = 1', 'mysql'],
    ['delete a from a join b on a.id = b.id', 'mysql'],
    ['delete from t using u where t.id = u.id', 'postgres'],
    ['update t set x = 1 from t join u on t.id = u.id', 'mssql'],
    ['alter table t delete where x = 1', 'clickhouse'],
    ['create trigger tr after insert on t begin delete from u; end', 'sqlite'],
    ['create trigger tr after insert on t for each row begin delete from u; end', 'mysql'],
    ['select * from t', 'postgres'],
  ]
  for (const [sql, d] of cases) assertEquals(kinds(sql, d), [], `${d}: ${sql}`)
})

test('unfilteredWrites: a mixed script returns only the offending ranges', () => {
  const sql = 'delete from a where x = 1;\nupdate b set y = 2;\ntruncate c;\nselect 1'
  const found = unfilteredWrites(sql, 'postgres')
  assertEquals(
    found.map((r) => [r.kind, sql.slice(r.from, r.to)]),
    [
      ['update', 'update b set y = 2'],
      ['truncate', 'truncate c'],
    ],
  )
})
