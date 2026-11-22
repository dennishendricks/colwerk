import type { ColumnInfo, ForeignKeyInfo } from '../../core/types.ts'

// Entity-relationship model of tables and foreign keys: Mermaid and DBML text, and a layered layout for the SVG.

export interface ErColumn {
  name: string
  type: string
  nullable: boolean
  pk: boolean
  fk: boolean
}

/** A stub stands for a table that is not part of the diagram; it only has the columns of its foreign keys. */
export interface ErTable {
  schema: string
  name: string
  columns: ErColumn[]
  stub: boolean
}

/** A foreign key from `table` to `refTable`; `optional` when a column of it can be null. */
export interface ErRelation {
  name: string
  schema: string
  table: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
  optional: boolean
}

export interface ErModel {
  tables: ErTable[]
  relations: ErRelation[]
}

export const tableKey = (schema: string, name: string) => `${schema}.${name}`

/** The model of `tables` and the foreign keys between them; the far end of a key outside of them becomes a stub. */
export function buildErModel(
  tables: { schema: string; name: string; columns: ColumnInfo[] }[],
  foreignKeys: ForeignKeyInfo[],
): ErModel {
  const known = new Map(tables.map((t) => [tableKey(t.schema, t.name), t]))
  const keys = foreignKeys.filter(
    (k) => known.has(tableKey(k.schema, k.table)) || known.has(tableKey(k.refSchema, k.refTable)),
  )
  const stubs = new Map<string, ErTable>()
  const stubColumn = (
    schema: string,
    table: string,
    name: string,
    other: { schema: string; table: string; column: string },
    fk: boolean,
  ) => {
    const key = tableKey(schema, table)
    if (known.has(key)) return
    const stub = stubs.get(key) ?? { schema, name: table, columns: [], stub: true }
    stubs.set(key, stub)
    // The columns of a key have the same type on both sides.
    const type = known.get(tableKey(other.schema, other.table))?.columns.find((c) => c.name === other.column)?.type
    if (!stub.columns.some((c) => c.name === name)) {
      stub.columns.push({ name, type: type ?? '', nullable: false, pk: false, fk })
    }
  }
  for (const k of keys) {
    k.columns.forEach((c, i) =>
      stubColumn(k.schema, k.table, c, { schema: k.refSchema, table: k.refTable, column: k.refColumns[i]! }, true),
    )
    k.refColumns.forEach((c, i) =>
      stubColumn(k.refSchema, k.refTable, c, { schema: k.schema, table: k.table, column: k.columns[i]! }, false),
    )
  }
  const foreign = (t: { schema: string; name: string }) =>
    new Set(keys.filter((k) => k.schema === t.schema && k.table === t.name).flatMap((k) => k.columns))
  const model: ErModel = {
    tables: [
      ...tables.map((t): ErTable => {
        const fk = foreign(t)
        return {
          schema: t.schema,
          name: t.name,
          stub: false,
          columns: t.columns.map((c) => ({
            name: c.name,
            type: c.type,
            nullable: c.nullable,
            pk: c.primaryKey,
            fk: fk.has(c.name),
          })),
        }
      }),
      ...stubs.values(),
    ],
    relations: keys.map((k) => {
      const child = known.get(tableKey(k.schema, k.table))
      return {
        name: k.name,
        schema: k.schema,
        table: k.table,
        columns: k.columns,
        refSchema: k.refSchema,
        refTable: k.refTable,
        refColumns: k.refColumns,
        optional: !!child?.columns.some((c) => k.columns.includes(c.name) && c.nullable),
      }
    }),
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  model.tables.sort((a, b) => cmp(tableKey(a.schema, a.name), tableKey(b.schema, b.name)))
  model.relations.sort(
    (a, b) =>
      cmp(tableKey(a.schema, a.table), tableKey(b.schema, b.table)) ||
      cmp(a.name, b.name) ||
      cmp(a.columns.join(), b.columns.join()),
  )
  return model
}

/** Mermaid takes only these characters in types and attribute names. */
const word = (s: string) => s.replace(/[^A-Za-z0-9_()[\]-]/g, '_')

/** Mermaid `erDiagram` of the tables of the model (stubs only as ends of relations). */
export function toMermaid(model: ErModel): string {
  const lines = ['erDiagram']
  for (const t of model.tables.filter((t) => !t.stub)) {
    lines.push(`  "${tableKey(t.schema, t.name).replaceAll('"', "'")}" {`)
    for (const c of t.columns) {
      const type = /^[A-Za-z]/.test(word(c.type)) ? word(c.type) : `t_${word(c.type)}`
      const name = /^[A-Za-z_]/.test(word(c.name)) ? word(c.name) : `c_${word(c.name)}`
      const keys = [c.pk && 'PK', c.fk && 'FK'].filter(Boolean).join(', ')
      // What the sanitizing changed is kept in the comment.
      const comment = name !== c.name ? `${c.name}: ${c.type}` : type !== c.type ? c.type : ''
      lines.push(`    ${[type, name, keys, comment && `"${comment.replaceAll('"', "'")}"`].filter(Boolean).join(' ')}`)
    }
    lines.push('  }')
  }
  for (const r of model.relations) {
    const label = (r.name || r.columns.join(', ')).replaceAll('"', "'")
    const left = tableKey(r.refSchema, r.refTable).replaceAll('"', "'")
    const right = tableKey(r.schema, r.table).replaceAll('"', "'")
    lines.push(`  "${left}" ${r.optional ? '|o' : '||'}--o{ "${right}" : "${label}"`)
  }
  return `${lines.join('\n')}\n`
}

const quote = (s: string) => `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const dbmlType = (type: string) =>
  /^[A-Za-z_]\w*(\(\s*\d+(\s*,\s*\d+)?\s*\))?(\[\])*$/.test(type) ? type : quote(type || 'unknown')

/** DBML of the tables (stubs with their key columns) and the relations of the model. */
export function toDbml(model: ErModel): string {
  const out: string[] = []
  for (const t of model.tables) {
    out.push(`Table ${quote(t.schema)}.${quote(t.name)} {`)
    const pks = t.columns.filter((c) => c.pk)
    for (const c of t.columns) {
      const settings = c.pk && pks.length === 1 ? ' [pk]' : !c.nullable ? ' [not null]' : ''
      out.push(`  ${quote(c.name)} ${dbmlType(c.type)}${settings}`)
    }
    if (pks.length > 1) out.push('  indexes {', `    (${pks.map((c) => quote(c.name)).join(', ')}) [pk]`, '  }')
    out.push('}', '')
  }
  const ref = (schema: string, table: string, columns: string[]) =>
    `${quote(schema)}.${quote(table)}.${columns.length > 1 ? `(${columns.map(quote).join(', ')})` : quote(columns[0]!)}`
  for (const r of model.relations) {
    out.push(
      `Ref${/^\w+$/.test(r.name) ? ` ${r.name}` : ''}: ${ref(r.schema, r.table, r.columns)} > ${ref(r.refSchema, r.refTable, r.refColumns)}`,
    )
  }
  return `${out.join('\n').trimEnd()}\n`
}

export interface ErNode {
  key: string
  table: ErTable
  /** The columns drawn. */
  columns: ErColumn[]
  x: number
  y: number
  width: number
  height: number
}

export interface ErEdge {
  relation: ErRelation
  /** Keys of the referencing and the referenced node. */
  from: string
  to: string
  /** SVG path from the foreign key column to the referenced column. */
  path: string
}

export interface ErLayout {
  nodes: ErNode[]
  edges: ErEdge[]
  width: number
  height: number
}

const HEADER = 26
const ROW = 20
const CHAR = 7.2
const PAD = 12
const GAP_X = 120
const GAP_Y = 32
const CURVE = 60

/** Dimensions of the drawn boxes, for rendering the layout. */
export const ER_BOX = { header: HEADER, row: ROW, char: CHAR, pad: PAD }

/**
 * Places the tables in layers: referenced tables to the right of the tables that reference them, tables without
 * relations in extra columns at the far right. With `focus`: that table in the middle, the tables it references to
 * the right and the others to the left. `keysOnly` draws only key columns.
 */
export function layoutEr(model: ErModel, { keysOnly, focus }: { keysOnly: boolean; focus?: string }): ErLayout {
  const nodes = new Map<string, ErNode>()
  for (const table of model.tables) {
    const columns = keysOnly && !table.stub ? table.columns.filter((c) => c.pk || c.fk) : table.columns
    const chars = Math.max(
      table.name.length + 2,
      ...columns.map((c) => c.name.length + (c.type ? c.type.length + 2 : 0) + 4),
    )
    const key = tableKey(table.schema, table.name)
    const width = Math.min(360, Math.max(140, Math.ceil(2 * PAD + chars * CHAR)))
    nodes.set(key, { key, table, columns, x: 0, y: 0, width, height: HEADER + ROW * columns.length })
  }
  const keys = [...nodes.keys()].sort()
  const links = model.relations
    .map((r) => ({ child: tableKey(r.schema, r.table), parent: tableKey(r.refSchema, r.refTable) }))
    .filter((l) => l.child !== l.parent && nodes.has(l.child) && nodes.has(l.parent))
  const neighbors = (key: string) =>
    links.flatMap((l) => (l.child === key ? [l.parent] : l.parent === key ? [l.child] : []))

  let layers: string[][]
  let extra: string[][] = []
  if (focus && nodes.has(focus)) {
    const right = [...new Set(links.filter((l) => l.child === focus).map((l) => l.parent))].sort()
    layers = [keys.filter((k) => k !== focus && !right.includes(k)), [focus], right]
  } else {
    const connected = keys.filter((k) => neighbors(k).length)
    const isolated = keys.filter((k) => !neighbors(k).length)
    // Rank 0: references nothing. Back edges of cycles are ignored.
    const parents = new Map(connected.map((k) => [k, new Set(links.filter((l) => l.child === k).map((l) => l.parent))]))
    const state = new Map<string, 'open' | 'done'>()
    const visit = (k: string) => {
      state.set(k, 'open')
      for (const p of [...parents.get(k)!].sort()) {
        if (state.get(p) === 'open') parents.get(k)!.delete(p)
        else if (!state.has(p)) visit(p)
      }
      state.set(k, 'done')
    }
    for (const k of connected) if (!state.has(k)) visit(k)
    const ranks = new Map<string, number>()
    const rank = (k: string): number => {
      if (!ranks.has(k)) ranks.set(k, Math.max(-1, ...[...parents.get(k)!].map(rank)) + 1)
      return ranks.get(k)!
    }
    const top = Math.max(0, ...connected.map(rank))
    layers = Array.from({ length: top + 1 }, (_, i) => connected.filter((k) => rank(k) === top - i))
    const perColumn = Math.ceil(Math.sqrt(isolated.length))
    extra = Array.from({ length: Math.ceil(isolated.length / perColumn) }, (_, i) =>
      isolated.slice(i * perColumn, (i + 1) * perColumn),
    )
  }

  // Stacks each layer, centered on the tallest.
  const place = () => {
    const heights = [...layers, ...extra].map((l) => l.reduce((h, k) => h + nodes.get(k)!.height + GAP_Y, -GAP_Y))
    const tallest = Math.max(0, ...heights)
    let x = 0
    for (const [i, layer] of [...layers, ...extra].entries()) {
      let y = (tallest - heights[i]!) / 2
      for (const k of layer) {
        const node = nodes.get(k)!
        Object.assign(node, { x, y })
        y += node.height + GAP_Y
      }
      x += Math.max(0, ...layer.map((k) => nodes.get(k)!.width)) + GAP_X
    }
  }
  place()
  // Two sweeps over the layers order each node by the mean height of its neighbors in the previous layer.
  if (!focus) {
    const sweep = (order: number[], back: number) => {
      for (const i of order) {
        const centers = new Map(
          layers[i]!.map((k) => {
            const near = neighbors(k).filter((n) => layers[i + back]?.includes(n))
            const mean = near.length
              ? near.reduce((s, n) => s + nodes.get(n)!.y + nodes.get(n)!.height / 2, 0) / near.length
              : nodes.get(k)!.y + nodes.get(k)!.height / 2
            return [k, mean]
          }),
        )
        layers[i]!.sort((a, b) => centers.get(a)! - centers.get(b)! || (a < b ? -1 : 1))
        place()
      }
    }
    const indexes = layers.map((_, i) => i)
    sweep(indexes.slice(1), -1)
    sweep(indexes.slice(0, -1).reverse(), 1)
  }

  const rowY = (node: ErNode, column: string) => {
    const i = node.columns.findIndex((c) => c.name === column)
    return node.y + (i === -1 ? HEADER / 2 : HEADER + ROW * (i + 0.5))
  }
  const edges = model.relations
    .filter((r) => nodes.has(tableKey(r.schema, r.table)) && nodes.has(tableKey(r.refSchema, r.refTable)))
    .map((relation): ErEdge => {
      const from = tableKey(relation.schema, relation.table)
      const to = tableKey(relation.refSchema, relation.refTable)
      const [a, b] = [nodes.get(from)!, nodes.get(to)!]
      const y1 = rowY(a, relation.columns[0]!)
      const y2 = rowY(b, relation.refColumns[0]!)
      let path: string
      if (a.x + a.width <= b.x) {
        const [x1, x2] = [a.x + a.width, b.x]
        path = `M ${x1} ${y1} C ${x1 + CURVE} ${y1}, ${x2 - CURVE} ${y2}, ${x2} ${y2}`
      } else if (b.x + b.width <= a.x) {
        const [x1, x2] = [a.x, b.x + b.width]
        path = `M ${x1} ${y1} C ${x1 - CURVE} ${y1}, ${x2 + CURVE} ${y2}, ${x2} ${y2}`
      } else {
        // The same layer: a loop on the right side.
        const [x1, x2] = [a.x + a.width, b.x + b.width]
        const bulge = Math.max(x1, x2) + CURVE
        path = `M ${x1} ${y1} C ${bulge} ${y1}, ${bulge} ${y2}, ${x2} ${y2}`
      }
      return { relation, from, to, path }
    })
  const all = [...nodes.values()]
  return {
    nodes: all,
    edges,
    width: Math.max(0, ...all.map((n) => n.x + n.width)) + CURVE,
    height: Math.max(0, ...all.map((n) => n.y + n.height)),
  }
}
