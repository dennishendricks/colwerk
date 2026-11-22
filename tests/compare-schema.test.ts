// Schema diff and deploy script on fixture snapshots (no database needed).
import { test } from 'bun:test'
import { diffSnapshots } from '../core/compare/schema-diff.ts'
import { deployScript } from '../core/compare/schema-script.ts'
import { replaceSchema } from '../core/compare/sql.ts'
import type {
  SchemaSnapshot,
  SnapshotColumn,
  SnapshotConstraint,
  SnapshotIndex,
  SnapshotTable,
} from '../core/compare/types.ts'
import type { SplitDialect } from '../core/sql-split.ts'
import { assertEquals } from './assert.ts'

const column = (name: string, type: string, extra: Partial<SnapshotColumn> = {}): SnapshotColumn => ({
  name,
  type,
  nullable: true,
  default: null,
  identity: null,
  generated: null,
  ...extra,
})
const constraint = (
  name: string,
  type: SnapshotConstraint['type'],
  definition: string,
  columns: string[] = [],
): SnapshotConstraint => ({ name, type, definition, columns })
const index = (name: string, definition: string): SnapshotIndex => ({ name, definition })
const table = (
  name: string,
  columns: SnapshotColumn[],
  constraints: SnapshotConstraint[] = [],
  indexes: SnapshotIndex[] = [],
): SnapshotTable => ({ name, columns, constraints, indexes })
const snapshot = (schema: string, tables: SnapshotTable[], views: SchemaSnapshot['views'] = []): SchemaSnapshot => ({
  schema,
  tables,
  views,
  skipped: [],
})

function deploy(dialect: SplitDialect, source: SchemaSnapshot, target: SchemaSnapshot) {
  const diff = diffSnapshots(dialect, source, target)
  return deployScript(dialect, diff, source, target)
}

// Source and target differ in every way the compare knows; the PostgreSQL definitions are as the catalog reports them.
const pgSource = snapshot(
  'tgt',
  [
    table(
      'orders',
      [
        column('id', 'integer', { nullable: false, serial: true }),
        column('user_id', 'integer', { nullable: false }),
        column('total', 'numeric(10,2)', { nullable: false, default: '0' }),
      ],
      [
        constraint('orders_pk', 'primary', 'PRIMARY KEY (id)', ['id']),
        constraint('orders_user_fk', 'foreign', 'FOREIGN KEY (user_id) REFERENCES tgt.users(id) ON DELETE CASCADE', [
          'user_id',
        ]),
      ],
      [index('orders_user', 'CREATE INDEX orders_user ON tgt.orders USING btree (user_id)')],
    ),
    table(
      'users',
      [column('id', 'integer', { nullable: false }), column('name', 'text', { nullable: false })],
      [constraint('users_pkey', 'primary', 'PRIMARY KEY (id)', ['id'])],
    ),
    table('tags', [column('id', 'integer', { nullable: false })]),
  ],
  [{ name: 'user_names', definition: ' SELECT name\n   FROM tgt.users' }],
)
const pgTarget = snapshot(
  'tgt',
  [
    table(
      'orders',
      [
        column('id', 'integer', { nullable: false, serial: true }),
        column('user_id', 'integer', { nullable: false }),
        column('total', 'numeric(12,2)', { default: '1' }),
        column('note', 'text'),
      ],
      [
        // An auto-generated name: the same primary key under another name counts as equal.
        constraint('orders_pkey', 'primary', 'PRIMARY KEY (id)', ['id']),
        constraint('orders_user_fk', 'foreign', 'FOREIGN KEY (user_id) REFERENCES tgt.users(id)', ['user_id']),
      ],
    ),
    table(
      'users',
      [column('id', 'integer', { nullable: false }), column('name', 'character varying(20)')],
      [constraint('users_pk', 'primary', 'PRIMARY KEY (id)', ['id'])],
    ),
    table('legacy', [column('id', 'integer', { nullable: false })]),
  ],
  [{ name: 'user_names', definition: ' SELECT id\n   FROM tgt.users' }],
)

test('the diff lists tables, columns, constraints, indexes and views', () => {
  const { objects } = deploy('postgres', pgSource, pgTarget)
  assertEquals(
    objects.map((o) => [o.kind, o.name, o.status]),
    [
      ['table', 'orders', 'changed'],
      ['table', 'users', 'changed'],
      ['table', 'tags', 'added'],
      ['table', 'legacy', 'removed'],
      ['view', 'user_names', 'changed'],
    ],
  )
  assertEquals(objects[0]!.parts, [
    { part: 'column', name: 'total', status: 'changed' },
    { part: 'column', name: 'note', status: 'removed' },
    { part: 'constraint', name: 'orders_user_fk', status: 'changed' },
    { part: 'index', name: 'orders_user', status: 'added' },
  ])
  // The primary keys of users differ only by name.
  assertEquals(objects[1]!.parts, [{ part: 'column', name: 'name', status: 'changed' }])
  assertEquals(objects[2]!.source?.startsWith('create table "tgt"."tags"'), true)
  assertEquals(objects[2]!.target, null)
})

