import type { SplitDialect } from '../sql-split.ts'
import type { Change, SchemaDiff, TableDiff } from './schema-diff.ts'
import { MSSQL_VIEW_HEAD, normalize, qualified, quoteIdent } from './sql.ts'
import type {
  ObjectDiff,
  PartDiff,
  SchemaSnapshot,
  SnapshotColumn,
  SnapshotConstraint,
  SnapshotTable,
  SnapshotView,
} from './types.ts'

const SERIAL: Record<string, string> = { smallint: 'smallserial', integer: 'serial', bigint: 'bigserial' }

/** Renders the statements of a deploy script for one engine; names are those of the target schema. */
class Renderer {
  constructor(
    private dialect: SplitDialect,
    private schema: string,
  ) {}

  q = (name: string) => quoteIdent(this.dialect, name)
  table = (name: string) => qualified(this.dialect, this.schema, name)

  /** Column definition after its name, as in CREATE TABLE and ADD COLUMN. */
  columnDef(table: string, c: SnapshotColumn): string {
    const { dialect } = this
    const name = this.q(c.name)
    const nullability = c.nullable ? 'null' : 'not null'
    if (dialect === 'postgres') {
      const serial = c.serial && SERIAL[c.type]
      const parts = [name, serial || c.type]
      if (c.generated)
        parts.push(`generated always as (${c.generated.expression}) ${c.generated.stored ? 'stored' : 'virtual'}`)
      else if (c.identity) parts.push(`generated ${c.identity} as identity`)
      if (c.default !== null && !c.generated) parts.push(`default ${c.default}`)
      if (!c.nullable) parts.push('not null')
      return parts.join(' ')
    }
    if (dialect === 'mysql') {
      const parts = [name, c.type]
      if (c.generated)
        parts.push(`generated always as (${c.generated.expression}) ${c.generated.stored ? 'stored' : 'virtual'}`)
      parts.push(nullability)
      if (c.default !== null) parts.push(`default ${c.default}`)
      if (c.identity) parts.push('auto_increment')
      return parts.join(' ')
    }
    // SQL Server: the default is its own constraint, added with the column.
    if (c.generated) return `${name} as ${c.generated.expression}${c.generated.stored ? ' persisted' : ''}`
    const parts = [name, c.type]
    if (c.identity) parts.push(`identity(${c.identity})`)
    parts.push(nullability)
    if (c.default !== null) parts.push(`constraint ${this.defaultName(table, c.name)} default ${c.default}`)
    return parts.join(' ')
  }

  /** SQL Server: the default constraints this script creates are named after table and column. */
  defaultName = (table: string, column: string) => this.q(`DF_${table}_${column}`)

  constraintDef(c: SnapshotConstraint): string {
    return this.dialect === 'mysql' && c.type === 'primary'
      ? c.definition
      : `constraint ${this.q(c.name)} ${c.definition}`
  }

  /** CREATE TABLE; foreign keys come later in the script (`inlineForeign` for the display text). */
  createTable(table: SnapshotTable, inlineForeign: boolean): string {
    const lines = [
      ...table.columns.map((c) => this.columnDef(table.name, c)),
      ...table.constraints.filter((c) => inlineForeign || c.type !== 'foreign').map((c) => this.constraintDef(c)),
    ]
    return `create table ${this.table(table.name)} (\n  ${lines.join(',\n  ')}\n)`
  }

  createView(view: SnapshotView, replace = false): string {
    const { dialect } = this
    if (dialect === 'postgres') return `create view ${this.table(view.name)} as\n${view.definition}`
    if (dialect === 'mysql')
      return `create ${replace ? 'or replace ' : ''}view ${this.table(view.name)} as ${view.definition}`
    return view.definition.replace(MSSQL_VIEW_HEAD, `create ${replace ? 'or alter ' : ''}view ${this.table(view.name)}`)
  }

  dropView = (name: string) => `drop view ${this.table(name)}`

  addColumn = (table: string, c: SnapshotColumn) =>
    `alter table ${this.table(table)} add ${this.dialect === 'mssql' ? '' : 'column '}${this.columnDef(table, c)}`

