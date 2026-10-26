import { format, type SqlLanguage } from 'sql-formatter'
import { maskLiterals, type SplitDialect } from './sql-split.ts'

const LANGUAGES: Record<SplitDialect, SqlLanguage> = { postgres: 'postgresql', duckdb: 'duckdb', mysql: 'mysql', mssql: 'transactsql' }
const INDENT = '    '
const JOIN = /^\s*(?:(?:natural|cross|inner|left|right|full|outer)\s+)*join\b/i

/**
 * Formats SQL like the former sqlfluff setup: 4-space indent, joins indented below `from`,
 * `on` on its own line with its conditions at the same level, leading commas touching the
 * next item, no trailing comma before a clause, and `!=` instead of `<>`.
 * sql-formatter does the layout; the rest is applied to its output outside of strings and comments.
 */
export function formatSql(sql: string, dialect: SplitDialect): string {
  let out = format(sql, {
    language: LANGUAGES[dialect],
    tabWidth: INDENT.length,
    keywordCase: 'preserve',
    logicalOperatorNewline: 'before',
    // Parenthesized expressions up to max_line_length stay on one line.
    expressionWidth: 200,
    linesBetweenQueries: 1,
  })
  const masked = maskLiterals(out, dialect)
  out = out.replace(/<>/g, (match, offset: number) => masked.slice(offset, offset + 2) === '<>' ? '!=' : match)
  out = onOwnLine(out, dialect)
  return leadingCommas(out, dialect)
}

const indentOf = (line: string) => /^\s*/.exec(line)![0].length

/** `join t on a = b` → `join t` / `    on a = b`, continuation lines of the condition move along. */
function onOwnLine(sql: string, dialect: SplitDialect): string {
  const lines = sql.split('\n')
  // Same positions as `lines`, with strings and comments blanked (see maskLiterals); kept in sync below.
  const masked = maskLiterals(sql, dialect).split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!JOIN.test(masked[i]!)) continue
    const indent = indentOf(lines[i]!)
    // A joined subquery ends on the line starting with `)` at the join's indent: `) s on …`.
    let j = i
    if (/\(\s*$/.test(masked[i]!)) {
      do j++
      while (j < lines.length && !(indentOf(lines[j]!) === indent && masked[j]!.trimStart().startsWith(')')))
      if (j === lines.length) continue
    }
    let depth = 0
    let at = -1
    for (const m of masked[j]!.matchAll(/[()]|\bon\b/gi)) {
      if (m[0] === '(') depth++
      else if (m[0] === ')') depth--
      else if (depth <= 0) {
        at = m.index
        break
      }
    }
    if (at === -1) continue
    const pad = ' '.repeat(indent) + INDENT
    for (const arr of [lines, masked]) arr.splice(j, 1, arr[j]!.slice(0, at).trimEnd(), pad + arr[j]!.slice(at))
    // Continuation: deeper lines, and `and`/`or`/`)` lines at the join's level.
    // Joins nested in a joined subquery (before `j`) are handled as the loop goes on.
    for (let k = j + 2; k < lines.length; k++) {
      const code = masked[k]!
      const level = indentOf(lines[k]!)
      if (!code.trim() || !(level > indent || (level === indent && /^\s*(?:and\b|or\b|\))/i.test(code)))) break
      lines[k] = INDENT + lines[k]
      masked[k] = INDENT + code
    }
  }
  return lines.join('\n')
}

/** `a,` / `b` → `a` / `,b`; a comma before a less indented line (`select a, from`) is dropped. */
function leadingCommas(sql: string, dialect: SplitDialect): string {
  const lines = sql.split('\n')
  const masked = maskLiterals(sql, dialect).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const code = masked[i]!.trimEnd()
    if (!code.endsWith(',')) continue
    let k = i + 1
    while (k < lines.length && !masked[k]!.trim()) k++
    const comma = code.length - 1
    lines[i] = (lines[i]!.slice(0, comma) + lines[i]!.slice(comma + 1)).trimEnd()
    if (k === lines.length || indentOf(lines[k]!) < indentOf(lines[i]!)) continue
    const at = indentOf(lines[k]!)
    lines[k] = lines[k]!.slice(0, at) + ',' + lines[k]!.slice(at)
    masked[k] = masked[k]!.slice(0, at) + ',' + masked[k]!.slice(at)
  }
  return lines.join('\n')
}
