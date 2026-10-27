export type SplitDialect = 'postgres' | 'mysql' | 'mssql' | 'duckdb'

export interface StatementRange {
  from: number
  to: number
}

export interface SplitOptions {
  /** Split at `;` (default). Off for mssql batches, which only end at `GO`. */
  semicolons?: boolean
  /** Also split at blank lines (statement under the cursor in mssql scripts without `;`). */
  blankLines?: boolean
}

/**
 * Splits a script into statement ranges at `;` outside of strings, quoted identifiers and comments.
 * Handles dollar quoting (postgres, duckdb), backslash escapes and backticks (mysql),
 * brackets and `GO` batch separators on their own line (mssql).
 * Ranges are trimmed and exclude the delimiter; empty statements are dropped.
 */
export function splitStatements(sql: string, dialect: SplitDialect, { semicolons = true, blankLines = false }: SplitOptions = {}): StatementRange[] {
  const ranges: StatementRange[] = []
  let start = 0
  let i = 0
  const n = sql.length

  const push = (end: number) => {
    let from = start
    let to = end
    while (from < to && /\s/.test(sql[from]!)) from++
    while (to > from && /\s/.test(sql[to - 1]!)) to--
    if (to > from) ranges.push({ from, to })
  }

  while (i < n) {
    const ch = sql[i]!
    const end = literalEnd(sql, dialect, i)
    if (end !== undefined) {
      i = end
    } else if (ch === ';' && semicolons) {
      push(i)
      start = ++i
    } else if (dialect === 'mssql' && (ch === 'G' || ch === 'g') && isGoLine(sql, i)) {
      push(i)
      const eol = sql.indexOf('\n', i)
      start = i = eol === -1 ? n : eol + 1
    } else if (ch === '\n' && blankLines && !sql.slice(sql.lastIndexOf('\n', i - 1) + 1, i).trim()) {
      push(i)
      start = ++i
    } else {
      i++
    }
  }
  push(n)
  return ranges
}

/**
 * Blanks comments with spaces and strings and quoted identifiers with `_` (keeping line breaks),
 * so that positions match the input and only SQL code is left to search in.
 */
export function maskLiterals(sql: string, dialect: SplitDialect): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const end = literalEnd(sql, dialect, i)
    if (end === undefined) {
      out += sql[i++]
    } else {
      const comment = sql.startsWith('--', i) || sql.startsWith('/*', i) || sql[i] === '#'
      out += sql.slice(i, end).replace(/[^\n]/g, comment ? ' ' : '_')
      i = end
    }
  }
  return out
}

/** End of the string, quoted identifier or comment starting at `i`; undefined if none starts there. */
function literalEnd(sql: string, dialect: SplitDialect, i: number): number | undefined {
  const n = sql.length
  const ch = sql[i]!
  const next = sql[i + 1]

  const quoted = (close: string, backslash: boolean) => {
    let j = i + 1
    while (j < n) {
      if (backslash && sql[j] === '\\') {
        j += 2
        continue
      }
      if (sql[j] === close) {
        if (sql[j + 1] !== close) return j + 1
        j++
      }
      j++
    }
    return n
  }

  if ((ch === '-' && next === '-') || (ch === '#' && dialect === 'mysql')) {
    const eol = sql.indexOf('\n', i)
    return eol === -1 ? n : eol + 1
  }
  if (ch === '/' && next === '*') {
    const end = sql.indexOf('*/', i + 2)
    return end === -1 ? n : end + 2
  }
  if (ch === '\'') return quoted('\'', dialect === 'mysql')
  if (ch === '"') return quoted('"', dialect === 'mysql')
  if (ch === '`' && dialect === 'mysql') return quoted('`', false)
  if (ch === '[' && dialect === 'mssql') return quoted(']', false)
  if (ch === '$' && (dialect === 'postgres' || dialect === 'duckdb')) {
    const tag = /^\$[A-Za-z_]?\w*\$/.exec(sql.slice(i))?.[0]
    if (!tag) return
    const end = sql.indexOf(tag, i + tag.length)
    return end === -1 ? n : end + tag.length
  }
}

function isGoLine(sql: string, i: number): boolean {
  const lineStart = sql.lastIndexOf('\n', i - 1) + 1
  const eol = sql.indexOf('\n', i)
  return /^\s*go\s*$/i.test(sql.slice(lineStart, eol === -1 ? sql.length : eol))
}

/**
 * The statement under the cursor: the range containing it, otherwise the closest one ending
 * before it (cursor after `;` or on a trailing blank line), otherwise the first one after it.
 * In mssql, where `;` is optional, blank lines separate statements as well.
 */
export function statementAt(sql: string, dialect: SplitDialect, cursor: number): StatementRange | undefined {
  const ranges = splitStatements(sql, dialect, { blankLines: dialect === 'mssql' })
  return ranges.find(r => cursor >= r.from && cursor <= r.to)
    ?? ranges.filter(r => r.to <= cursor).at(-1)
    ?? ranges.find(r => r.from >= cursor)
}

/** The statement texts of a script (see `splitStatements`). */
export function statementTexts(sql: string, dialect: SplitDialect, options?: SplitOptions): string[] {
  return splitStatements(sql, dialect, options).map(r => sql.slice(r.from, r.to))
}

/** Offset of the first character of the 1-based `line` (the last line if there are fewer). */
export function lineStart(sql: string, line: number): number {
  let at = 0
  for (let l = 1; l < line; l++) {
    const eol = sql.indexOf('\n', at)
    if (eol === -1) break
    at = eol + 1
  }
  return at
}

const READ_START = /^\(*\s*(select|with|values|table|show|describe|desc|explain|from)\b/
const SELECT_START = /^\(*\s*(select|with)\b/
// Writes (also inside a CTE), `select … into`, `explain analyze` (executes the statement), procedures.
const SIDE_EFFECT = /\b(insert|update|delete|merge|into|analyze|call|exec|execute)\b/

/**
 * True for exactly one statement that only reads, so running it again has no side effects.
 * A heuristic on the SQL text: functions with side effects (e.g. `nextval`) are not detected.
 */
export function isReadOnlyStatement(sql: string, dialect: SplitDialect): boolean {
  return readOnlyCode(sql, dialect, READ_START)
}

/** Like `isReadOnlyStatement`, but only a SELECT or WITH query. */
export function isSelectStatement(sql: string, dialect: SplitDialect): boolean {
  return readOnlyCode(sql, dialect, SELECT_START)
}

function readOnlyCode(sql: string, dialect: SplitDialect, start: RegExp): boolean {
  const ranges = splitStatements(sql, dialect)
  if (ranges.length !== 1) return false
  const code = maskLiterals(sql.slice(ranges[0]!.from, ranges[0]!.to), dialect).trim().toLowerCase()
  return start.test(code) && !SIDE_EFFECT.test(code)
}
