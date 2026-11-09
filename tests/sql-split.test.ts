import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import {
  isReadOnlyStatement,
  isSelectStatement,
  mysqlServerScript,
  type SplitDialect,
  splitStatements,
  statementAt,
} from '../core/sql-split.ts'

const texts = (sql: string, d: SplitDialect) => splitStatements(sql, d).map((r) => sql.slice(r.from, r.to))

test('splits on semicolons, ignoring strings and comments', () => {
  const sql = `select 'a;b' as x; -- c;d\nselect "e;f" /* g;h */ from t;\n\n  select 3`
  assertEquals(texts(sql, 'postgres'), [`select 'a;b' as x`, `-- c;d\nselect "e;f" /* g;h */ from t`, 'select 3'])
})

test('postgres dollar quoting', () => {
  const sql = `create function f() returns int as $body$ begin; return 1; end $body$ language plpgsql; select $$;$$`
  assertEquals(texts(sql, 'postgres').length, 2)
})

test('mysql backslash escapes, backticks and hash comments', () => {
  const sql = `select 'it\\'s;' from \`a;b\`; # x;y\nselect 2`
  assertEquals(texts(sql, 'mysql'), [`select 'it\\'s;' from \`a;b\``, '# x;y\nselect 2'])
})

test('clickhouse backslash escapes, backticks, hash comments and heredocs', () => {
  const sql = `select 'it\\'s;', "x\\";y" from \`a\\\`;b\`; # x;y\nselect $$;$$`
  assertEquals(texts(sql, 'clickhouse'), [`select 'it\\'s;', "x\\";y" from \`a\\\`;b\``, '# x;y\nselect $$;$$'])
})

test('mssql brackets and GO batches', () => {
  const sql = `select [a;b] from t\nGO\ncreate view v as select 1\ngo\nselect 2`
  assertEquals(texts(sql, 'mssql'), ['select [a;b] from t', 'create view v as select 1', 'select 2'])
})

test('sqlite brackets, backticks and trigger bodies', () => {
  const sql = `select [a;b], \`c;d\` from t;
create trigger tr after insert on t begin
  update t set x = case when new.x > 0 then 1 end;
  delete from u;
end;
select 2`
  assertEquals(texts(sql, 'sqlite'), [
    'select [a;b], `c;d` from t',
    sql.slice(sql.indexOf('create'), sql.lastIndexOf(';')),
    'select 2',
  ])
})

test('statement under cursor', () => {
  const sql = 'select 1;\nselect 2;\n\n'
  assertEquals(statementAt(sql, 'postgres', 3), { from: 0, to: 8 })
  assertEquals(statementAt(sql, 'postgres', 13), { from: 10, to: 18 })
  // Cursor after the last semicolon / on trailing blank line → previous statement.
  assertEquals(statementAt(sql, 'postgres', sql.length), { from: 10, to: 18 })
  assertEquals(statementAt('', 'postgres', 0), undefined)
})

