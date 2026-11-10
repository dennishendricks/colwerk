export type SplitDialect = 'postgres' | 'mysql' | 'mssql' | 'duckdb' | 'sqlite' | 'clickhouse'

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
 * Splits a script into statement ranges at `;` outside of strings, quoted identifiers and comments, the way the
 * dialect's own client (psql, mysql, sqlcmd, …) does:
 * - dollar quoting (postgres, duckdb, clickhouse), `E'…'` escape strings (postgres, duckdb), nested block comments
 *   (postgres, duckdb, mssql, clickhouse), and `;` inside parentheses (postgres, duckdb: `create rule … do (…; …)`);
 * - backslash escapes and `#` comments (mysql, clickhouse), `--` comments only before whitespace (mysql);
 * - backticks (mysql, sqlite, clickhouse) and brackets (mssql, sqlite);
 * - `DELIMITER` lines (mysql): the following statements end at the new delimiter; the lines themselves are dropped;
 * - `GO [count]` on its own line (mssql): ends a batch; with `semicolons: false` a batch with a count is repeated;
 * - routine and trigger bodies, which contain `;` themselves: `begin … end` of sqlite triggers, postgres
 *   `begin atomic` and mysql routines, triggers and events, and the whole batch after `create procedure` etc. (mssql).
 * Ranges are trimmed and exclude the delimiter; empty statements are dropped.
 */
