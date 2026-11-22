import type { SplitDialect } from '../sql-split.ts'
import { AppError, type Session } from '../types.ts'

export function quoteIdent(dialect: SplitDialect, name: string): string {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`
  return `"${name.replaceAll('"', '""')}"`
}

export const qualified = (dialect: SplitDialect, schema: string, name: string) =>
  `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, name)}`

/** String literal; MySQL assumes NO_BACKSLASH_ESCAPES is off (the default). */
export function stringLiteral(dialect: SplitDialect, s: string): string {
  const quoted = `'${(dialect === 'mysql' ? s.replaceAll('\\', '\\\\') : s).replaceAll("'", "''")}'`
  return dialect === 'mssql' ? `N${quoted}` : quoted
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Rewrites the qualifiers `from.`, `"from".`, `` `from`. `` and `[from].` to `to`, in the quoting the text used.
 * Names match case-insensitively except in PostgreSQL.
 */
export function replaceSchema(text: string, from: string, to: string, dialect: SplitDialect): string {
  const name = escapeRegExp(from)
  const pattern = new RegExp(
    `(?<![\\w$."\`\\]])(?:${name}|"${escapeRegExp(from.replaceAll('"', '""'))}"|\`${name}\`|\\[${name}\\])\\.`,
    dialect === 'postgres' ? 'g' : 'gi',
  )
  return text.replace(pattern, (match) => `${/^\w/.test(match) && /^\w+$/.test(to) ? to : quoteIdent(dialect, to)}.`)
}

/** Result of a catalog query as objects. */
export async function query<T = Record<string, unknown>>(session: Session, sql: string): Promise<T[]> {
  const [set] = (await session.execute(sql, { rowLimit: 1_000_000 })).resultSets
  if (!set) return []
  if (set.truncated) throw new AppError('compareTooLarge', 'The catalog has too many entries to compare.')
  return set.rows.map((row) => Object.fromEntries(set.columns.map((c, i) => [c.name, row[i]]))) as T[]
}

/** Whitespace collapsed and a trailing semicolon removed, for comparing definitions. */
export const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '')

/** Truthy values of catalog columns: booleans arrive as true or 1 depending on the driver. */
export const flag = (v: unknown) => v === true || v === 1 || v === '1' || v === 't'

/** `create view <name>` of a SQL Server view definition (also `create or alter`), with the possibly qualified name. */
export const MSSQL_VIEW_HEAD =
  /^\s*create\s+(?:or\s+alter\s+)?view\s+(?:(?:\[[^\]]+\]|\w+)\s*\.\s*)?(?:\[[^\]]+\]|\w+)/i
