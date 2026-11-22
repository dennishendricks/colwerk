// Text checks against unintended writes, on top of the statement splitter.
import {
  isReadOnlyStatement,
  maskLiterals,
  splitStatements,
  type SplitDialect,
  type StatementRange,
} from './sql-split.ts'

// Statements that only change session state or control transactions, as long as they contain no writing keyword.
const SESSION_START =
  /^(set|show|use|begin|start\s+transaction|commit|rollback|end|abort|savepoint|release|declare|print|reset|discard|pragma|fetch|close)\b/
const WRITE_WORD =
  /\b(insert|update|delete|merge|into|call|exec|execute|create|alter|drop|truncate|rename|grant|revoke|copy|attach|detach|load|install|vacuum|optimize|kill|backup|restore|dbcc|bulk|reindex|cluster|refresh|lock)\b/

/**
 * The first statement of a script that may write (anything but reads and session/transaction statements), or
 * undefined. A text heuristic like `isReadOnlyStatement`: on read-only connections the database itself refuses
 * writes where it can.
 */
export function writingStatement(sql: string, dialect: SplitDialect): StatementRange | undefined {
  return splitStatements(sql, dialect).find((r) => {
    const text = sql.slice(r.from, r.to)
    if (isReadOnlyStatement(text, dialect)) return false
    const code = maskLiterals(text, dialect).trim().toLowerCase()
    return !(SESSION_START.test(code) && !WRITE_WORD.test(code))
  })
}

// The keyword after a CTE list that decides what the statement does.
const MAIN = new Set(['select', 'insert', 'update', 'delete', 'merge'])

export type UnfilteredKind = 'update' | 'delete' | 'truncate'

/**
 * UPDATE and DELETE statements that change every row of their table: no top-level WHERE and no top-level JOIN
 * (whose ON condition restricts the rows), and TRUNCATE. On the masked text, per `;`-separated statement (SQL Server
 * statements without `;` in one batch count as one). Writes inside a CTE (`with d as (delete …) select`) are not
 * detected.
 */
export function unfilteredWrites(sql: string, dialect: SplitDialect): (StatementRange & { kind: UnfilteredKind })[] {
  const found: (StatementRange & { kind: UnfilteredKind })[] = []
  for (const r of splitStatements(sql, dialect)) {
    const code = maskLiterals(sql.slice(r.from, r.to), dialect).toLowerCase()
    const words: string[] = []
    let depth = 0
    for (const [token] of code.matchAll(/[()]|[a-z_][a-z0-9_$]*/g)) {
      if (token === '(') depth++
      else if (token === ')') depth--
      else if (depth === 0) words.push(token)
    }
    if (words[0] === 'truncate') {
      found.push({ ...r, kind: 'truncate' })
      continue
    }
    const main = words[0] === 'with' ? words.findIndex((w, i) => i > 0 && MAIN.has(w)) : 0
    const kind = words[main]
    if ((kind === 'update' || kind === 'delete') && !words.slice(main + 1).some((w) => w === 'where' || w === 'join')) {
      found.push({ ...r, kind })
    }
  }
  return found
}
