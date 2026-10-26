import { assertEquals } from 'jsr:@std/assert@1'
import { formatSql } from '../app/utils/sql-format.ts'

Deno.test('formats with leading commas, indented joins and on on its own line', () => {
  const sql = `select a.id, b.name as n, count(*) -- cnt
from sales.orders a inner join sales.customers b on a.customer_id = b.id and b.x <> 1 left join foo f on f.id=a.id
where a.x <> 2 and b.y in (1,2,3) group by a.id, b.name`
  assertEquals(formatSql(sql, 'postgres'), `select
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
    ,b.name`)
})

Deno.test('joined subqueries, nested joins and multi-line conditions', () => {
  const sql = `select * from t join (select u.id from u join v on v.id = u.id) s on s.id = t.id and (s.a = 1 or s.b = 2) cross join w`
  assertEquals(formatSql(sql, 'postgres'), `select
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
    cross join w`)
})

Deno.test('leaves strings and comments alone and drops a trailing select comma', () => {
  assertEquals(formatSql(`select 'a <> b, c' as x, y, -- p, q\nz, from t`, 'postgres'), `select
    'a <> b, c' as x
    ,y -- p, q
    ,z
from
    t`)
  assertEquals(formatSql('select [a<>b], "c<>d" from t', 'mssql'), `select
    [a<>b]
    ,"c<>d"
from
    t`)
})
