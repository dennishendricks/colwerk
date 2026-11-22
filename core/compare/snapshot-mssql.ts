import { COLUMN_TYPE } from '../drivers/mssql.ts'
import type { Session } from '../types.ts'
import { append, buildTables, group, groupByTable, type Snapshot, toViews } from './snapshot.ts'
import { flag, query, quoteIdent, stringLiteral } from './sql.ts'
import type { SnapshotConstraint, SnapshotIndex } from './types.ts'

const q = (name: string) => quoteIdent('mssql', name)
const direction = (descending: unknown) => (flag(descending) ? 'DESC' : 'ASC')

export async function snapshotMssql(session: Session, schema: string): Promise<Snapshot> {
  const S = stringLiteral('mssql', schema)
  const skipped: string[] = []
  const tables = await query<{ name: string }>(
    session,
    `select name from sys.tables where schema_id = schema_id(${S}) and is_ms_shipped = 0 order by 1`,
  )
  const columns = await query<{
    table_name: string
    name: string
    type: string
    nullable: unknown
    default: string | null
    default_name: string | null
    identity: string | null
    generated: string | null
    stored: unknown
  }>(
    session,
    `select t.name as table_name, c.name, ${COLUMN_TYPE} as type, c.is_nullable as nullable, d.definition as [default], d.name as default_name,
       case when ic.object_id is not null then cast(ic.seed_value as varchar(40)) + ',' + cast(ic.increment_value as varchar(40)) end as [identity],
       cc.definition as generated, cc.is_persisted as stored
     from sys.columns c join sys.tables t on t.object_id = c.object_id
     left join sys.default_constraints d on d.object_id = c.default_object_id
     left join sys.identity_columns ic on ic.object_id = c.object_id and ic.column_id = c.column_id
     left join sys.computed_columns cc on cc.object_id = c.object_id and cc.column_id = c.column_id
     where t.schema_id = schema_id(${S}) and t.is_ms_shipped = 0 order by t.name, c.column_id`,
  )
  const keys = await query<{
    table_name: string
    name: string
    type: string
    index_type: string
    column_name: string
    is_desc: unknown
  }>(
    session,
    `select t.name as table_name, k.name, k.type, i.type_desc as index_type, c.name as column_name, ic.is_descending_key as is_desc
     from sys.key_constraints k join sys.tables t on t.object_id = k.parent_object_id
     join sys.indexes i on i.object_id = k.parent_object_id and i.index_id = k.unique_index_id
     join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id and ic.key_ordinal > 0
     join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id
     where t.schema_id = schema_id(${S}) and t.is_ms_shipped = 0 order by t.name, k.name, ic.key_ordinal`,
  )
  const checks = await query<{ table_name: string; name: string; definition: string }>(
    session,
    `select t.name as table_name, k.name, k.definition from sys.check_constraints k join sys.tables t on t.object_id = k.parent_object_id
     where t.schema_id = schema_id(${S}) and t.is_ms_shipped = 0`,
  )
  const foreignKeys = await query<{
    table_name: string
    name: string
    column_name: string
    ref_schema: string
    ref_table: string
    ref_column: string
    delete_rule: string
    update_rule: string
  }>(
    session,
    `select t.name as table_name, f.name, c.name as column_name, rs.name as ref_schema, rt.name as ref_table, rc.name as ref_column,
       f.delete_referential_action_desc as delete_rule, f.update_referential_action_desc as update_rule
     from sys.foreign_keys f join sys.tables t on t.object_id = f.parent_object_id
     join sys.foreign_key_columns fc on fc.constraint_object_id = f.object_id
     join sys.columns c on c.object_id = fc.parent_object_id and c.column_id = fc.parent_column_id
     join sys.tables rt on rt.object_id = fc.referenced_object_id join sys.schemas rs on rs.schema_id = rt.schema_id
     join sys.columns rc on rc.object_id = fc.referenced_object_id and rc.column_id = fc.referenced_column_id
     where t.schema_id = schema_id(${S}) and t.is_ms_shipped = 0 order by t.name, f.name, fc.constraint_column_id`,
  )
  const indexRows = await query<{
    table_name: string
    name: string
    is_unique: unknown
    type: number
    type_desc: string
    filter: string | null
    column_name: string
    is_desc: unknown
    included: unknown
  }>(
    session,
    `select t.name as table_name, i.name, i.is_unique, i.type, i.type_desc, i.filter_definition as filter, c.name as column_name,
       ic.is_descending_key as is_desc, ic.is_included_column as included
     from sys.indexes i join sys.tables t on t.object_id = i.object_id
     join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id
     join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id
     where t.schema_id = schema_id(${S}) and t.is_ms_shipped = 0 and i.is_primary_key = 0 and i.is_unique_constraint = 0
       and i.is_hypothetical = 0 and i.index_id > 0
     order by t.name, i.name, ic.is_included_column, ic.key_ordinal, ic.index_column_id`,
  )
  const views = await query<{ name: string; definition: string }>(
    session,
    `select o.name, object_definition(o.object_id) as definition from sys.views o where o.schema_id = schema_id(${S}) and o.is_ms_shipped = 0`,
  )

  const constraints = new Map<string, SnapshotConstraint[]>()
  for (const rows of group(keys, (k) => JSON.stringify([k.table_name, k.name])).values()) {
    const first = rows[0]!
    const primary = first.type === 'PK'
    append(constraints, first.table_name, {
      name: first.name,
      type: primary ? 'primary' : 'unique',
      definition: `${primary ? 'PRIMARY KEY' : 'UNIQUE'} ${first.index_type} (${rows.map((r) => `${q(r.column_name)} ${direction(r.is_desc)}`).join(', ')})`,
      columns: rows.map((r) => r.column_name),
    })
  }
  for (const c of checks) {
    append(constraints, c.table_name, { name: c.name, type: 'check', definition: `CHECK ${c.definition}`, columns: [] })
  }
  for (const rows of group(foreignKeys, (f) => JSON.stringify([f.table_name, f.name])).values()) {
    const first = rows[0]!
    const rule = (action: string) => action.replaceAll('_', ' ')
    append(constraints, first.table_name, {
      name: first.name,
      type: 'foreign',
      definition: `FOREIGN KEY (${rows.map((r) => q(r.column_name)).join(', ')}) REFERENCES ${q(first.ref_schema)}.${q(first.ref_table)} (${rows.map((r) => q(r.ref_column)).join(', ')}) ON DELETE ${rule(first.delete_rule)} ON UPDATE ${rule(first.update_rule)}`,
      columns: rows.map((r) => r.column_name),
    })
  }
  const indexes = new Map<string, SnapshotIndex[]>()
  for (const rows of group(indexRows, (i) => JSON.stringify([i.table_name, i.name])).values()) {
    const first = rows[0]!
    // Only clustered and nonclustered rowstore indexes are compared (not columnstore, XML or spatial).
    if (first.type !== 1 && first.type !== 2) {
      skipped.push(`${first.table_name}.${first.name}`)
      continue
    }
    const key = rows
      .filter((r) => !flag(r.included))
      .map((r) => `${q(r.column_name)} ${direction(r.is_desc).toLowerCase()}`)
    const included = rows.filter((r) => flag(r.included)).map((r) => q(r.column_name))
    append(indexes, first.table_name, {
      name: first.name,
      definition:
        `create ${flag(first.is_unique) ? 'unique ' : ''}${first.type === 1 ? 'clustered' : 'nonclustered'} index ${q(first.name)} on ${q(schema)}.${q(first.table_name)} (${key.join(', ')})` +
        `${included.length ? ` include (${included.join(', ')})` : ''}${first.filter ? ` where ${first.filter}` : ''}`,
    })
  }
  return {
    tables: buildTables(
      tables.map((t) => t.name),
      groupByTable(columns, (c) => ({
        name: c.name,
        type: c.type,
        nullable: flag(c.nullable),
        default: c.default,
        defaultName: c.default_name ?? undefined,
        identity: c.identity,
        generated: c.generated === null ? null : { expression: c.generated, stored: flag(c.stored) },
      })),
      constraints,
      indexes,
    ),
    views: toViews(views),
    skipped,
  }
}
