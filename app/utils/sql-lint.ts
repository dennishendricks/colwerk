import { analyse, columnsOf, findTable, scopeOf, blockAt, visibleName, type SchemaModel } from './sql-scope.ts'
import type { SplitDialect } from './sql-split.ts'

export interface LintOptions {
  /** Unknown tables and columns, ambiguous columns. */
  names: boolean
  /** UPDATE and DELETE without WHERE. */
  writes: boolean
}

export interface SqlDiagnostic {
  from: number
  to: number
  key: 'unknownTable' | 'unknownColumn' | 'ambiguousColumn' | 'missingWhere'
  /** Values for the message. */
  params: Record<string, string>
}

// DuckDB reads files and lakehouse catalogs and ClickHouse has table functions and dynamic schemas: unknown names
// there are no mistakes. Everyone else has the loaded schema as the truth.
const CHECKS_NAMES = new Set<SplitDialect>(['postgres', 'mysql', 'mssql', 'sqlite'])
// Catalog tables that are not listed as tables of a schema.
const SYSTEM_TABLE: Partial<Record<SplitDialect, string>> = { postgres: 'pg_', mssql: 'sys', sqlite: 'sqlite_' }
const SYSTEM_COLUMNS = new Set(['ctid', 'xmin', 'xmax', 'cmin', 'cmax', 'tableoid', 'rowid', 'oid', '_rowid_'])
// Parentheses that hold no columns of the query: functions with keywords instead of arguments (`extract(year from d)`)
// and the column list of MERGE's `when not matched then insert (a, b)`.
const NO_COLUMNS = new Set(['extract', 'trim', 'substring', 'position', 'overlay', 'cast', 'insert'])
const CREATE_WORDS = new Set(
  'or replace temp temporary global local unlogged virtual materialized table view if not exists'.split(' '),
)

