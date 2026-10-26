import { assertEquals } from 'jsr:@std/assert@1'
import { referencedTables } from '../app/utils/sql-tables.ts'

Deno.test('referenced tables: plain, qualified, quoted, without duplicates', () => {
  const sql = `select * from orders o join sales."Order Items" i on true
    left join [dbo].[x]]y] on 1 = 1; update orders set a = 1; insert into "a.b" values (1)`
  assertEquals(referencedTables(sql, 'mssql'), [
    { name: 'orders' },
    { schema: 'sales', name: 'Order Items' },
    { schema: 'dbo', name: 'x]y' },
    { name: 'a.b' },
  ])
})

Deno.test('referenced tables: ignores strings, comments and subqueries', () => {
  assertEquals(referencedTables(`select 'from t' -- join u\nfrom (select 1) s`, 'postgres'), [])
  assertEquals(referencedTables('select * from `my db`.`t`', 'mysql'), [{ schema: 'my db', name: 't' }])
})
