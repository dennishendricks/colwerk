import { AppError, type Session } from '../types.ts'
import { flag, query, stringLiteral } from './sql.ts'
import { buildTables, groupByTable, type Snapshot, toViews } from './snapshot.ts'
import type { SnapshotConstraint } from './types.ts'

const CONSTRAINT_TYPES = { p: 'primary', u: 'unique', c: 'check', f: 'foreign', x: 'unique' } as const

export async function snapshotPostgres(session: Session, schema: string): Promise<Snapshot> {
  const [server] = await query<{ version: number }>(
    session,
    `select current_setting('server_version_num')::int as version`,
  )
  if (server!.version < 120000)
    throw new AppError('comparePostgresVersion', 'Schema compare needs PostgreSQL 12 or later.')
  const S = stringLiteral('postgres', schema)
  const tables = await query<{ name: string }>(
    session,
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${S} and c.relkind in ('r','p') and not c.relispartition order by 1`,
  )
  const columns = await query<{
    table_name: string
    name: string
    type: string
    nullable: boolean
    default: string | null
    identity: string | null
    generated: string | null
    stored: boolean
    serial: boolean
  }>(
    session,
    `select c.relname as table_name, a.attname as name, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable,
       case when a.attgenerated = '' then pg_get_expr(d.adbin, d.adrelid) end as "default",
       case a.attidentity when 'a' then 'always' when 'd' then 'by default' end as identity,
       case when a.attgenerated in ('s', 'v') then pg_get_expr(d.adbin, d.adrelid) end as generated, a.attgenerated = 's' as stored,
       pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) is not null and a.attidentity = '' as serial
     from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = ${S} and c.relkind in ('r','p') and not c.relispartition and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attnum`,
  )
  const constraints = await query<{
    table_name: string
    name: string
    type: keyof typeof CONSTRAINT_TYPES
    definition: string
    columns: string[]
  }>(
    session,
    `select c.relname as table_name, k.conname as name, k.contype as type, pg_get_constraintdef(k.oid, true) as definition,
       array(select a.attname::text from unnest(k.conkey) with ordinality u(n, i) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n order by u.i) as columns
     from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${S} and k.contype in ('p','u','c','f','x') and c.relkind in ('r','p') and not c.relispartition and k.conparentid = 0
     order by 1, 2`,
  )
  const indexes = await query<{ table_name: string; name: string; definition: string }>(
    session,
    `select c.relname as table_name, ic.relname as name, pg_get_indexdef(i.indexrelid) as definition
     from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${S} and c.relkind in ('r','p') and not c.relispartition
       and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.contype in ('p','u','x'))
     order by 1, 2`,
  )
  const views = await query<{ name: string; definition: string }>(
    session,
    `select c.relname as name, pg_get_viewdef(c.oid, true) as definition from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${S} and c.relkind = 'v' order by 1`,
  )
  return {
    tables: buildTables(
      tables.map((t) => t.name),
      groupByTable(columns, (c) => {
        // The sequence of a serial column is created with it, so its default is not a difference.
        const serial = flag(c.serial)
        return {
          name: c.name,
          type: c.type,
          nullable: flag(c.nullable),
          default: serial && c.default?.startsWith('nextval(') ? null : c.default,
          identity: c.identity,
          serial: serial || undefined,
          generated: c.generated === null ? null : { expression: c.generated, stored: flag(c.stored) },
        }
      }),
      groupByTable(constraints, (k): SnapshotConstraint => ({ ...k, type: CONSTRAINT_TYPES[k.type] })),
      groupByTable(indexes, (i) => ({ name: i.name, definition: i.definition })),
    ),
    views: toViews(views.map((v) => ({ ...v, definition: v.definition.replace(/;\s*$/, '') }))),
    skipped: [],
  }
}
