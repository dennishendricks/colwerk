import { test } from 'bun:test'
import { assertEquals } from './assert.ts'
import { joinSuggestions, resolveQualifier, type SchemaModel } from '../app/utils/sql-scope.ts'
import type { SplitDialect } from '../app/utils/sql-split.ts'

export const model: SchemaModel = {
  defaultSchema: 'public',
  tables: {
    public: {
      customers: ['id', 'email', 'name'],
      employees: ['id', 'manager_id'],
      order_items: ['order_id', 'line', 'qty'],
      shipments: ['order_id', 'line'],
    },
    sales: { orders: ['id', 'customer_id', 'total'] },
  },
  foreignKeys: [
    fk('orders_customer_fk', 'sales', 'orders', ['customer_id'], 'public', 'customers', ['id']),
    fk('items_order_fk', 'public', 'order_items', ['order_id'], 'sales', 'orders', ['id']),
    fk('shipments_item_fk', 'public', 'shipments', ['order_id', 'line'], 'public', 'order_items', ['order_id', 'line']),
    fk('employees_manager_fk', 'public', 'employees', ['manager_id'], 'public', 'employees', ['id']),
  ],
  functions: [],
}

function fk(
  name: string,
  schema: string,
  table: string,
  columns: string[],
  refSchema: string,
  refTable: string,
  refColumns: string[],
) {
  return { name, schema, table, columns, refSchema, refTable, refColumns }
}

/** `|` marks the cursor. */
function resolve(marked: string, qualifier: string, dialect: SplitDialect = 'postgres') {
  const pos = marked.indexOf('|')
  return resolveQualifier(marked.replace('|', ''), pos, qualifier, dialect, model)
}

const orders = { table: { schema: 'sales', name: 'orders' } }

test('qualifier: table alias, join alias and unaliased table', () => {
  assertEquals(resolve('select o.| from sales.orders o', 'o'), orders)
  assertEquals(resolve('select 1 from sales.orders o join customers c on c.id = o.customer_id where c.|', 'c'), {
    table: { schema: undefined, name: 'customers' },
  })
  assertEquals(resolve('select customers.| from customers', 'customers'), {
    table: { schema: undefined, name: 'customers' },
  })
})

test('qualifier: CTEs', () => {
  assertEquals(resolve('with r as (select id, amount from x) select r.| from r', 'r'), { columns: ['id', 'amount'] })
  assertEquals(resolve('with r as (select 1 as a) select q.| from r q', 'q'), { columns: ['a'] })
  assertEquals(resolve('with x(a, b) as (select 1, 2) select x.| from x', 'x'), { columns: ['a', 'b'] })
  assertEquals(resolve('with a as (select * from sales.orders) select a.| from a', 'a'), {
    columns: ['id', 'customer_id', 'total'],
  })
  assertEquals(resolve('with recursive r(n) as (select 1 union all select n + 1 from r) select r.| from r', 'r'), {
    columns: ['n'],
  })
})

test('qualifier: derived tables and table functions', () => {
  assertEquals(resolve('select s.| from (select customer_id, count(*) n from sales.orders group by 1) s', 's'), {
    columns: ['customer_id', 'n'],
  })
  assertEquals(resolve(`select t.| from read_csv('a') t`, 't', 'duckdb'), undefined)
  assertEquals(resolve('select v.| from (values (1, 2)) as v(a, b)', 'v'), { columns: ['a', 'b'] })
})

test('qualifier: subqueries see outer aliases, inner names shadow', () => {
  assertEquals(resolve('select 1 from customers c where exists (select 1 from sales.orders o where o.x = c.|)', 'c'), {
    table: { schema: undefined, name: 'customers' },
  })
  assertEquals(resolve('select 1 from sales.orders o where exists (select 1 from customers o where o.|)', 'o'), {
    table: { schema: undefined, name: 'customers' },
  })
  assertEquals(resolve('select 1 from sales.orders o where exists (select 1 from customers c) and o.|', 'o'), orders)
})

test('qualifier: quoted names, case, statements, comments', () => {
  assertEquals(resolve('select "O".| from "Order Items" "O"', 'O'), {
    table: { schema: undefined, name: 'Order Items' },
  })
  assertEquals(resolve('select t.| from [dbo].[x] t', 't', 'mssql'), { table: { schema: 'dbo', name: 'x' } })
  assertEquals(resolve('select O.| from sales.orders o', 'O'), orders)
  assertEquals(resolve('select 1 from sales.orders o; select o.|', 'o'), undefined)
  assertEquals(resolve(`select o.| from sales.orders o -- from customers c\n/* join customers x */`, 'c'), undefined)
  assertEquals(resolve(`select 'from customers c', o.| from sales.orders o`, 'c'), undefined)
  assertEquals(resolve('update sales.orders o set total = 0 where o.|', 'o'), orders)
  assertEquals(resolve('delete from sales.orders o using customers c where o.customer_id = c.|', 'c'), {
    table: { schema: undefined, name: 'customers' },
  })
})

test('qualifier: update from and merge', () => {
  assertEquals(resolve('update sales.orders o set total = 1 from customers c where c.|', 'c'), {
    table: { schema: undefined, name: 'customers' },
  })
  assertEquals(resolve('merge into sales.orders t using (select 1 as k) s on t.id = s.| when matched', 's', 'mssql'), {
    columns: ['k'],
  })
})

const join = (marked: string) => {
  const pos = marked.indexOf('|')
  return joinSuggestions(marked.replace('|', ''), pos, 'postgres', model).map((s) => s.label)
}

test('join suggestions: both directions with ON clause', () => {
  assertEquals(join('select 1 from customers c join |'), ['sales.orders o on o.customer_id = c.id'])
  assertEquals(join('select 1 from sales.orders o join |'), [
    'public.customers c on c.id = o.customer_id',
    'public.order_items oi on oi.order_id = o.id',
  ])
})

test('join suggestions: composite keys, alias collisions, self references', () => {
  assertEquals(join('select 1 from order_items i join |'), [
    'sales.orders o on o.id = i.order_id',
    'shipments s on s.order_id = i.order_id and s.line = i.line',
  ])
  assertEquals(join('select 1 from customers c join |'), ['sales.orders o on o.customer_id = c.id'])
  assertEquals(join('select 1 from customers o, sales.orders c join |'), [
    'sales.orders o2 on o2.customer_id = o.id',
    'public.customers c2 on c2.id = c.customer_id',
    'public.order_items oi on oi.order_id = c.id',
  ])
  assertEquals(join('select 1 from employees e join |'), [
    'employees e2 on e2.id = e.manager_id',
    'employees e2 on e2.manager_id = e.id',
  ])
})
