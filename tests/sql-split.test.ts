import { assertEquals } from 'jsr:@std/assert@1'
import { isReadOnlyStatement, type SplitDialect, splitStatements, statementAt } from '../core/sql-split.ts'

const texts = (sql: string, d: SplitDialect) => splitStatements(sql, d).map(r => sql.slice(r.from, r.to))

Deno.test('splits on semicolons, ignoring strings and comments', () => {
  const sql = `select 'a;b' as x; -- c;d\nselect "e;f" /* g;h */ from t;\n\n  select 3`
  assertEquals(texts(sql, 'postgres'), [`select 'a;b' as x`, `-- c;d\nselect "e;f" /* g;h */ from t`, 'select 3'])
})

Deno.test('postgres dollar quoting', () => {
  const sql = `create function f() returns int as $body$ begin; return 1; end $body$ language plpgsql; select $$;$$`
  assertEquals(texts(sql, 'postgres').length, 2)
})

Deno.test('mysql backslash escapes, backticks and hash comments', () => {
  const sql = `select 'it\\'s;' from \`a;b\`; # x;y\nselect 2`
  assertEquals(texts(sql, 'mysql'), [`select 'it\\'s;' from \`a;b\``, '# x;y\nselect 2'])
})

Deno.test('mssql brackets and GO batches', () => {
  const sql = `select [a;b] from t\nGO\ncreate view v as select 1\ngo\nselect 2`
  assertEquals(texts(sql, 'mssql'), ['select [a;b] from t', 'create view v as select 1', 'select 2'])
})

Deno.test('statement under cursor', () => {
  const sql = 'select 1;\nselect 2;\n\n'
  assertEquals(statementAt(sql, 'postgres', 3), { from: 0, to: 8 })
  assertEquals(statementAt(sql, 'postgres', 13), { from: 10, to: 18 })
  // Cursor after the last semicolon / on trailing blank line → previous statement.
  assertEquals(statementAt(sql, 'postgres', sql.length), { from: 10, to: 18 })
  assertEquals(statementAt('', 'postgres', 0), undefined)
})

Deno.test('mssql: blank lines separate statements under the cursor, not inside strings or comments', () => {
  const sql = `select 1\nfrom t\n\nselect 'a\n\nb'\n/* x\n\ny */ from u\n  \nselect 3`
  const at = (cursor: number) => {
    const r = statementAt(sql, 'mssql', cursor)!
    return sql.slice(r.from, r.to)
  }
  assertEquals(at(2), 'select 1\nfrom t')
  assertEquals(at(sql.indexOf('from u')), `select 'a\n\nb'\n/* x\n\ny */ from u`)
  assertEquals(at(sql.length), 'select 3')
  // Other dialects keep blank lines inside a statement.
  assertEquals(texts(sql, 'postgres').length, 1)
})

Deno.test('mssql batches split at GO only', () => {
  const sql = `declare @x int = 1; select @x\nGO\nselect 2; select 3`
  assertEquals(splitStatements(sql, 'mssql', { semicolons: false }).map(r => sql.slice(r.from, r.to)), ['declare @x int = 1; select @x', 'select 2; select 3'])
})

Deno.test('read-only statements', () => {
  const yes = [
    'select * from t',
    '-- c\n(select 1) union (select 2)',
    `with x as (select 'delete' as "update") select * from x`,
    'select updated_at from t;',
    'show tables',
    'explain select 1',
    'from t',
  ]
  const no = [
    'select 1; select 2',
    'update t set x = 1 returning *',
    'insert into t values (1)',
    'with d as (delete from t returning *) select * from d',
    'select * into t2 from t',
    'explain analyze select 1',
    'select * from t for update',
    'exec sp_who',
    'create table t (x int)',
  ]
  for (const sql of yes) assertEquals(isReadOnlyStatement(sql, 'postgres'), true, sql)
  for (const sql of no) assertEquals(isReadOnlyStatement(sql, 'postgres'), false, sql)
  assertEquals(isReadOnlyStatement('select [delete] from t', 'mssql'), true)
})
