import type {
  SchemaSnapshot,
  SnapshotColumn,
  SnapshotConstraint,
  SnapshotIndex,
  SnapshotTable,
  SnapshotView,
} from './types.ts'

/** Result of the catalog queries of one engine (snapshot-<engine>.ts); definitions use the schema as written. */
export type Snapshot = Pick<SchemaSnapshot, 'tables' | 'views' | 'skipped'>

/** Groups rows by `key`. */
export function group<R>(rows: R[], key: (row: R) => string): Map<string, R[]> {
  const groups = new Map<string, R[]>()
  for (const row of rows) {
    const k = key(row)
    const rest = groups.get(k)
    if (rest) rest.push(row)
    else groups.set(k, [row])
  }
  return groups
}

/** Groups catalog rows by table name and maps them. */
export const groupByTable = <R extends { table_name: string }, T>(rows: R[], map: (row: R) => T): Map<string, T[]> =>
  new Map([...group(rows, (r) => r.table_name)].map(([table, list]) => [table, list.map(map)]))

/** Appends to the list of `table`. */
export function append<T>(map: Map<string, T[]>, table: string, item: T) {
  const list = map.get(table)
  if (list) list.push(item)
  else map.set(table, [item])
}

export function buildTables(
  names: string[],
  columns: Map<string, SnapshotColumn[]>,
  constraints: Map<string, SnapshotConstraint[]>,
  indexes: Map<string, SnapshotIndex[]>,
): SnapshotTable[] {
  return names.map((name) => ({
    name,
    columns: columns.get(name) ?? [],
    constraints: constraints.get(name) ?? [],
    indexes: indexes.get(name) ?? [],
  }))
}

export const toViews = (rows: { name: string; definition: string }[]): SnapshotView[] =>
  rows.map((r) => ({ name: r.name, definition: r.definition }))