/** Warnings for `doc`; the schema in `model` is only as complete as what has been loaded. */
export function lintSql(doc: string, dialect: SplitDialect, model: SchemaModel, options: LintOptions): SqlDiagnostic[] {
  const { tokens, blocks } = analyse(doc, dialect, model)
  const out: SqlDiagnostic[] = []
  const word = (i: number) => (tokens[i]?.kind === 'word' ? tokens[i]!.text.toLowerCase() : undefined)
  const isName = (i: number) => tokens[i]?.kind === 'word' || tokens[i]?.kind === 'quoted'
  const punct = (i: number, c: string) => tokens[i]?.kind === 'punct' && tokens[i]!.text === c

  if (options.names) {
    // Tables the document creates itself.
    const created = new Set<string>()
    for (let i = 0; i < tokens.length; i++) {
      if (word(i) !== 'create') continue
      let j = i + 1
      while (CREATE_WORDS.has(word(j) ?? '')) j++
      while (isName(j) && punct(j + 1, '.')) j += 2
      if (isName(j) && j > i + 1) created.add(tokens[j]!.text.toLowerCase())
    }

    if (CHECKS_NAMES.has(dialect)) {
      for (const block of blocks) {
        for (const s of block.sources) {
          if (s.kind !== 'table' || s.parts > 2) continue
          const name = s.name.toLowerCase()
          // `update t set … from orders t`: the target is the alias of another source.
          const alias = !s.schema && block.sources.some((o) => o !== s && visibleName(o).toLowerCase() === name)
          const system = !s.schema && SYSTEM_TABLE[dialect] && name.startsWith(SYSTEM_TABLE[dialect])
          if (/^[#@$]/.test(name) || name === 'dual' || created.has(name) || alias || system) continue
          // Only where the tables of the schema are loaded.
          const loaded = s.schema
            ? Object.keys(model.tables).some((k) => k.toLowerCase() === s.schema!.toLowerCase())
            : !!model.defaultSchema && !!model.tables[model.defaultSchema]
          if (!loaded || findTable(model, s.schema, s.name)) continue
          out.push({ from: s.from, to: s.to, key: 'unknownTable', params: { name: doc.slice(s.from, s.to) } })
        }
      }

      // `q.col` where q is a table with loaded columns.
      for (let i = 0; i < tokens.length; i++) {
        if (!isName(i) || !punct(i + 1, '.') || !isName(i + 2) || punct(i - 1, '.') || punct(i + 3, '(')) continue
        const block = blockAt(blocks, tokens[i]!.from)
        const q = tokens[i]!.text.toLowerCase()
        const source = block && scopeOf(block).find((s) => visibleName(s).toLowerCase() === q)
        if (source?.kind !== 'table') continue
        const column = tokens[i + 2]!.text
        const columns = columnsOf(source, model)
        if (!columns || SYSTEM_COLUMNS.has(column.toLowerCase())) continue
        if (!columns.some((c) => c.toLowerCase() === column.toLowerCase())) {
          out.push({
            from: tokens[i + 2]!.from,
            to: tokens[i + 2]!.to,
            key: 'unknownColumn',
            params: { table: source.name, name: column },
          })
        }
      }
    }

    // An unqualified name that columns of several sources match.
    const owner = tokens.map((t) => blockAt(blocks, t.from))
    for (const block of blocks) {
      const sources = block.sources.filter((s) => s.kind !== 'table' || !s.target)
      const columns = sources.map((s) => columnsOf(s, model))
      if (block.merged || sources.length < 2 || columns.some((c) => !c)) continue
      const sourceNames = new Set(sources.map((s) => visibleName(s).toLowerCase()))
      const outputs = new Set(block.outputs?.map((n) => n.toLowerCase()))
      const functions: string[] = []
      let assigning = false
      // After GROUP BY, HAVING or ORDER BY the names of the select list are in scope too.
      let tail = false
      for (let i = block.tokens[0]; i < block.tokens[1]; i++) {
        const w = word(i)
        if (punct(i, '(')) functions.push(word(i - 1) ?? '')
        else if (punct(i, ')')) functions.pop()
        if (owner[i] !== block) continue
        // The left side of `update … set a = 1, b = 2`.
        if (w === 'set') assigning = true
        else if (w && ['from', 'where', 'returning', 'order', 'limit', 'output'].includes(w)) assigning = false
        if (w === 'group' || w === 'having' || w === 'order') tail = true
        const token = tokens[i]!
        const name = token.text.toLowerCase()
        if (
          !isName(i) ||
          sourceNames.has(name) ||
          (tail && outputs.has(name)) ||
          punct(i - 1, '.') ||
          punct(i - 1, '::') ||
          word(i - 1) === 'as' ||
          punct(i + 1, '.') ||
          punct(i + 1, '(') ||
          tokens[i - 1]?.kind === 'literal' ||
          tokens[i + 1]?.kind === 'literal' ||
          word(i + 1) === 'by' ||
          functions.some((f) => NO_COLUMNS.has(f)) ||
          (assigning && punct(i + 1, '=') && (word(i - 1) === 'set' || punct(i - 1, ','))) ||
          (block.insertColumns && token.from >= block.insertColumns[0] && token.to <= block.insertColumns[1])
        )
          continue
        const hits = sources.filter((_, k) => columns[k]!.some((c) => c.toLowerCase() === name))
        if (hits.length > 1) {
          out.push({
            from: token.from,
            to: token.to,
            key: 'ambiguousColumn',
            params: { name: token.text, tables: hits.map(visibleName).join(', ') },
          })
        }
      }
    }
  }

  if (options.writes) {
    for (const block of blocks) {
      const keyword = word(block.body)
      if (block.parent || block.where || (keyword !== 'update' && keyword !== 'delete')) continue
      const token = tokens[block.body]!
      out.push({ from: token.from, to: token.to, key: 'missingWhere', params: { statement: keyword.toUpperCase() } })
    }
  }
  return out.sort((a, b) => a.from - b.from)
}