  dropColumn(table: string, c: SnapshotColumn): string[] {
    const drop = `alter table ${this.table(table)} drop column ${this.q(c.name)}`
    return this.dialect === 'mssql' && c.defaultName
      ? [`alter table ${this.table(table)} drop constraint ${this.q(c.defaultName)}`, drop]
      : [drop]
  }

  /** Brings the column `old` of the target to the definition `col` of the source. */
  alterColumn(table: string, old: SnapshotColumn, col: SnapshotColumn): string[] {
    const { dialect } = this
    const text = (v: string | null | undefined) => normalize(v ?? '')
    const generated =
      text(old.generated?.expression) !== text(col.generated?.expression) ||
      old.generated?.stored !== col.generated?.stored
    const identity = dialect === 'mssql' ? !!old.identity !== !!col.identity : false
    if (dialect !== 'mysql' && (generated || identity))
      return [...this.dropColumn(table, old), this.addColumn(table, col)]
    const T = this.table(table)
    const c = this.q(col.name)
    if (dialect === 'mysql') return [`alter table ${T} modify column ${this.columnDef(table, col)}`]
    const typeChanged = old.type !== col.type
    const defaultChanged = text(old.default) !== text(col.default)
    const nullChanged = old.nullable !== col.nullable
    if (dialect === 'mssql') {
      // A default constraint blocks changing the type of its column, so it is dropped and added again.
      const redefine = typeChanged || defaultChanged
      const out: string[] = []
      if (redefine && old.defaultName) out.push(`alter table ${T} drop constraint ${this.q(old.defaultName)}`)
      if (typeChanged || nullChanged) {
        out.push(`alter table ${T} alter column ${c} ${col.type} ${col.nullable ? 'null' : 'not null'}`)
      }
      if (redefine && col.default !== null) {
        out.push(`alter table ${T} add constraint ${this.defaultName(table, col.name)} default ${col.default} for ${c}`)
      }
      return out
    }
    const at = `alter table ${T} alter column ${c}`
    const out: string[] = []
    if (old.identity && !col.identity) out.push(`${at} drop identity`)
    if (typeChanged) out.push(`${at} type ${col.type} using ${c}::${col.type}`)
    if (defaultChanged) out.push(col.default === null ? `${at} drop default` : `${at} set default ${col.default}`)
    if (nullChanged) out.push(`${at} ${col.nullable ? 'drop' : 'set'} not null`)
    if (col.identity && old.identity !== col.identity) {
      out.push(old.identity ? `${at} set generated ${col.identity}` : `${at} add generated ${col.identity} as identity`)
    }
    return out
  }

  addConstraint(table: string, c: SnapshotConstraint): string {
    return `alter table ${this.table(table)} add ${this.constraintDef(c)}`
  }

  dropConstraint(table: string, c: SnapshotConstraint): string {
    const T = this.table(table)
    if (this.dialect === 'mysql' && c.type === 'primary') return `alter table ${T} drop primary key`
    if (this.dialect === 'mysql' && c.type === 'foreign') return `alter table ${T} drop foreign key ${this.q(c.name)}`
    return `alter table ${T} drop constraint ${this.q(c.name)}`
  }

  dropIndex(table: string, name: string): string {
    return this.dialect === 'postgres'
      ? `drop index ${this.table(name)}`
      : `drop index ${this.q(name)} on ${this.table(table)}`
  }
}

const parts = (part: PartDiff['part'], changes: Change<unknown>[]): PartDiff[] =>
  changes.filter((c) => c.status !== 'same').map((c) => ({ part, name: c.name, status: c.status }))

