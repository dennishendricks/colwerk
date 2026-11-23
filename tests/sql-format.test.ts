import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { formatSql } from '../app/utils/sql-format.ts'
import { defaultSqlFormatOptions } from '../core/settings.ts'

test('formats with leading commas, indented joins and on on its own line', () => {
  const sql = `select a.id, b.name as n, count(*) -- cnt
from sales.orders a inner join sales.customers b on a.customer_id = b.id and b.x <> 1 left join foo f on f.id=a.id
where a.x <> 2 and b.y in (1,2,3) group by a.id, b.name`
  assertEquals(
    formatSql(sql, 'postgres'),
    `select
    a.id
    ,b.name as n
    ,count(*) -- cnt
from
    sales.orders a
    inner join sales.customers b
        on a.customer_id = b.id
        and b.x != 1
    left join foo f
        on f.id = a.id
where
    a.x != 2
    and b.y in (1, 2, 3)
group by
    a.id
    ,b.name`,
  )
})

test('joined subqueries, nested joins and multi-line conditions', () => {
  const sql = `select * from t join (select u.id from u join v on v.id = u.id) s on s.id = t.id and (s.a = 1 or s.b = 2) cross join w`
  assertEquals(
    formatSql(sql, 'postgres'),
    `select
    *
from
    t
    join (
        select
            u.id
        from
            u
            join v
                on v.id = u.id
    ) s
        on s.id = t.id
        and (
            s.a = 1
            or s.b = 2
        )
    cross join w`,
  )
})

test('leaves strings and comments alone and drops a trailing select comma', () => {
  assertEquals(
    formatSql(`select 'a <> b, c' as x, y, -- p, q\nz, from t`, 'postgres'),
    `select
    'a <> b, c' as x
    ,y -- p, q
    ,z
from
    t`,
  )
  assertEquals(
    formatSql('select [a<>b], "c<>d" from t', 'mssql'),
    `select
    [a<>b]
    ,"c<>d"
from
    t`,
  )
})

test('ctes start on the with line, separated by blank lines', () => {
  const sql = `with recursive a as (select id from t where x = 1), b as (with c as (select 1 as id) select id from c) select a.id from a join b on a.id = b.id`
  assertEquals(
    formatSql(sql, 'postgres'),
    `with recursive a as (
    select
        id
    from
        t
    where
        x = 1
)

,b as (
    with c as (
        select
            1 as id
    )

    select
        id
    from
        c
)

select
    a.id
from
    a
    join b
        on a.id = b.id`,
  )
})

test('blank lines around set operators', () => {
  const sql = `select a from t union all select b from u where b in (select c from v except select d from w)`
  assertEquals(
    formatSql(sql, 'postgres'),
    `select
    a
from
    t

union all

select
    b
from
    u
where
    b in (
        select
            c
        from
            v

        except

        select
            d
        from
            w
    )`,
  )
})

test('options: trailing commas, operators at the line end, <> kept', () => {
  const sql = `select a, b, from t join u on u.id = t.id and u.x <> 1 where t.a = 1 and t.b = 2`
  assertEquals(
    formatSql(sql, 'postgres', {
      ...defaultSqlFormatOptions,
      commas: 'trailing',
      logicalOperatorNewline: 'after',
      bangNotEqual: false,
    }),
    `select
    a,
    b
from
    t
    join u
        on u.id = t.id and
        u.x <> 1
where
    t.a = 1 and
    t.b = 2`,
  )
})

test('options: tabs, two spaces, letter case and expression width', () => {
  const sql = `with c as (select 1) select a, count(*), cast(b as varchar) from c join d on d.id = c.id and d.x in (1, 2, 3)`
  assertEquals(
    formatSql(sql, 'postgres', {
      ...defaultSqlFormatOptions,
      indent: 'tab',
      keywordCase: 'upper',
      functionCase: 'lower',
      dataTypeCase: 'upper',
      identifierCase: 'upper',
    }),
    `WITH C AS (
\tSELECT
\t\t1
)

SELECT
\tA
\t,count(*)
\t,cast(B AS VARCHAR)
FROM
\tC
\tJOIN D
\t\tON D.ID = C.ID
\t\tAND D.X IN (1, 2, 3)`,
  )
  assertEquals(
    formatSql('select a from t join u on u.id = t.id where t.x in (1, 2, 3)', 'postgres', {
      ...defaultSqlFormatOptions,
      indent: 'spaces2',
      expressionWidth: 20,
    }),
    `select
  a
from
  t
  join u
    on u.id = t.id
where
  t.x in (1, 2, 3)`,
  )
})