test('mssql: blank lines separate statements under the cursor, not inside strings or comments', () => {
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

test('mssql batches split at GO only', () => {
  const sql = `declare @x int = 1; select @x\nGO\nselect 2; select 3`
  assertEquals(
    splitStatements(sql, 'mssql', { semicolons: false }).map((r) => sql.slice(r.from, r.to)),
    ['declare @x int = 1; select @x', 'select 2; select 3'],
  )
})

test('read-only statements', () => {
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
  const unpivot = 'with u as (unpivot t on (a, b) as "x" into name "k" value "v") select * from u'
  assertEquals(isReadOnlyStatement(unpivot, 'duckdb'), true)
  assertEquals(isReadOnlyStatement(unpivot, 'postgres'), false)
  for (const sql of ['pivot t on k using sum(v)', 'unpivot t on a, b into name k value v', 'summarize t']) {
    assertEquals(isReadOnlyStatement(sql, 'duckdb'), true, sql)
  }
  assertEquals(
    isReadOnlyStatement('select * from a inner merge join b on a.id = b.id option (merge union)', 'mssql'),
    true,
  )
  assertEquals(isReadOnlyStatement('merge into t using s on t.id = s.id when matched then delete', 'mssql'), false)
  assertEquals(isReadOnlyStatement('select * from a inner merge join b on a.id = b.id', 'postgres'), false)
})

test('select statement detection', () => {
  for (const sql of [
    'select 1',
    '  -- note\nselect 1;',
    '(select 1) union (select 2)',
    'with a as (select 1) select * from a',
  ]) {
    assertEquals(isSelectStatement(sql, 'postgres'), true, sql)
  }
  for (const sql of [
    'show tables',
    'explain select 1',
    'values (1)',
    'select 1; select 2',
    'with d as (delete from t returning *) select * from d',
  ]) {
    assertEquals(isSelectStatement(sql, 'postgres'), false, sql)
  }
})

test('postgres: identifiers with $, positional parameters and tags', () => {
  assertEquals(texts('select a$b$c from t; select $1, x$y$ from u', 'postgres'), [
    'select a$b$c from t',
    'select $1, x$y$ from u',
  ])
  assertEquals(texts('select $_t$;$_t$; select $ä$;$ä$', 'postgres'), ['select $_t$;$_t$', 'select $ä$;$ä$'])
})

test('postgres and duckdb: E strings with backslash escapes', () => {
  for (const d of ['postgres', 'duckdb'] as const) {
    assertEquals(texts(`select E'it\\'s;'; select 2`, d), [`select E'it\\'s;'`, 'select 2'])
  }
  // Without the E prefix a backslash is an ordinary character.
  assertEquals(texts(`select 'a\\'; select 2`, 'postgres'), [`select 'a\\'`, 'select 2'])
  assertEquals(texts(`select name'x\\'; select 2`, 'postgres'), [`select name'x\\'`, 'select 2'])
})

test('nested block comments where the dialect nests them', () => {
  const sql = 'select 1 /* a /* b */ ; */; select 2'
  for (const d of ['postgres', 'duckdb', 'mssql', 'clickhouse'] as const) {
    assertEquals(texts(sql, d), ['select 1 /* a /* b */ ; */', 'select 2'], d)
  }
  for (const d of ['mysql', 'sqlite'] as const) {
    assertEquals(texts(sql, d), ['select 1 /* a /* b */', '*/', 'select 2'], d)
  }
})

test('postgres: semicolons inside parentheses (create rule)', () => {
  const sql = 'create rule r as on insert to t do also (insert into a values (1); delete from b); select 1'
  assertEquals(texts(sql, 'postgres'), [sql.slice(0, sql.lastIndexOf(';')), 'select 1'])
})

test('postgres: begin atomic bodies', () => {
  const fn = `create or replace function f() returns int language sql
begin atomic
  select case when true then 1 end;
  select 2;
end`
  assertEquals(texts(`${fn};\nselect 3`, 'postgres'), [fn, 'select 3'])
})

test('mysql: -- starts a comment only before whitespace', () => {
  assertEquals(texts('select 1--1; select 2', 'mysql'), ['select 1--1', 'select 2'])
  assertEquals(texts('select 1 -- x;\nselect 2;--\nselect 3', 'mysql'), ['select 1 -- x;\nselect 2', '--\nselect 3'])
  assertEquals(texts('select 1--1; select 2', 'postgres'), ['select 1--1; select 2'])
})

test('mysql: DELIMITER', () => {
  const proc = `create procedure p()
begin
  select 1;
  select 2;
end`
  const sql = `-- setup
DELIMITER //
${proc} //
select ';' //
DELIMITER ;
select 3; select 4`
  assertEquals(texts(sql, 'mysql'), [proc, `select ';'`, 'select 3', 'select 4'])
  // Only at the start of a statement, and only in mysql.
  assertEquals(texts('select 1\ndelimiter //\n;', 'mysql'), ['select 1\ndelimiter //'])
  assertEquals(texts(`select 'x\ndelimiter //\n'; select 2`, 'mysql'), [`select 'x\ndelimiter //\n'`, 'select 2'])
  assertEquals(texts('delimiter $$\nselect 1$$', 'postgres'), ['delimiter $$\nselect 1$$'])
})

test('mysql: server script without DELIMITER lines keeps positions', () => {
  const sql = 'DELIMITER //\ncreate procedure p() begin select 1; end //\nselect 2 //\nDELIMITER ;\nselect 3;'
  const server = mysqlServerScript(sql)
  assertEquals(server.length, sql.length)
  assertEquals(server.split('\n').length, sql.split('\n').length)
  assertEquals(server.replace(/\s+/g, ' ').trim(), 'create procedure p() begin select 1; end ; select 2 ; select 3;')
  assertEquals(mysqlServerScript('select 1; select 2'), 'select 1; select 2')
})

test('mysql: routine bodies without DELIMITER', () => {
  const proc = `create definer=\`root\`@\`%\` procedure p(x int)
begin
  if x > 0 then
    delete from t;
  end if;
  label: loop
    leave label;
  end loop;
end`
  assertEquals(texts(`${proc};\nselect 1`, 'mysql'), [proc, 'select 1'])
  const at = statementAt(proc, 'mysql', proc.indexOf('delete'))!
  assertEquals(proc.slice(at.from, at.to), proc)
})

test('mssql: GO with count and comment, case-insensitive', () => {
  const sql = `insert into t values (1)\nGo 3\nselect 2\n  go -- done\nselect 3\ngone\nselect 4`
  assertEquals(texts(sql, 'mssql'), ['insert into t values (1)', 'select 2', 'select 3\ngone\nselect 4'])
  assertEquals(
    splitStatements(sql, 'mssql', { semicolons: false }).map((r) => sql.slice(r.from, r.to)),
    [
      'insert into t values (1)',
      'insert into t values (1)',
      'insert into t values (1)',
      'select 2',
      'select 3\ngone\nselect 4',
    ],
  )
  // GO inside strings and comments, and not on its own line, separates nothing.
  const quoted = `select 'a\nGO\nb' /*\nGO\n*/ ; select 1 go`
  assertEquals(splitStatements(quoted, 'mssql', { semicolons: false }).length, 1)
})

test('mssql: procedure bodies run to the end of the batch', () => {
  const proc = `create or alter procedure p as
begin
  delete from t;

  select 1;
end`
  const sql = `${proc}\nGO\nselect 2`
  assertEquals(texts(sql, 'mssql'), [proc, 'select 2'])
  const at = statementAt(sql, 'mssql', sql.indexOf('select 1'))!
  assertEquals(sql.slice(at.from, at.to), proc)
})

test('sqlite: temp triggers and nested case', () => {
  const trigger = `create temp trigger tr after update on t begin
  select case when 1 then case when 2 then 3 end end;
  insert into log values ('end;');
end`
  assertEquals(texts(`${trigger}; select 1`, 'sqlite'), [trigger, 'select 1'])
})
