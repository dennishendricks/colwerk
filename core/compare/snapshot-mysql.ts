import type { Session } from '../types.ts'
import { append, buildTables, group, groupByTable, type Snapshot, toViews } from './snapshot.ts'
import { flag, query, quoteIdent, stringLiteral } from './sql.ts'
import type { SnapshotColumn, SnapshotConstraint, SnapshotIndex } from './types.ts'

const q = (name: string) => quoteIdent('mysql', name)
const NUMERIC = /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|bit)/i

/** S is the database name. */
export async function snapshotMysql(session: Session, schema: string): Promise<Snapshot> {
  const S = stringLiteral('mysql', schema)
  const [version] = await query<{ mariadb: unknown }>(session, `select version() like '%MariaDB%' as mariadb`)
  const isMariadb = flag(version!.mariadb)
  const skipped: string[] = []
  const tables = await query<{ name: string }>(
    session,
    `select table_name as name from information_schema.tables where table_schema = ${S} and table_type = 'BASE TABLE' order by 1`,
  )
  const columns = await query<{
    table_name: string
    name: string
    type: string
    nullable: unknown
    default: string | null
    extra: string
    generated: string | null
  }>(
    session,
    `select table_name as table_name, column_name as name, column_type as type, is_nullable = 'YES' as nullable,
       column_default as \`default\`, extra as extra, generation_expression as generated
     from information_schema.columns where table_schema = ${S} order by table_name, ordinal_position`,
  )
  const statistics = await query<{
    table_name: string
    name: string
    is_unique: unknown
    index_type: string
    column_name: string | null
    sub_part: number | string | null
    collation: string | null
  }>(
    session,
    `select table_name as table_name, index_name as name, non_unique = 0 as is_unique, index_type as index_type,
       column_name as column_name, sub_part as sub_part, collation as \`collation\`
     from information_schema.statistics where table_schema = ${S} order by table_name, index_name, seq_in_index`,
  )
  const foreignKeys = await query<{
    table_name: string
    name: string
    column_name: string
    ref_schema: string
    ref_table: string
    ref_column: string
    update_rule: string
    delete_rule: string
  }>(
    session,
    `select k.table_name as table_name, k.constraint_name as name, k.column_name as column_name, k.referenced_table_schema as ref_schema,
       k.referenced_table_name as ref_table, k.referenced_column_name as ref_column, r.update_rule as update_rule, r.delete_rule as delete_rule
     from information_schema.key_column_usage k join information_schema.referential_constraints r
       on r.constraint_schema = k.constraint_schema and r.constraint_name = k.constraint_name and r.table_name = k.table_name
     where k.table_schema = ${S} and k.referenced_table_name is not null order by k.table_name, k.constraint_name, k.ordinal_position`,
  )
  // Check constraints exist from MySQL 8.0.16 and MariaDB 10.2.
  const checks = await query<{ table_name: string; name: string; check_clause: string }>(
    session,
    `select tc.table_name as table_name, tc.constraint_name as name, cc.check_clause as check_clause
     from information_schema.table_constraints tc join information_schema.check_constraints cc
       on cc.constraint_schema = tc.constraint_schema and cc.constraint_name = tc.constraint_name
     where tc.table_schema = ${S} and tc.constraint_type = 'CHECK'`,
  ).catch(() => [])
  const views = await query<{ name: string; definition: string }>(
    session,
    `select table_name as name, view_definition as definition from information_schema.views where table_schema = ${S}`,
  )

  const column = (c: (typeof columns)[number]): SnapshotColumn => {
    const extra = c.extra ?? ''
    const generated = /VIRTUAL|STORED|PERSISTENT/i.test(extra)
    let value = c.default
    if (isMariadb) {
      if (value === 'NULL') value = null
    } else if (value !== null) {
      if (/DEFAULT_GENERATED/i.test(extra)) {
        if (!/^current_timestamp/i.test(value)) value = `(${value})`
      } else if (!NUMERIC.test(c.type)) value = stringLiteral('mysql', value)
    }
    const onUpdate = /on update (.*)$/i.exec(extra)?.[1]
    if (value !== null && onUpdate) value += ` on update ${onUpdate}`
    return {
      name: c.name,
      type: c.type,
      nullable: flag(c.nullable),
      default: generated ? null : value,
      identity: /auto_increment/i.test(extra) ? 'auto_increment' : null,
      generated: generated ? { expression: c.generated ?? '', stored: !/VIRTUAL/i.test(extra) } : null,
    }
  }

  const constraints = new Map<string, SnapshotConstraint[]>()
  const indexes = new Map<string, SnapshotIndex[]>()
  for (const rows of group(statistics, (s) => JSON.stringify([s.table_name, s.name])).values()) {
    const { table_name: table, name, is_unique, index_type } = rows[0]!
    if (name === 'PRIMARY') {
      const names = rows.map((r) => r.column_name!)
      append(constraints, table, {
        name,
        type: 'primary',
        definition: `PRIMARY KEY (${names.map(q).join(', ')})`,
        columns: names,
      })
    } else if (rows.some((r) => r.column_name === null)) {
      skipped.push(`${table}.${name}`)
    } else {
      const kind = /fulltext|spatial/i.test(index_type)
        ? `${index_type.toLowerCase()} `
        : flag(is_unique)
          ? 'unique '
          : ''
      const parts = rows.map(
        (r) => `${q(r.column_name!)}${r.sub_part ? `(${r.sub_part})` : ''}${r.collation === 'D' ? ' desc' : ''}`,
      )
      append(indexes, table, {
        name,
        definition: `create ${kind}index ${q(name)} on ${q(schema)}.${q(table)} (${parts.join(', ')})`,
      })
    }
  }
  for (const rows of group(foreignKeys, (f) => JSON.stringify([f.table_name, f.name])).values()) {
    const first = rows[0]!
    append(constraints, first.table_name, {
      name: first.name,
      type: 'foreign',
      definition: `FOREIGN KEY (${rows.map((r) => q(r.column_name)).join(', ')}) REFERENCES ${q(first.ref_schema)}.${q(first.ref_table)} (${rows.map((r) => q(r.ref_column)).join(', ')}) ON DELETE ${first.delete_rule} ON UPDATE ${first.update_rule}`,
      columns: rows.map((r) => r.column_name),
    })
  }
  for (const c of checks) {
    append(constraints, c.table_name, {
      name: c.name,
      type: 'check',
      definition: `CHECK (${c.check_clause})`,
      columns: [],
    })
  }
  return {
    tables: buildTables(
      tables.map((t) => t.name),
      groupByTable(columns, column),
      constraints,
      indexes,
    ),
    views: toViews(views),
    skipped,
  }
}
