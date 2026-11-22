import { maskLiterals, type SplitDialect, splitStatements } from './sql-split.ts'
import type { Dialect } from './types.ts'

export type DmlKind = 'insert' | 'update' | 'delete' | 'merge'

/** Engines whose DML a dry run can roll back reliably (not ClickHouse, not the catalogs behind lakehouses). */
export const dryRunDialects: Dialect[] = ['postgres', 'mysql', 'mssql', 'duckdb', 'sqlite']

const MAIN = ['select', 'insert', 'update', 'delete', 'merge']

/** Kind of exactly one data-modifying statement (also behind a WITH); undefined for anything else, also scripts. */
export function dmlKind(sql: string, dialect: SplitDialect): DmlKind | undefined {
  const ranges = splitStatements(sql, dialect)
  if (ranges.length !== 1) return undefined
  const code = maskLiterals(sql.slice(ranges[0]!.from, ranges[0]!.to), dialect).toLowerCase()
  let depth = 0
  const words: string[] = []
  for (const [token] of code.matchAll(/[()]|[a-z_][a-z0-9_$]*/g)) {
    if (token === '(') depth++
    else if (token === ')') depth--
    else if (depth === 0) words.push(token)
  }
  const kind = words[0] === 'with' ? words.slice(1).find((w) => MAIN.includes(w)) : words[0]
  return kind === 'insert' || kind === 'update' || kind === 'delete' || kind === 'merge' ? kind : undefined
}