/** The script that brings the target to the source, and the compared objects with their CREATE text. */
export function deployScript(
  dialect: SplitDialect,
  diff: SchemaDiff,
  source: SchemaSnapshot,
  target: SchemaSnapshot,
): { objects: ObjectDiff[]; script: string } {
  const r = new Renderer(dialect, target.schema)
  const display = (t?: SnapshotTable) =>
    t ? [r.createTable(t, true), ...t.indexes.map((i) => i.definition)].join(';\n') + ';' : null
  const view = (v?: SnapshotView) => (v ? r.createView(v) : null)

  const objects: ObjectDiff[] = [
    ...diff.tables.map<ObjectDiff>((t) => ({
      kind: 'table',
      name: t.name,
      status: t.status,
      source: display(t.source),
      target: display(t.target),
      parts: [...parts('column', t.columns), ...parts('constraint', t.constraints), ...parts('index', t.indexes)],
    })),
    ...diff.views.map<ObjectDiff>((v) => ({
      kind: 'view',
      name: v.name,
      status: v.status,
      source: view(v.source),
      target: view(v.target),
      parts: [],
    })),
  ]

  const is =
    (...status: string[]) =>
    (c: { status: string }) =>
      status.includes(c.status)
  const existing = diff.tables.filter(
    (t): t is TableDiff & { source: SnapshotTable; target: SnapshotTable } =>
      t.status === 'changed' && !!t.source && !!t.target,
  )
  const added = diff.tables.filter((t) => t.status === 'added')
  const removed = diff.tables.filter((t) => t.status === 'removed')
  const foreign = (c: Change<SnapshotConstraint>) => (c.source ?? c.target)!.type === 'foreign'
  const statements: string[] = []

  // 1. Foreign keys that go away or change, also those of dropped tables.
  for (const t of removed) {
    for (const c of t.target!.constraints.filter((k) => k.type === 'foreign'))
      statements.push(r.dropConstraint(t.name, c))
  }
  for (const t of existing) {
    for (const c of t.constraints.filter((k) => foreign(k) && is('removed', 'changed')(k))) {
      statements.push(r.dropConstraint(t.name, c.target!))
    }
  }
  // 2. Views that go away; PostgreSQL also drops changed ones (CREATE OR REPLACE cannot change columns).
  for (const v of diff.views.filter(is(...(dialect === 'postgres' ? ['removed', 'changed'] : ['removed'])))) {
    statements.push(r.dropView(v.name))
  }
  // 3. Indexes and other constraints that go away or change.
  for (const t of existing) {
    for (const i of t.indexes.filter(is('removed', 'changed'))) statements.push(r.dropIndex(t.name, i.name))
    for (const c of t.constraints.filter((k) => !foreign(k) && is('removed', 'changed')(k))) {
      statements.push(r.dropConstraint(t.name, c.target!))
    }
  }
  // 4. Tables that go away.
  for (const t of removed) statements.push(`drop table ${r.table(t.name)}`)
  // 5. New tables.
  for (const t of added) statements.push(r.createTable(t.source!, false))
  // 6. Columns.
  for (const t of existing) {
    for (const c of t.columns) {
      if (c.status === 'added') statements.push(r.addColumn(t.name, c.source!))
      else if (c.status === 'removed') statements.push(...r.dropColumn(t.name, c.target!))
      else if (c.status === 'changed') statements.push(...r.alterColumn(t.name, c.target!, c.source!))
    }
  }
  // 7. Other constraints and indexes that are new or changed, and the indexes of new tables.
  for (const t of existing) {
    for (const c of t.constraints.filter((k) => !foreign(k) && is('added', 'changed')(k))) {
      statements.push(r.addConstraint(t.name, c.source!))
    }
    for (const i of t.indexes.filter(is('added', 'changed'))) statements.push(i.source!.definition)
  }
  for (const t of added) for (const i of t.source!.indexes) statements.push(i.definition)
  // 8. Foreign keys that are new or changed, and those of new tables.
  for (const t of added) {
    for (const c of t.source!.constraints.filter((k) => k.type === 'foreign'))
      statements.push(r.addConstraint(t.name, c))
  }
  for (const t of existing) {
    for (const c of t.constraints.filter((k) => foreign(k) && is('added', 'changed')(k))) {
      statements.push(r.addConstraint(t.name, c.source!))
    }
  }
  // 9. Views that are new or changed.
  for (const v of diff.views.filter(is('added', 'changed'))) {
    statements.push(r.createView(v.source!, v.status === 'changed' && dialect !== 'postgres'))
  }

  const header = `-- Deploy ${source.schema} → ${target.schema} (Colwerk)`
  if (!statements.length) return { objects, script: `${header}\n-- No differences\n` }
  const lines =
    dialect === 'mssql'
      ? ['begin transaction', ...statements, 'commit'].map((s) => `${s}\nGO`)
      : [
          ...(dialect === 'postgres' ? ['begin;'] : []),
          ...statements.map((s) => `${s};`),
          ...(dialect === 'postgres' ? ['commit;'] : []),
        ]
  return { objects, script: `${header}\n${lines.join('\n')}\n` }
}
