import type { ForeignKeyInfo } from '../types.ts'

/** One row per FK column, in column order. */
export interface ForeignKeyRow {
  name: string
  schema: string
  table: string
  col: string
  ref_schema: string
  ref_table: string
  ref_col: string
}

/** Turns rows with one FK column each into one entry per foreign key (rows of a key must be adjacent). */
export function groupForeignKeys(rows: ForeignKeyRow[]): ForeignKeyInfo[] {
  const keys = new Map<string, ForeignKeyInfo>()
  for (const r of rows) {
    const id = JSON.stringify([r.schema, r.table, r.name])
    let key = keys.get(id)
    if (!key) {
      key = {
        name: r.name,
        schema: r.schema,
        table: r.table,
        columns: [],
        refSchema: r.ref_schema,
        refTable: r.ref_table,
        refColumns: [],
      }
      keys.set(id, key)
    }
    key.columns.push(r.col)
    key.refColumns.push(r.ref_col)
  }
  return [...keys.values()]
}
