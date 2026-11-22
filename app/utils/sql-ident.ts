import type { SplitDialect } from './sql-split.ts'

/** Quotes an identifier the way the dialect does, doubling the closing character. */
export function quoteIdent(dialect: SplitDialect, name: string): string {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`
  return `"${name.replaceAll('"', '""')}"`
}

/** The identifier as written in SQL: plain where that means the same name, otherwise quoted. */
export function identifier(dialect: SplitDialect, name: string): string {
  // Postgres and DuckDB fold unquoted names to lower case.
  const plain = dialect === 'postgres' || dialect === 'duckdb' ? /^[a-z_][a-z0-9_$]*$/ : /^[A-Za-z_][A-Za-z0-9_$]*$/
  return plain.test(name) ? name : quoteIdent(dialect, name)
}
