import { test } from 'bun:test'
import { assert, assertEquals } from './assert.ts'
import { buildErModel, type ErLayout, layoutEr, toDbml, toMermaid } from '../app/utils/er-model.ts'
import type { ColumnInfo, ForeignKeyInfo } from '../core/types.ts'

const col = (name: string, type: string, o: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  type,
  nullable: false,
  primaryKey: false,
  indexes: [],
  comment: null,
  ...o,
})
const fk = (
  name: string,
  [schema, table, columns]: [string, string, string[]],
  [refSchema, refTable, refColumns]: [string, string, string[]],
): ForeignKeyInfo => ({ name, schema, table, columns, refSchema, refTable, refColumns })

// A composite key, a nullable key, numeric(12,2), a column name with a space and a table outside of the diagram.
const tables = [
  {
    schema: 'sales',
    name: 'orders',
    columns: [
      col('id', 'bigint', { primaryKey: true }),
      col('customer_id', 'bigint', { nullable: true }),
      col('total', 'numeric(12,2)'),
      col('Order Note', 'text', { nullable: true }),
    ],
  },
  {
    schema: 'sales',
    name: 'order_items',
    columns: [
      col('order_id', 'bigint', { primaryKey: true }),
      col('line', 'int', { primaryKey: true }),
      col('qty', 'int'),
    ],
  },
  { schema: 'sales', name: 'shipments', columns: [col('order_id', 'bigint'), col('line', 'int')] },
]
const keys = [
  fk('orders_customer_fk', ['sales', 'orders', ['customer_id']], ['public', 'customers', ['id']]),
  fk('items_order_fk', ['sales', 'order_items', ['order_id']], ['sales', 'orders', ['id']]),
  fk('', ['sales', 'shipments', ['order_id', 'line']], ['sales', 'order_items', ['order_id', 'line']]),
]
const model = buildErModel(tables, keys)

test('er: Mermaid', () => {
  assertEquals(
    toMermaid(model),
    `erDiagram
  "sales.order_items" {
    bigint order_id PK, FK
    int line PK
    int qty
  }
  "sales.orders" {
    bigint id PK
    bigint customer_id FK
    numeric(12_2) total "numeric(12,2)"
    text Order_Note "Order Note: text"
  }
  "sales.shipments" {
    bigint order_id FK
    int line FK
  }
  "sales.orders" ||--o{ "sales.order_items" : "items_order_fk"
  "public.customers" |o--o{ "sales.orders" : "orders_customer_fk"
  "sales.order_items" ||--o{ "sales.shipments" : "order_id, line"
`,
  )
})

test('er: DBML', () => {
  assertEquals(
    toDbml(model),
    `Table "public"."customers" {
  "id" bigint [not null]
}

Table "sales"."order_items" {
  "order_id" bigint [not null]
  "line" int [not null]
  "qty" int [not null]
  indexes {
    ("order_id", "line") [pk]
  }
}

Table "sales"."orders" {
  "id" bigint [pk]
  "customer_id" bigint
  "total" numeric(12,2) [not null]
  "Order Note" text
}

Table "sales"."shipments" {
  "order_id" bigint [not null]
  "line" int [not null]
}

Ref items_order_fk: "sales"."order_items"."order_id" > "sales"."orders"."id"
Ref orders_customer_fk: "sales"."orders"."customer_id" > "public"."customers"."id"
Ref: "sales"."shipments".("order_id", "line") > "sales"."order_items".("order_id", "line")
`,
  )
})

function overlaps(layout: ErLayout) {
  const [...n] = layout.nodes
  return n.some((a, i) =>
    n
      .slice(i + 1)
      .some((b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height),
  )
}

test('er: layout without overlaps, referencing tables left of referenced ones', () => {
  for (const keysOnly of [false, true]) {
    const layout = layoutEr(model, { keysOnly })
    assertEquals(layout.nodes.length, 4)
    assert(!overlaps(layout))
    for (const e of layout.edges) {
      const [from, to] = [e.from, e.to].map((k) => layout.nodes.find((n) => n.key === k)!)
      assert(from!.x < to!.x, `${e.from} -> ${e.to}`)
    }
  }
  assertEquals(
    layoutEr(model, { keysOnly: true })
      .nodes.find((n) => n.key === 'sales.orders')!
      .columns.map((c) => c.name),
    ['id', 'customer_id'],
  )
})

test('er: layout is deterministic and survives cycles, self references and loose tables', () => {
  const t = (name: string) => ({
    schema: 's',
    name,
    columns: [col('id', 'int', { primaryKey: true }), col('other', 'int')],
  })
  const odd = buildErModel(['a', 'b', 'c', 'self', 'x', 'y', 'z'].map(t), [
    fk('ab', ['s', 'a', ['other']], ['s', 'b', ['id']]),
    fk('ba', ['s', 'b', ['other']], ['s', 'a', ['id']]),
    fk('bc', ['s', 'b', ['other']], ['s', 'c', ['id']]),
    fk('ss', ['s', 'self', ['other']], ['s', 'self', ['id']]),
  ])
  const first = layoutEr(odd, { keysOnly: false })
  assertEquals(layoutEr(odd, { keysOnly: false }), first)
  assert(!overlaps(first))
  assertEquals(first.edges.length, 4)
  const focused = layoutEr(odd, { keysOnly: false, focus: 's.b' })
  assert(!overlaps(focused))
  const x = (key: string) => focused.nodes.find((n) => n.key === key)!.x
  // `a` and `c` are referenced by `b` (`a` references it too): both right of it.
  assert(x('s.b') < x('s.a') && x('s.a') === x('s.c') && x('s.self') < x('s.b'))
})
