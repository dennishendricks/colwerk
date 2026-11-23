import { format, type SqlLanguage } from 'sql-formatter'
import { defaultSqlFormatOptions, type SqlFormatOptions } from '../../core/settings.ts'
import { maskLiterals, type SplitDialect } from './sql-split.ts'

const LANGUAGES: Record<SplitDialect, SqlLanguage> = {
  postgres: 'postgresql',
  duckdb: 'duckdb',
  mysql: 'mysql',
  mssql: 'transactsql',
  sqlite: 'sqlite',
  clickhouse: 'clickhouse',
}
const JOIN = /^\s*(?:(?:natural|cross|inner|left|right|full|outer)\s+)*join\b/i
const WITH = /^\s*with(?:\s+recursive)?\s*$/i
const SET_OPERATOR = /^\s*(?:union|intersect|except)(?:\s+(?:all|distinct))?\s*$/i

const INDENTS: Record<SqlFormatOptions['indent'], string> = { spaces4: '    ', spaces2: '  ', tab: '\t' }

/**
 * Formats SQL like the former sqlfluff setup (the defaults): 4-space indent, joins indented below `from`,
 * `on` on its own line with its conditions at the same level, leading commas touching the
 * next item, no trailing comma before a clause, and `!=` instead of `<>`.
 * sql-formatter does the layout; the rest is applied to its output outside of strings and comments.
 */
export function formatSql(sql: string, dialect: SplitDialect, options = defaultSqlFormatOptions): string {
  const indent = INDENTS[options.indent]
  let out = format(sql, {
    language: LANGUAGES[dialect],
    tabWidth: options.indent === 'spaces2' ? 2 : 4,
    useTabs: options.indent === 'tab',
    keywordCase: options.keywordCase,
    functionCase: options.functionCase,
    dataTypeCase: options.dataTypeCase,
    identifierCase: options.identifierCase,
    logicalOperatorNewline: options.logicalOperatorNewline,
    expressionWidth: options.expressionWidth,
    linesBetweenQueries: 1,
  })
  if (options.bangNotEqual) {
    const masked = maskLiterals(out, dialect)
    out = out.replace(/<>/g, (match, offset: number) => (masked.slice(offset, offset + 2) === '<>' ? '!=' : match))
  }
  out = onOwnLine(out, dialect, indent)
  out = ctes(out, dialect, indent)
  out = setOperators(out, dialect)
  return commas(out, dialect, options.commas === 'leading')
}

const indentOf = (line: string) => /^\s*/.exec(line)![0].length

/** `join t on a = b` → `join t` / `    on a = b`, continuation lines of the condition move along. */
function onOwnLine(sql: string, dialect: SplitDialect, step: string): string {
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
    const pad = lines[i]!.slice(0, indent) + step
    for (const arr of [lines, masked]) arr.splice(j, 1, arr[j]!.slice(0, at).trimEnd(), pad + arr[j]!.slice(at))
    // Continuation: deeper lines, and at the join's level lines starting with `and`/`or`/`)` or following one
    // that ends with `and`/`or` (logicalOperatorNewline `after`).
    // Joins nested in a joined subquery (before `j`) are handled as the loop goes on.
    for (let k = j + 2; k < lines.length; k++) {
      const code = masked[k]!
      const level = indentOf(lines[k]!)
      const joined = /^\s*(?:and\b|or\b|\))/i.test(code) || /\b(?:and|or)\s*$/i.test(masked[k - 1]!)
      if (!code.trim() || !(level > indent || (level === indent && joined))) break
      lines[k] = step + lines[k]
      masked[k] = step + code
    }
  }
  return lines.join('\n')
}

/** `with` / `    a as (` → `with a as (`, the CTEs at the level of `with` and a blank line after each one. */
function ctes(sql: string, dialect: SplitDialect, step: string): string {
  const lines = sql.split('\n')
  let masked = maskLiterals(sql, dialect).split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!WITH.test(lines[i]!) || !WITH.test(masked[i]!)) continue
    const indent = indentOf(lines[i]!)
    // The CTEs are the deeper lines up to the main statement.
    let end = i + 1
    while (end < lines.length && (!masked[end]!.trim() || indentOf(lines[end]!) > indent)) end++
    if (end === i + 1) continue
    const block = lines.slice(i + 1, end).flatMap((line, k) => {
      const out = line.startsWith(step) ? line.slice(step.length) : line
      return indentOf(out) === indent && masked[i + 1 + k]!.trimStart().startsWith(')') ? [out, ''] : [out]
    })
    lines.splice(i, end - i, lines[i]!.trimEnd() + ' ' + block.shift()!.trimStart(), ...block)
    // Nested `with`s are handled as the loop goes on, on the moved lines.
    masked = maskLiterals(lines.join('\n'), dialect).split('\n')
  }
  return lines.join('\n')
}

/** A blank line before and after `union [all]`, `intersect` and `except`. */
function setOperators(sql: string, dialect: SplitDialect): string {
  const masked = maskLiterals(sql, dialect).split('\n')
  return sql
    .split('\n')
    .flatMap((line, i) => (SET_OPERATOR.test(masked[i]!) ? ['', line, ''] : [line]))
    .join('\n')
}

/**
 * A comma before a less indented line (`select a, from`) is dropped; with `leading`, the others
 * move to the next item: `a,` / `b` → `a` / `,b`.
 */
function commas(sql: string, dialect: SplitDialect, leading: boolean): string {
  const lines = sql.split('\n')
  const masked = maskLiterals(sql, dialect).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const code = masked[i]!.trimEnd()
    if (!code.endsWith(',')) continue
    let k = i + 1
    while (k < lines.length && !masked[k]!.trim()) k++
    const dangling = k === lines.length || indentOf(lines[k]!) < indentOf(lines[i]!)
    if (!leading && !dangling) continue
    const comma = code.length - 1
    lines[i] = (lines[i]!.slice(0, comma) + lines[i]!.slice(comma + 1)).trimEnd()
    if (dangling) continue
    const at = indentOf(lines[k]!)
    lines[k] = lines[k]!.slice(0, at) + ',' + lines[k]!.slice(at)
    masked[k] = masked[k]!.slice(0, at) + ',' + masked[k]!.slice(at)
  }
  return lines.join('\n')
}