test('PostgreSQL deploy script', () => {
  assertEquals(
    deploy('postgres', pgSource, pgTarget).script,
    `-- Deploy tgt → tgt (Colwerk)
begin;
alter table "tgt"."orders" drop constraint "orders_user_fk";
drop view "tgt"."user_names";
drop table "tgt"."legacy";
create table "tgt"."tags" (
  "id" integer not null
);
alter table "tgt"."orders" alter column "total" type numeric(10,2) using "total"::numeric(10,2);
alter table "tgt"."orders" alter column "total" set default 0;
alter table "tgt"."orders" alter column "total" set not null;
alter table "tgt"."orders" drop column "note";
alter table "tgt"."users" alter column "name" type text using "name"::text;
alter table "tgt"."users" alter column "name" set not null;
CREATE INDEX orders_user ON tgt.orders USING btree (user_id);
alter table "tgt"."orders" add constraint "orders_user_fk" FOREIGN KEY (user_id) REFERENCES tgt.users(id) ON DELETE CASCADE;
create view "tgt"."user_names" as
 SELECT name
   FROM tgt.users;
commit;
`,
  )
})

const mysqlSource = snapshot('app', [
  table(
    'users',
    [
      column('id', 'int(11)', { nullable: false, identity: 'auto_increment' }),
      column('name', 'varchar(50)', { nullable: false, default: "'x'" }),
    ],
    [constraint('PRIMARY', 'primary', 'PRIMARY KEY (`id`)', ['id'])],
  ),
])
const mysqlTarget = snapshot('app', [
  table(
    'users',
    [column('id', 'int(11)', { nullable: false, identity: 'auto_increment' }), column('name', 'varchar(20)')],
    [constraint('PRIMARY', 'primary', 'PRIMARY KEY (`id`)', ['id'])],
  ),
  table('old', [column('id', 'int(11)', { nullable: false })]),
])

test('MySQL deploy script modifies the column and has no transaction', () => {
  assertEquals(
    deploy('mysql', mysqlSource, mysqlTarget).script,
    `-- Deploy app → app (Colwerk)
drop table \`app\`.\`old\`;
alter table \`app\`.\`users\` modify column \`name\` varchar(50) not null default 'x';
`,
  )
})

const mssqlSource = snapshot('dbo', [
  table(
    'users',
    [
      column('id', 'int', { nullable: false, identity: '1,1' }),
      column('name', 'varchar(50)', { nullable: false, default: "('x')" }),
    ],
    [constraint('PK_users', 'primary', 'PRIMARY KEY CLUSTERED ([id] ASC)', ['id'])],
  ),
])
const mssqlTarget = snapshot('dbo', [
  table(
    'users',
    [
      column('id', 'int', { nullable: false, identity: '1,1' }),
      column('name', 'varchar(20)', { default: "('y')", defaultName: 'DF__users__name__1A2B' }),
    ],
    [constraint('PK__users__3213', 'primary', 'PRIMARY KEY CLUSTERED ([id] ASC)', ['id'])],
  ),
])

test('SQL Server deploy script drops and adds the default constraint, with GO', () => {
  assertEquals(
    deploy('mssql', mssqlSource, mssqlTarget).script,
    `-- Deploy dbo → dbo (Colwerk)
begin transaction
GO
alter table [dbo].[users] drop constraint [DF__users__name__1A2B]
GO
alter table [dbo].[users] alter column [name] varchar(50) not null
GO
alter table [dbo].[users] add constraint [DF_users_name] default ('x') for [name]
GO
commit
GO
`,
  )
})

test('equal schemas have no differences', () => {
  const { objects, script } = deploy('postgres', pgSource, pgSource)
  assertEquals(
    objects.map((o) => o.status),
    ['same', 'same', 'same', 'same'],
  )
  assertEquals(script, '-- Deploy tgt → tgt (Colwerk)\n-- No differences\n')
})

test('replaceSchema rewrites qualifiers in every quoting style', () => {
  assertEquals(replaceSchema('REFERENCES src.t (id)', 'src', 'dst', 'postgres'), 'REFERENCES dst.t (id)')
  assertEquals(replaceSchema('ON "src".t USING btree', 'src', 'dst', 'postgres'), 'ON "dst".t USING btree')
  assertEquals(replaceSchema('REFERENCES `src`.`t`', 'src', 'dst', 'mysql'), 'REFERENCES `dst`.`t`')
  assertEquals(replaceSchema('on [SRC].[t]', 'src', 'dst', 'mssql'), 'on [dst].[t]')
  // PostgreSQL is case-sensitive, MySQL and SQL Server are not; other names and columns stay.
  assertEquals(replaceSchema('SRC.t, src.t', 'src', 'dst', 'postgres'), 'SRC.t, dst.t')
  assertEquals(
    replaceSchema('select src.t.id, mysrc.t, x.src.t', 'src', 'dst', 'mysql'),
    'select dst.t.id, mysrc.t, x.src.t',
  )
  // A name that needs quoting is quoted.
  assertEquals(replaceSchema('src.t', 'src', 'my schema', 'postgres'), '"my schema".t')
})
