// Round trip: rows of a table are exported as INSERT statements, run into an identical table and compared.
import { test } from 'bun:test'
import { createExporter } from '../core/export/index.ts'
import { loadDriver } from '../core/registry.ts'
import { sqlDialect } from '../core/types.ts'
import type { ConnectionConfig, Session } from '../core/types.ts'
import { assertEquals } from './assert.ts'
import { reachable, testConnections } from './helpers.ts'

interface Case {
  config: ConnectionConfig
  /** Types of: integer, decimal(12,2), text, boolean, timestamp, binary (empty: no such column). */
  types: [string, string, string, string, string, string]
  /** Values of the two rows as SQL (the second row is all NULL except the id). */
  values: string[]
}

const std = (flag: string, bin: string): Case['values'] => [
  `(1, 12.50, 'it''s a \\ test', ${flag}, '2024-01-02 03:04:05', ${bin})`,
  '(2, NULL, NULL, NULL, NULL, NULL)',
]

const cases: Case[] = [
  {
    config: { id: 'duck-ins', name: 'duck', dialect: 'duckdb', file: ':memory:' },
    types: ['integer', 'decimal(12,2)', 'varchar', 'boolean', 'timestamp', 'blob'],
    values: std('true', `'\\xDE\\xAD'::blob`),
  },
  {
    config: { id: 'sqlite-ins', name: 'sqlite', dialect: 'sqlite', file: ':memory:' },
    types: ['integer', 'decimal(12,2)', 'text', 'boolean', 'timestamp', 'blob'],
    values: std('1', `x'dead'`),
  },
  {
    config: testConnections.postgres,
    types: ['integer', 'numeric(12,2)', 'text', 'boolean', 'timestamp', 'bytea'],
    values: std('true', `'\\xdead'::bytea`),
  },
  {
    config: testConnections.mysql,
    types: ['int', 'decimal(12,2)', 'text', 'boolean', 'datetime', 'blob'],
    values: std('true', `x'dead'`),
  },
  {
    config: testConnections.mssql,
    types: ['int', 'decimal(12,2)', 'nvarchar(100)', 'bit', 'datetime2', 'varbinary(16)'],
    values: std('1', '0xdead'),
  },
  {
    config: testConnections.clickhouse,
    types: ['Int32', 'Nullable(Decimal(12,2))', 'Nullable(String)', 'Nullable(Bool)', 'Nullable(DateTime64(6))', ''],
    values: [`(1, 12.50, 'it\\'s a \\\\ test', true, '2024-01-02 03:04:05')`, '(2, NULL, NULL, NULL, NULL)'],
  },
]

for (const c of cases) {
  const { dialect } = c.config
  const ignore = c.config.host ? !(await reachable(c.config)) : false

  test.skipIf(ignore)(`${dialect}: exported INSERT statements restore the rows`, async () => {
    const session: Session = await (await loadDriver(dialect)).connect(c.config)
    const run = (sql: string) => session.execute(sql, { rowLimit: 100 })
    const names = ['id', 'dec', 'txt', 'flag', 'ts', 'bin']
    const columns = names.flatMap((n, i) => (c.types[i] ? [`${n} ${c.types[i]}`] : []))
    const create = (table: string) =>
      `create table ${table} (${columns.join(', ')}${dialect === 'clickhouse' ? ') engine = Memory' : ')'}`
    try {
      for (const table of ['colwerk_ins_src', 'colwerk_ins_dst']) {
        await run(`drop table if exists ${table}`)
        await run(create(table))
      }
      await run(`insert into colwerk_ins_src values ${c.values.join(', ')}`)
      const source = (await run('select * from colwerk_ins_src order by id')).resultSets[0]!
      let script = ''
      const exporter = createExporter('insert', async (chunk) => void (script += new TextDecoder().decode(chunk)), {
        dialect: sqlDialect(dialect),
        table: ['colwerk_ins_dst'],
        batchSize: 1,
      })
      exporter.columns(source.columns)
      await exporter.rows(source.rows)
      await exporter.finish()
      assertEquals(script.match(/^insert/gm)?.length, 2)
      // The driver runs one statement per call (or a whole batch, depending on the dialect).
      for (const statement of script.split(/;\n\n/).filter((s) => s.trim())) await run(statement)
      assertEquals((await run('select * from colwerk_ins_dst order by id')).resultSets[0]!.rows, source.rows)
    } finally {
      for (const table of ['colwerk_ins_src', 'colwerk_ins_dst'])
        await run(`drop table if exists ${table}`).catch(() => {})
      await session.close()
    }
  })
}