export function splitStatements(
  sql: string,
  dialect: SplitDialect,
  { semicolons = true, blankLines = false }: SplitOptions = {},
): StatementRange[] {
  const ranges: StatementRange[] = []
  let start = 0
  let i = 0
  let parens = 0
  let delimiter = ';'
  const n = sql.length
  const countParens = dialect === 'postgres' || dialect === 'duckdb'

  const push = (end: number, times = 1) => {
    let from = start
    let to = end
    while (from < to && /\s/.test(sql[from]!)) from++
    while (to > from && /\s/.test(sql[to - 1]!)) to--
    if (to > from) for (let k = 0; k < times; k++) ranges.push({ from, to })
  }

  // Whether the statement starting at `start` opens a routine or trigger (checked once per statement), and if so,
  // whether its body is still open at `i`.
  let headerAt = -1
  let header = false
  const inBody = () => {
    const routine = ROUTINE[dialect]
    if (!routine) return false
    if (headerAt !== start) {
      headerAt = start
      header = routine.test(
        maskLiterals(sql.slice(start, start + 500), dialect)
          .trimStart()
          .toLowerCase(),
      )
    }
    return header && (dialect === 'mssql' || bodyOpen(maskLiterals(sql.slice(start, i), dialect)))
  }

  while (i < n) {
    const ch = sql[i]!
    const end = literalEnd(sql, dialect, i)
    if (end !== undefined) {
      i = end
    } else if (countParens && (ch === '(' || ch === ')')) {
      parens = Math.max(0, parens + (ch === '(' ? 1 : -1))
      i++
    } else if (semicolons && sql.startsWith(delimiter, i) && !parens && !(delimiter === ';' && inBody())) {
      push(i)
      start = i += delimiter.length
    } else if (dialect === 'mysql' && (ch === 'd' || ch === 'D') && atLineStart(sql, i)) {
      const eol = lineEnd(sql, i)
      const directive = /^delimiter[ \t]+(\S+)/i.exec(sql.slice(i, eol))
      // Only where a statement starts, as in the mysql client.
      if (directive && !maskLiterals(sql.slice(start, i), dialect).trim()) {
        delimiter = directive[1]!
        start = i = Math.min(n, eol + 1)
      } else {
        i++
      }
    } else if (dialect === 'mssql' && (ch === 'G' || ch === 'g') && atLineStart(sql, i)) {
      const eol = lineEnd(sql, i)
      const go = /^go(?:[ \t]+(\d+))?[ \t]*(?:--.*)?$/i.exec(sql.slice(i, eol).trimEnd())
      if (go) {
        push(i, semicolons ? 1 : Math.max(1, Number(go[1] ?? 1)))
        start = i = Math.min(n, eol + 1)
      } else {
        i++
      }
    } else if (ch === '\n' && blankLines && !sql.slice(sql.lastIndexOf('\n', i - 1) + 1, i).trim() && !inBody()) {
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

/**
 * MySQL: the script as the server takes it, with the client's `DELIMITER` lines blanked and the statements ending
 * at `;` again (routine bodies need no other delimiter there). Same length and line breaks as `sql`, so error
 * positions apply to both.
 */
export function mysqlServerScript(sql: string): string {
  if (!/^[ \t]*delimiter[ \t]/im.test(sql)) return sql
  const out = sql.split('')
  const blank = (from: number, to: number, first: string) => {
    for (let i = from; i < to; i++) {
      if (/\s/.test(out[i]!)) continue
      out[i] = first
      first = ' '
    }
  }
  let at = 0
  for (const { from, to } of splitStatements(sql, 'mysql')) {
    blank(at, from, at ? ';' : ' ')
    at = to
  }
  blank(at, sql.length, at ? ';' : ' ')
  return out.join('')
}

const IDENT = /[\p{L}\p{N}_$]/u

/** End of the string, quoted identifier or comment starting at `i`; undefined if none starts there. */
export function literalEnd(sql: string, dialect: SplitDialect, i: number): number | undefined {
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

  const escapes = dialect === 'mysql' || dialect === 'clickhouse'
  const pg = dialect === 'postgres' || dialect === 'duckdb'
  // MySQL only takes `--` as a comment before whitespace or a control character: `1--1` is `1 - -1`.
  const lineComment =
    (ch === '-' && next === '-' && (dialect !== 'mysql' || i + 2 >= n || /[\s\p{Cc}]/u.test(sql[i + 2]!))) ||
    (ch === '#' && escapes)
  if (lineComment) {
    const eol = sql.indexOf('\n', i)
    return eol === -1 ? n : eol + 1
  }
  if (ch === '/' && next === '*') {
    const nested = pg || dialect === 'mssql' || dialect === 'clickhouse'
    let depth = 0
    for (let j = i; j < n; j++) {
      if (sql.startsWith('/*', j) && (nested || !depth)) {
        depth++
        j++
      } else if (sql.startsWith('*/', j)) {
        if (!--depth) return j + 2
        j++
      }
    }
    return n
  }
  // `E'…'`: escape string with backslash escapes (not part of an identifier like `name'…'`, which is invalid anyway).
  if (ch === "'") return quoted("'", escapes || (pg && /[eE]/.test(sql[i - 1] ?? '') && !IDENT.test(sql[i - 2] ?? '')))
  if (ch === '"') return quoted('"', escapes)
  if (ch === '`' && (escapes || dialect === 'sqlite')) return quoted('`', dialect === 'clickhouse')
  if (ch === '[' && (dialect === 'mssql' || dialect === 'sqlite')) return quoted(']', false)
  // A tag does not start with a digit (`$1` is a parameter), and `$` inside an identifier (`a$b`) starts nothing.
  if (ch === '$' && (pg || dialect === 'clickhouse') && !IDENT.test(sql[i - 1] ?? '')) {
    const tag = /^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u.exec(sql.slice(i, i + 256))?.[0]
    if (!tag) return
    const end = sql.indexOf(tag, i + tag.length)
    return end === -1 ? n : end + tag.length
  }
}

/** Statements whose body contains `;` itself (see `bodyOpen`); tested on the masked, lowercased statement start. */
const ROUTINE: Partial<Record<SplitDialect, RegExp>> = {
  sqlite: /^create\s+(temp\s+|temporary\s+)?trigger\b/,
  // `begin atomic … end` (SQL-standard body); bodies in dollar quotes are masked.
  postgres: /^create\s+(or\s+replace\s+)?(function|procedure)\b/,
  mysql: /^create\s+(or\s+replace\s+)?(definer\s*=\s*\S+\s+)?(aggregate\s+)?(procedure|function|trigger|event)\b/,
  // The body runs to the end of the batch (`GO`).
  mssql: /^(create(\s+or\s+alter)?|alter)\s+(proc|procedure|function|trigger|view)\b/,
}

/** `begin` (or `case`) without its `end` in the masked statement text; `end if` etc. close no block (mysql). */
function bodyOpen(code: string): boolean {
  let depth = 0
  for (const [word] of code.toLowerCase().matchAll(/\b(?:begin|case|end(?:\s+(?:if|loop|while|repeat)\b)?)\b/g)) {
    if (word === 'begin' || word === 'case') depth++
    else if (word === 'end') depth--
  }
  return depth > 0
}

/** Only blanks before `i` on its line. */
function atLineStart(sql: string, i: number): boolean {
  return !sql.slice(sql.lastIndexOf('\n', i - 1) + 1, i).trim()
}

function lineEnd(sql: string, i: number): number {
  const eol = sql.indexOf('\n', i)
  return eol === -1 ? sql.length : eol
}

/**
 * The statement under the cursor: the range containing it, otherwise the closest one ending
 * before it (cursor after `;` or on a trailing blank line), otherwise the first one after it.
 * In mssql, where `;` is optional, blank lines separate statements as well.
 */
export function statementAt(sql: string, dialect: SplitDialect, cursor: number): StatementRange | undefined {
  const ranges = splitStatements(sql, dialect, { blankLines: dialect === 'mssql' })
  return (
    ranges.find((r) => cursor >= r.from && cursor <= r.to) ??
    ranges.filter((r) => r.to <= cursor).at(-1) ??
    ranges.find((r) => r.from >= cursor)
  )
}

/** The statement texts of a script (see `splitStatements`). */
export function statementTexts(sql: string, dialect: SplitDialect, options?: SplitOptions): string[] {
  return splitStatements(sql, dialect, options).map((r) => sql.slice(r.from, r.to))
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

// `pivot`, `unpivot` and `summarize` are DuckDB statements; other dialects reject them without running anything.
const READ_START = /^\(*\s*(select|with|values|table|show|describe|desc|explain|from|pivot|unpivot|summarize)\b/
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
  let code = maskLiterals(sql.slice(ranges[0]!.from, ranges[0]!.to), dialect).trim().toLowerCase()
  // DuckDB's `unpivot … into name … value …` only names output columns.
  if (dialect === 'duckdb') code = code.replace(/\binto\s+name\b/g, '')
  // MSSQL's join and query hints (`inner merge join`, `option (merge union)`) only pick an algorithm.
  if (dialect === 'mssql') code = code.replace(/\bmerge\s+(join|union)\b/g, '')
  return start.test(code) && !SIDE_EFFECT.test(code)
}
