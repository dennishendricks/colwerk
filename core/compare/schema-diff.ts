import type { SplitDialect } from '../sql-split.ts'
import { MSSQL_VIEW_HEAD, normalize } from './sql.ts'
import type {
  DiffStatus,
  SchemaSnapshot,
  SnapshotColumn,
  SnapshotConstraint,
  SnapshotIndex,
  SnapshotTable,
  SnapshotView,
} from './types.ts'

/** `source` is missing for `removed`, `target` for `added`. */
export interface Change<T> {
  name: string
  status: DiffStatus
  source?: T
  target?: T
}

export interface TableDiff {
  name: string
  status: DiffStatus
  source?: SnapshotTable
  target?: SnapshotTable
  columns: Change<SnapshotColumn>[]
  constraints: Change<SnapshotConstraint>[]
  indexes: Change<SnapshotIndex>[]
}

export interface SchemaDiff {
  tables: TableDiff[]
  views: Change<SnapshotView>[]
}

/** The definition of an index without its name. */
const unnamed = (i: SnapshotIndex) => normalize(i.definition.replaceAll(i.name, ''))

function columnsEqual(dialect: SplitDialect, a: SnapshotColumn, b: SnapshotColumn): boolean {
  const text = (v: string | null | undefined) => (v === null || v === undefined ? null : normalize(v))
  // SQL Server compares only whether there is an identity: seed and increment cannot be altered.
  const identity = (c: SnapshotColumn) => (dialect === 'mssql' ? !!c.identity : c.identity)
  return (
    a.type === b.type &&
    a.nullable === b.nullable &&
    text(a.default) === text(b.default) &&
    identity(a) === identity(b) &&
    text(a.generated?.expression) === text(b.generated?.expression) &&
    a.generated?.stored === b.generated?.stored
  )
}

/**
 * Matches the objects of both sides by name (PostgreSQL: exactly; otherwise case-insensitive) and compares them.
 * `same` decides for objects that match by name; objects without a match by name that `alike` pairs count as the
 * same object (e.g. constraints with generated names).
 */
function match<T extends { name: string }>(
  dialect: SplitDialect,
  source: T[],
  target: T[],
  same: (a: T, b: T) => boolean,
  alike?: (a: T, b: T) => boolean,
): Change<T>[] {
  const key = (name: string) => (dialect === 'postgres' ? name : name.toLowerCase())
  const targets = new Map(target.map((t) => [key(t.name), t]))
  const changes: Change<T>[] = []
  const unmatched: T[] = []
  for (const s of source) {
    const t = targets.get(key(s.name))
    if (!t) unmatched.push(s)
    else {
      targets.delete(key(s.name))
      changes.push({ name: s.name, status: same(s, t) ? 'same' : 'changed', source: s, target: t })
    }
  }
  for (const s of unmatched) {
    const found = alike && [...targets.values()].find((t) => alike(s, t))
    if (found) {
      targets.delete(key(found.name))
      changes.push({ name: s.name, status: 'same', source: s, target: found })
    } else changes.push({ name: s.name, status: 'added', source: s })
  }
  for (const t of targets.values()) changes.push({ name: t.name, status: 'removed', target: t })
  // Source order, then what only the target has.
  const position = (c: Change<T>) => (c.source ? source.indexOf(c.source) : source.length + target.indexOf(c.target!))
  return changes.sort((a, b) => position(a) - position(b))
}

const statusOf = (changes: Change<unknown>[]): DiffStatus =>
  changes.every((c) => c.status === 'same') ? 'same' : 'changed'

/** Differences of `source` to `target`: `added` is only in the source, `removed` only in the target. */
export function diffSnapshots(dialect: SplitDialect, source: SchemaSnapshot, target: SchemaSnapshot): SchemaDiff {
  const constraintDefinition = (c: SnapshotConstraint) => `${c.type} ${normalize(c.definition)}`
  const tables = match(dialect, source.tables, target.tables, () => true).map<TableDiff>((t) => {
    if (!t.source || !t.target) return { ...t, columns: [], constraints: [], indexes: [] }
    const columns = match(dialect, t.source.columns, t.target.columns, (a, b) => columnsEqual(dialect, a, b))
    const constraints = match(
      dialect,
      t.source.constraints,
      t.target.constraints,
      (a, b) => constraintDefinition(a) === constraintDefinition(b),
      (a, b) => constraintDefinition(a) === constraintDefinition(b),
    )
    const indexes = match(
      dialect,
      t.source.indexes,
      t.target.indexes,
      (a, b) => normalize(a.definition) === normalize(b.definition),
      (a, b) => unnamed(a) === unnamed(b),
    )
    return {
      ...t,
      status: statusOf([...columns, ...constraints, ...indexes]),
      columns,
      constraints,
      indexes,
    }
  })
  // SQL Server keeps the text of the view as created, so the name in `create view` does not count.
  const body = (v: SnapshotView) =>
    normalize(dialect === 'mssql' ? v.definition.replace(MSSQL_VIEW_HEAD, '') : v.definition)
  const views = match(dialect, source.views, target.views, (a, b) => body(a) === body(b))
  return { tables, views }
}
