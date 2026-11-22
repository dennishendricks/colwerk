// Schema and data compare against the containers of docker-compose.yml (each skipped when not reachable): differing
// schemas are compared, the deploy script is applied to the target, and a second compare finds no differences.
import { test } from 'bun:test'
import { compareData, compareSchemas } from '../core/compare/index.ts'
import type { ConnectionConfig } from '../core/types.ts'
import { Workbench } from '../core/workbench.ts'
import { assert, assertEquals } from './assert.ts'
import { reachable, testConnections } from './helpers.ts'

interface Case {
  config: ConnectionConfig
  dialect: 'postgres' | 'mysql' | 'mssql'
  /** Statements that create the objects of `schema`; `differ` makes the target differ from the source. */
  setup: (schema: string, differ: boolean) => string[]
  cleanup: (schema: string) => string[]
}

const cases: Case[] = [
  {
    config: testConnections.postgres,
    dialect: 'postgres',
    setup: (s, differ) => [
      `create schema ${s}`,
      differ
        ? `create table ${s}.parent (id serial primary key, name varchar(20), flag boolean)`
        : `create table ${s}.parent (id serial primary key, name varchar(50) not null, extra text)`,
      differ
        ? `create table ${s}.child (id integer generated always as identity primary key, parent_id integer not null, amount numeric(10,2) default 1, note text)`
        : `create table ${s}.child (id integer generated always as identity primary key,
             parent_id integer not null references ${s}.parent (id) on delete cascade,
             amount numeric(10,2) default 0, note text, constraint child_amount check (amount >= 0))`,
      ...(differ
        ? [`create table ${s}.only_tgt (id integer primary key)`, `create view ${s}.v as select id from ${s}.parent`]
        : [
            `create unique index child_note on ${s}.child (note)`,
            `create index child_parent on ${s}.child (parent_id)`,
            `create table ${s}.only_src (id integer primary key)`,
            `create view ${s}.v as select id, name from ${s}.parent`,
          ]),
    ],
    cleanup: (s) => [`drop schema if exists ${s} cascade`],
  },
  {
    config: { ...testConnections.mysql, id: 'my-root', user: 'root' },
    dialect: 'mysql',
    setup: (s, differ) => [
      `create database ${s}`,
      differ
        ? `create table ${s}.parent (id int auto_increment primary key, name varchar(20) null, flag tinyint(1) null)`
        : `create table ${s}.parent (id int auto_increment primary key, name varchar(50) not null, extra text)`,
      differ
        ? `create table ${s}.child (id int auto_increment primary key, parent_id int not null, amount decimal(10,2) default 1, note varchar(50))`
        : `create table ${s}.child (id int auto_increment primary key, parent_id int not null, amount decimal(10,2) default 0,
             note varchar(50), constraint child_parent_fk foreign key (parent_id) references ${s}.parent (id) on delete cascade,
             constraint child_amount check (amount >= 0), unique key child_note (note), key child_parent (parent_id))`,
      ...(differ
        ? [`create table ${s}.only_tgt (id int primary key)`, `create view ${s}.v as select id from ${s}.parent`]
        : [
            `create table ${s}.only_src (id int primary key)`,
            `create view ${s}.v as select id, name from ${s}.parent`,
          ]),
    ],
    cleanup: (s) => [`drop database if exists ${s}`],
  },
  {
    config: testConnections.mssql,
    dialect: 'mssql',
    setup: (s, differ) => [
      `exec('create schema ${s}')`,
      differ
        ? `create table ${s}.parent (id int identity(1,1) primary key, name varchar(20) null, flag bit null)`
        : `create table ${s}.parent (id int identity(1,1) primary key, name varchar(50) not null, extra varchar(max) null)`,
      differ
        ? `create table ${s}.child (id int identity(1,1) primary key, parent_id int not null, amount decimal(10,2) not null default 1, note varchar(50) null)`
        : `create table ${s}.child (id int identity(1,1) primary key, parent_id int not null, amount decimal(10,2) not null default 0,
             note varchar(50) null, constraint child_parent_fk foreign key (parent_id) references ${s}.parent (id) on delete cascade,
             constraint child_amount check (amount >= 0))`,
      ...(differ
        ? [`create table ${s}.only_tgt (id int primary key)`, `create view ${s}.v as select id from ${s}.parent`]
        : [
            `create unique index child_note on ${s}.child (note)`,
            `create index child_parent on ${s}.child (parent_id)`,
            `create table ${s}.only_src (id int primary key)`,
            `create view ${s}.v as select id, name from ${s}.parent`,
          ]),
    ],
    cleanup: (s) => [
      `drop view if exists ${s}.v`,
      ...['child', 'parent', 'tags', 'only_src', 'only_tgt'].map((t) => `drop table if exists ${s}.${t}`),
      `drop schema if exists ${s}`,
    ],
  },
]

