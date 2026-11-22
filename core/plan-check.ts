import type { SplitDialect } from './sql-split.ts'
import type { CellValue, ResultSet } from './types.ts'

/** Default `scanRowThreshold`. */
export const DEFAULT_SCAN_ROWS = 1_000_000
/** Engines whose plans are checked; embedded and columnar engines scan as their normal access path. */
export const planCheckDialects: SplitDialect[] = ['postgres', 'mysql', 'mssql', 'clickhouse']

/** A table the plan reads completely; `rows` when the plan itself estimates them (otherwise from the table statistics). */
export interface Scan {
  schema?: string
  table: string
  rows?: number
}

export interface PlanWarning {
  statement: string
  table: string
  rows: number
}

// The pg driver already parses `json`; other drivers return the text.
const parse = (plan: CellValue): unknown => (typeof plan === 'string' ? JSON.parse(plan) : plan)

// Every object in the tree, depth first.
function* objects(node: unknown): Generator<Record<string, unknown>> {
  if (node === null || typeof node !== 'object') return
  if (!Array.isArray(node)) yield node as Record<string, unknown>
  for (const child of Object.values(node)) yield* objects(child)
}

export function postgresScans(plan: CellValue): Scan[] {
  return [...objects(parse(plan))]
    .filter((n) => n['Node Type'] === 'Seq Scan')
    .map((n) => ({ schema: n.Schema as string | undefined, table: n['Relation Name'] as string }))
}

export function mysqlScans(plan: CellValue): Scan[] {
  return [...objects(parse(plan))]
    .filter((n) => (n.access_type === 'ALL' || n.access_type === 'table') && typeof n.table_name === 'string')
    .map((n) => {
      const rows = Number(n.rows_examined_per_scan ?? n.rows ?? n.estimated_rows)
      return { table: n.table_name as string, rows: Number.isFinite(rows) ? rows : undefined }
    })
}

const column = (set: ResultSet, name: string) => set.columns.findIndex((c) => c.name === name)

/** Columns are looked up by name: PhysicalOp, Argument. */
export function mssqlScans(set: ResultSet): Scan[] {
  const [op, argument] = [column(set, 'PhysicalOp'), column(set, 'Argument')]
  if (op < 0 || argument < 0) return []
  return set.rows.flatMap((r) => {
    if (!['Table Scan', 'Clustered Index Scan', 'Index Scan'].includes(String(r[op]))) return []
    // `OBJECT:([database].[schema].[table].[index] AS [alias])`
    const object = /OBJECT:\(((?:\[[^\]]*\]\.?)+)/.exec(String(r[argument]))?.[1]
    const names = [...(object?.matchAll(/\[([^\]]*)\]/g) ?? [])].map((m) => m[1]!)
    return names.length >= 3 ? [{ schema: names[1], table: names[2]! }] : []
  })
}

/** Columns database, table, rows (rows may be a string). */
export function clickhouseScans(set: ResultSet): Scan[] {
  const [database, table, rows] = [column(set, 'database'), column(set, 'table'), column(set, 'rows')]
  if (database < 0 || table < 0 || rows < 0) return []
  return set.rows.map((r) => ({ schema: String(r[database]), table: String(r[table]), rows: Number(r[rows]) }))
}
