import { literalEnd, type SplitDialect } from '../../core/sql-split.ts'

// Query variables `${name}`, replaced by text the user enters before a query runs.
// Why this syntax: `:name` collides with `::` casts (Postgres, ClickHouse, DuckDB), `:=` (MySQL, DuckDB), slices and
// struct literals. `${` cannot start a Postgres dollar quote (tag characters exclude `{`) and is not ClickHouse's
// `{name:Type}`; `$1` and `$name` (Postgres/DuckDB parameters) stay untouched because the brace is required.

export interface VariableUse {
  name: string
  /** Offsets of the whole `${name}` in the SQL. */
  from: number
  to: number
}

const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Variables in code and inside single-quoted strings (so `'${day}'` works), not in comments, quoted identifiers or
 * dollar-quoted bodies, which the SQL splitter's literal detection skips.
 */
export function findVariables(sql: string, dialect: SplitDialect): VariableUse[] {
  const uses: VariableUse[] = []
  const scan = (from: number, to: number) => {
    for (const m of sql.slice(from, to).matchAll(VARIABLE))
      uses.push({ name: m[1]!, from: from + m.index, to: from + m.index + m[0].length })
  }
  let i = 0
  let code = 0
  while (i < sql.length) {
    const end = literalEnd(sql, dialect, i)
    if (end === undefined) {
      i++
      continue
    }
    scan(code, i)
    if (sql[i] === "'") scan(i, end)
    code = i = end
  }
  scan(code, sql.length)
  return uses
}

/** The distinct names in order of first use. */
export const variableNames = (uses: VariableUse[]) => [...new Set(uses.map((u) => u.name))]

/** `sql` with every use replaced by its value, as plain text. */
export function substituteVariables(sql: string, uses: VariableUse[], values: Record<string, string>): string {
  let out = ''
  let at = 0
  for (const u of uses) {
    out += sql.slice(at, u.from) + (values[u.name] ?? '')
    at = u.to
  }
  return out + sql.slice(at)
}

/** Maps an offset in the substituted SQL back to `sql`; inside a substituted value it is the start of the `${…}`. */
export function originalOffset(uses: VariableUse[], values: Record<string, string>, position: number): number {
  let shift = 0
  for (const u of uses) {
    const start = u.from + shift
    const end = start + (values[u.name] ?? '').length
    if (position < start) break
    if (position < end) return u.from
    shift += end - start - (u.to - u.from)
  }
  return position - shift
}
