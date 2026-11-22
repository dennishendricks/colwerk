import { quoteIdent } from '../../core/sql-literals.ts'
import type { SplitDialect } from './sql-split.ts'

// The quoting lives in core (generated statements need it too); re-exported for the app's auto-imports.
export { quoteIdent }

/** The identifier as written in SQL: plain where that means the same name, otherwise quoted. */
export function identifier(dialect: SplitDialect, name: string): string {
  // Postgres and DuckDB fold unquoted names to lower case.
  const plain = dialect === 'postgres' || dialect === 'duckdb' ? /^[a-z_][a-z0-9_$]*$/ : /^[A-Za-z_][A-Za-z0-9_$]*$/
  return plain.test(name) ? name : quoteIdent(dialect, name)
}