for (const c of cases) {
  test.skipIf(!(await reachable(c.config)))(`${c.dialect}: schema compare, deploy and data compare`, async () => {
    const wb = new Workbench(async () => c.config)
    const id = c.config.id
    // Each statement on its own: CREATE VIEW must start a batch on SQL Server.
    const run = (sql: string) => wb.execute('setup', id, sql, 10, 60)
    const clean = async () => {
      for (const s of ['cmp_src', 'cmp_tgt']) for (const sql of c.cleanup(s)) await run(sql)
    }
    const ref = (schema: string) => ({ connectionId: id, schema })
    const apply = async (script: string) => void (await run(script))
    try {
      await clean()
      for (const sql of c.setup('cmp_src', false)) await run(sql)
      for (const sql of c.setup('cmp_tgt', true)) await run(sql)

      const result = await compareSchemas(wb, c.dialect, ref('cmp_src'), ref('cmp_tgt'))
      const status = Object.fromEntries(result.objects.map((o) => [`${o.kind}:${o.name}`, o.status]))
      assertEquals(status, {
        'table:parent': 'changed',
        'table:child': 'changed',
        'table:only_src': 'added',
        'table:only_tgt': 'removed',
        'view:v': 'changed',
      })
      assert(result.script.includes('only_tgt'), result.script)
      await apply(result.script)

      const again = await compareSchemas(wb, c.dialect, ref('cmp_src'), ref('cmp_tgt'))
      assertEquals(
        again.objects.filter((o) => o.status !== 'same').map((o) => [o.name, o.parts]),
        [],
        again.script,
      )
      assert(again.script.includes('No differences'), again.script)

      // Data: the tables have equal structure now.
      await run(`insert into cmp_src.parent (name) values ('a'), ('b'), ('c'), ('d''e')`)
      await run(`insert into cmp_tgt.parent (name) values ('a'), ('b'), ('x'), ('y'), ('z')`)
      await run(`delete from cmp_tgt.parent where id = 2`)
      const data = await compareData(
        wb,
        c.dialect,
        {
          id: 'cmp-db',
          source: { ...ref('cmp_src'), table: 'parent' },
          target: { ...ref('cmp_tgt'), table: 'parent' },
        },
        new AbortController().signal,
      )
      assertEquals(data.counts, { same: 1, onlyInSource: 1, onlyInTarget: 1, different: 2 })
      await apply(data.script!)
      const after = await compareData(
        wb,
        c.dialect,
        {
          id: 'cmp-db',
          source: { ...ref('cmp_src'), table: 'parent' },
          target: { ...ref('cmp_tgt'), table: 'parent' },
        },
        new AbortController().signal,
      )
      assertEquals(after.counts, { same: 4, onlyInSource: 0, onlyInTarget: 0, different: 0 })

      // Text keys: the databases must order them like the merge does (binary, by code point).
      for (const s of ['cmp_src', 'cmp_tgt']) {
        await run(`create table ${s}.tags (code varchar(20) primary key, label varchar(20))`)
      }
      await run(
        `insert into cmp_src.tags values ('a', '1'), ('B', '2'), ('_x', '3'), ('10', '4'), ('9', '5'), ('é', '6')`,
      )
      await run(`insert into cmp_tgt.tags values ('a', '1'), ('Z', '9'), ('9', '5')`)
      const tags = {
        id: 'cmp-db',
        source: { ...ref('cmp_src'), table: 'tags' },
        target: { ...ref('cmp_tgt'), table: 'tags' },
      }
      const text = await compareData(wb, c.dialect, tags, new AbortController().signal)
      assertEquals(text.counts, { same: 2, onlyInSource: 4, onlyInTarget: 1, different: 0 })
      await apply(text.script!)
      assertEquals((await compareData(wb, c.dialect, tags, new AbortController().signal)).counts.same, 6)
    } finally {
      await clean().catch(() => {})
      await wb.closeAll()
    }
  })
}
