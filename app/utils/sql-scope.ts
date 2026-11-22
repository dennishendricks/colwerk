import { identifier } from './sql-ident.ts'
import { literalEnd, splitStatements, type SplitDialect } from './sql-split.ts'
import type { ForeignKeyInfo } from '../../core/types.ts'

// Name resolution for the editor: which tables, CTEs and derived tables a query names, and with which columns.
// Not a SQL parser: it finds FROM clauses, CTEs and subqueries well enough for completion and linting, and gives
// up (null columns, no source) wherever the text is not understood.

/** What the editor knows about the database: loaded tables, foreign keys and functions. */
export interface SchemaModel {
  /** Schema for unqualified names. */
  defaultSchema?: string
  /** Schema → table → column names; null while the columns are not loaded. A schema is missing until its tables are. */
  tables: Record<string, Record<string, string[] | null>>
  foreignKeys: ForeignKeyInfo[]
  /** User-defined functions of the default schema. */
  functions: string[]
}

export interface TableSource {
  kind: 'table'
  schema?: string
  name: string
  alias?: string
  /** Number of dotted name parts (catalog.schema.table); only the last two are kept. */
  parts: number
  /** Insert target: its columns are not visible in the query. */
  target?: boolean
  /** Offsets of the name as written. */
  from: number
  to: number
}

/** A CTE, subquery or table function; `columns` is null where unknown. */
export interface DerivedSource {
  kind: 'derived'
  /** The alias (or CTE name); empty without one. */
  name: string
  columns: string[] | null
}

export type Source = TableSource | DerivedSource

export interface QueryBlock {
  /** Offsets of the block's text (for a subquery: between the parentheses). */
  from: number
  to: number
  sources: Source[]
  parent?: QueryBlock
  /** Output column names; null where a `*` cannot be expanded. */
  outputs: string[] | null
  /** USING and NATURAL joins merge columns, so unqualified names cannot be checked. */
  merged: boolean
  /** Token range of the block, and the index of its first token after the CTEs. */
  tokens: [number, number]
  body: number
  /** A WHERE clause at the block's own level. */
  where: boolean
  /** Offsets of the column list of an INSERT. */
  insertColumns?: [number, number]
  ctes: Map<string, DerivedSource>
}

export interface Token {
  kind: 'word' | 'quoted' | 'literal' | 'punct'
  /** The identifier unquoted; otherwise the text as written. */
  text: string
  from: number
  to: number
}

export interface Analysis {
  tokens: Token[]
  blocks: QueryBlock[]
}

const WORD = /[#@$]*[\p{L}_][\p{L}\p{N}_$]*/uy
const NUMBER = /\$?\d[\p{L}\p{N}_.]*/uy
const VARIABLE = /\$\{[A-Za-z_]\w*\}/y

/** Words, quoted identifiers, literals and punctuation, without comments. */
export function tokenize(sql: string, dialect: SplitDialect): Token[] {
  const tokens: Token[] = []
  for (let i = 0; i < sql.length;) {
    const ch = sql[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const end = literalEnd(sql, dialect, i)
    if (end !== undefined) {
      if (!'-/#'.includes(ch)) {
        const close = { '"': '"', '`': '`', '[': ']' }[ch]
        const quoted = close && !(dialect === 'mysql' && ch === '"')
        const raw = sql.slice(i, end)
        tokens.push({
          kind: quoted ? 'quoted' : 'literal',
          text: quoted ? raw.slice(1, -1).replaceAll(close + close, close) : raw,
          from: i,
          to: end,
        })
      }
      i = end
      continue
    }
    let m: RegExpExecArray | null = null
    for (const re of [VARIABLE, WORD, NUMBER]) {
      re.lastIndex = i
      if ((m = re.exec(sql))) break
    }
    const kind = m && m[0].match(/^[#@$]*[\p{L}_]/u) ? 'word' : m ? 'literal' : 'punct'
    const text = m ? m[0] : sql.startsWith('::', i) ? '::' : ch
    tokens.push({ kind: m && /^\$\{/.test(text) ? 'literal' : kind, text, from: i, to: i + text.length })
    i += text.length
  }
  return tokens
}

// Words that end a FROM list or a select list.
const TERMINATORS = new Set(
  'where group having order limit offset fetch union intersect except window qualify returning into for'.split(' '),
)
const JOINERS = new Set('natural inner left right full cross outer join apply straight_join'.split(' '))
// Words that are not an alias without AS.
const RESERVED = new Set([
  ...TERMINATORS,
  ...JOINERS,
  ...'on using set select values with when output default use force ignore from tablesample pivot unpivot option partition lateral'.split(
    ' ',
  ),
])
// Statements whose USING names a source; in a join it lists columns.
const USING_SOURCE = new Set(['merge', 'delete'])
const NOT_A_NAME = new Set(['end', 'null', 'true', 'false', 'unknown'])

/** The name a source is referred to by. */
export const visibleName = (s: Source) => (s.kind === 'table' ? (s.alias ?? s.name) : s.name)

/** Case-insensitive lookup: an exact match wins. */
const caseless = (names: string[], name: string) =>
  names.find((n) => n === name) ?? names.find((n) => n.toLowerCase() === name.toLowerCase())

/** The table in the model; unqualified names are looked up in the default schema first. */
export function findTable(model: SchemaModel, schema: string | undefined, name: string) {
  const schemas = schema
    ? [caseless(Object.keys(model.tables), schema)]
    : [model.defaultSchema, ...Object.keys(model.tables)]
  for (const s of schemas) {
    const tables = s ? model.tables[s] : undefined
    const table = tables && caseless(Object.keys(tables), name)
    if (s && tables && table) return { schema: s, name: table, columns: tables[table]! }
  }
}

/** Column names of a source; null where unknown. */
export function columnsOf(source: Source, model?: SchemaModel): string[] | null {
  if (source.kind === 'derived') return source.columns
  return (model && findTable(model, source.schema, source.name)?.columns) || null
}

/** Analyses `sql` statement by statement; `model` is only used to expand `*` in select lists. */
export function analyse(sql: string, dialect: SplitDialect, model?: SchemaModel): Analysis {
  const tokens = tokenize(sql, dialect)
  const blocks: QueryBlock[] = []
  // Index of the closing parenthesis of each opening one (the statement's end if there is none).
  const match: number[] = []
  let statementEnd = 0
  let statementTo = 0

  const word = (i: number) => (tokens[i]?.kind === 'word' ? tokens[i]!.text.toLowerCase() : undefined)
  const isName = (i: number) => tokens[i]?.kind === 'word' || tokens[i]?.kind === 'quoted'
  const punct = (i: number, c: string) => tokens[i]?.kind === 'punct' && tokens[i]!.text === c
  const offset = (i: number) => (i < statementEnd ? tokens[i]!.from : statementTo)
  const isQuery = (i: number) => ['select', 'with', 'values'].includes(word(i + 1) ?? '')
  const names = (from: number, to: number) =>
    tokens
      .slice(from, to)
      .filter((t) => t.kind !== 'punct')
      .map((t) => t.text)

  function findCte(block: QueryBlock, name: string) {
    for (let b: QueryBlock | undefined = block; b; b = b.parent) {
      const cte = b.ctes.get(name.toLowerCase())
      if (cte) return cte
    }
  }

  // Skips the parenthesis group at `i`, registering the subqueries in it.
  function skipGroup(i: number, parent: QueryBlock): number {
    const close = match[i]!
    if (isQuery(i)) parseBlock(i + 1, close, parent, tokens[i]!.to, offset(close))
    else for (let j = i + 1; j < close;) j = punct(j, '(') ? skipGroup(j, parent) : j + 1
    return close + 1
  }

  // `with [recursive] name [(cols)] as [not] [materialized] (…) [, …]`; returns the index after the CTEs.
  function parseCtes(block: QueryBlock, i: number, end: number): number {
    if (word(i) === 'recursive') i++
    while (i < end && isName(i)) {
      const cte: DerivedSource = { kind: 'derived', name: tokens[i]!.text, columns: null }
      block.ctes.set(cte.name.toLowerCase(), cte)
      i++
      if (punct(i, '(')) {
        cte.columns = names(i + 1, match[i]!)
        i = match[i]! + 1
      }
      if (word(i) !== 'as') break
      i++
      if (word(i) === 'not') i++
      if (word(i) === 'materialized') i++
      if (!punct(i, '(')) break
      const close = match[i]!
      const sub = isQuery(i) ? parseBlock(i + 1, close, block, tokens[i]!.to, offset(close)) : undefined
      cte.columns ??= sub?.outputs ?? null
      i = close + 1
      if (!punct(i, ',')) break
      i++
    }
    return i
  }

  // Skips an ON condition up to the next join, comma or clause.
  function skipCondition(block: QueryBlock, i: number, end: number): number {
    let cases = 0
    for (; i < end; i++) {
      const w = word(i)
      if (punct(i, '(')) i = skipGroup(i, block) - 1
      else if (punct(i, ',')) break
      else if (w === 'case') cases++
      else if (w === 'end') cases--
      else if (w && !cases && (TERMINATORS.has(w) || w === 'when') && !punct(i + 1, '(')) break
      else if (w && JOINERS.has(w) && !punct(i + 1, '(')) break
    }
    return i
  }

  // The sources of a FROM clause (or the target of UPDATE, INSERT, MERGE): names with aliases, subqueries and
  // table functions, separated by commas and joins. Returns the index after the list.
  function parseSources(block: QueryBlock, i: number, end: number, insert = false): number {
    for (;;) {
      while (word(i) === 'lateral' || word(i) === 'only') i++
      let source: Source | undefined
      if (punct(i, '(')) {
        const close = match[i]!
        if (isQuery(i)) {
          const sub = parseBlock(i + 1, close, block, tokens[i]!.to, offset(close))
          source = { kind: 'derived', name: '', columns: sub.outputs }
        } else {
          parseSources(block, i + 1, close)
        }
        i = close + 1
      } else if (isName(i)) {
        const parts = [tokens[i++]!]
        while (punct(i, '.') && isName(i + 1) && parts.length < 3) parts.push(tokens[(i += 2) - 1]!)
        const last = parts.at(-1)!
        const cte = parts.length === 1 ? findCte(block, last.text) : undefined
        if (punct(i, '(') && !insert) {
          i = skipGroup(i, block)
          source = { kind: 'derived', name: '', columns: null }
        } else if (cte) {
          source = { ...cte }
        } else {
          source = {
            kind: 'table',
            schema: parts.length > 1 ? parts.at(-2)!.text : undefined,
            name: last.text,
            parts: parts.length,
            from: parts[0]!.from,
            to: last.to,
            ...(insert ? { target: true } : {}),
          }
        }
      }
      if (!source) return i
      // SQL Server table hints come before or after the alias.
      const hints = () => {
        if (word(i) === 'with' && punct(i + 1, '(')) i = skipGroup(i + 1, block)
      }
      hints()
      const as = word(i) === 'as'
      if (as) i++
      let alias: string | undefined
      if (isName(i) && (as || tokens[i]!.kind === 'quoted' || !RESERVED.has(word(i)!))) alias = tokens[i++]!.text
      hints()
      if (insert) {
        if (punct(i, '(') && !isQuery(i)) {
          block.insertColumns = [tokens[i]!.to, offset(match[i]!)]
          i = match[i]! + 1
        }
      } else if (alias && punct(i, '(') && source.kind === 'derived') {
        source.columns = names(i + 1, match[i]!)
        i = match[i]! + 1
      }
      if (source.kind === 'table') source.alias = alias
      else if (alias) source.name = alias
      block.sources.push(source)

      if (word(i) === 'on') i = skipCondition(block, i + 1, end)
      // In MERGE and DELETE, USING starts the next source instead.
      else if (word(i) === 'using' && punct(i + 1, '(') && !USING_SOURCE.has(word(block.body) ?? '')) {
        block.merged = true
        i = skipGroup(i + 1, block)
      }
      if (punct(i, ',')) {
        i++
        continue
      }
      // Join forms: (natural) (inner|left|right|full|cross) (outer) join, cross/outer apply.
      let j = i
      while (JOINERS.has(word(j) ?? '') && !punct(j + 1, '(')) {
        if (word(j) === 'natural') block.merged = true
        j++
      }
      if (j === i || !['join', 'apply', 'straight_join'].includes(word(j - 1)!)) return i
      i = j
    }
  }

  // Names of the select list in tokens `from` to `to`; null if a `*` cannot be expanded.
  function outputsOf(block: QueryBlock, from: number, to: number): string[] | null {
    const out: string[] = []
    let k = from
    // DISTINCT [ON (…)], ALL, TOP n [PERCENT] [WITH TIES]
    if (word(k) === 'distinct' || word(k) === 'all') k++
    if (punct(k, '(') && word(k - 1) === 'on') k = match[k]! + 1
    if (word(k) === 'top') k += punct(k + 1, '(') ? match[k + 1]! - k + 1 : 2
    while (k < to) {
      let e = k
      while (e < to && !punct(e, ',')) e = punct(e, '(') ? match[e]! + 1 : e + 1
      e = Math.min(e, to)
      const last = e - 1
      if (punct(last, '*')) {
        // `*` and `q.*`
        const q = punct(last - 1, '.') && isName(last - 2) ? tokens[last - 2]!.text.toLowerCase() : undefined
        const from = q === undefined ? block.sources : block.sources.filter((s) => visibleName(s).toLowerCase() === q)
        for (const s of from) {
          const cols = columnsOf(s, model)
          if (!cols) return null
          out.push(...cols)
        }
        if (q !== undefined && !from.length) return null
      } else if (isName(last) && !NOT_A_NAME.has(word(last) ?? '')) {
        const prev = last - 1
        const named =
          last === k ||
          word(prev) === 'as' ||
          punct(prev, '.') ||
          (prev >= k && (tokens[prev]!.kind !== 'punct' || punct(prev, ')')))
        if (named) out.push(tokens[last]!.text)
      }
      k = e + 1
    }
    return out
  }

  function parseBlock(
    start: number,
    end: number,
    parent: QueryBlock | undefined,
    from: number,
    to: number,
  ): QueryBlock {
    const block: QueryBlock = {
      from,
      to,
      sources: [],
      parent,
      outputs: null,
      merged: false,
      tokens: [start, end],
      body: start,
      where: false,
      ctes: new Map(),
    }
    blocks.push(block)
    let i = start
    if (word(i) === 'with') i = parseCtes(block, i + 1, end)
    block.body = i
    const first = word(i)
    let list: [number, number?] | undefined
    while (i < end) {
      const w = word(i)
      if (punct(i, '(')) {
        i = skipGroup(i, block)
        continue
      }
      if (list && !list[1] && (w === 'from' || (w && TERMINATORS.has(w)))) list[1] = i
      if (w === 'select' && !list) list = [i + 1]
      else if (w === 'where') block.where = true
      else if (w === 'from' && word(i - 1) !== 'distinct') {
        i = parseSources(block, i + 1, end)
        continue
      } else if (w === 'update' && i === block.body) {
        i = parseSources(block, i + 1, end)
        continue
      } else if ((w === 'insert' || w === 'merge' || w === 'replace') && i === block.body) {
        i = parseSources(block, word(i + 1) === 'into' ? i + 2 : i + 1, end, w === 'insert')
        continue
      } else if (w === 'using' && USING_SOURCE.has(first ?? '')) {
        i = parseSources(block, i + 1, end)
        continue
      }
      i++
    }
    if (list) block.outputs = outputsOf(block, list[0], list[1] ?? end)
    return block
  }

  for (const range of splitStatements(sql, dialect, { blankLines: dialect === 'mssql' })) {
    const a = tokens.findIndex((t) => t.from >= range.from)
    if (a === -1) break
    let b = a
    while (b < tokens.length && tokens[b]!.from < range.to) b++
    statementEnd = b
    // The cursor after the last word (`join |`) still belongs to the statement.
    statementTo = range.to
    while (/\s/.test(sql[statementTo] ?? '')) statementTo++
    const stack: number[] = []
    for (let i = a; i < b; i++) {
      if (punct(i, '(')) stack.push(i)
      else if (punct(i, ')') && stack.length) match[stack.pop()!] = i
    }
    for (const open of stack) match[open] = b
    parseBlock(a, b, undefined, range.from, statementTo)
  }
  return { tokens, blocks }
}

let last: { sql: string; dialect: SplitDialect; model?: SchemaModel; analysis: Analysis } | undefined

/** `analyse` for the editor's repeated calls on the same text. */
function analysed(sql: string, dialect: SplitDialect, model?: SchemaModel): Analysis {
  if (!last || last.sql !== sql || last.dialect !== dialect || last.model !== model) {
    last = { sql, dialect, model, analysis: analyse(sql, dialect, model) }
  }
  return last.analysis
}

/** Every query block of the text: statements, CTE bodies and subqueries. */
export const blocksOf = (sql: string, dialect: SplitDialect, model?: SchemaModel) =>
  analysed(sql, dialect, model).blocks

/** The innermost block containing `pos`. */
export function blockAt(blocks: QueryBlock[], pos: number): QueryBlock | undefined {
  return blocks
    .filter((b) => b.from <= pos && pos <= b.to)
    .reduce<QueryBlock | undefined>((best, b) => (!best || b.to - b.from < best.to - best.from ? b : best), undefined)
}

/** The sources visible in a block, innermost first; a name in an inner block shadows the same name outside. */
export function scopeOf(block: QueryBlock): Source[] {
  const out: Source[] = []
  const seen = new Set<string>()
  for (let b: QueryBlock | undefined = block; b; b = b.parent) {
    const fresh = b.sources.filter((s) => !seen.has(visibleName(s).toLowerCase()))
    for (const s of fresh) seen.add(visibleName(s).toLowerCase())
    out.push(...fresh)
  }
  return out
}

/** The sources visible at `pos`. */
export function scopeAt(sql: string, pos: number, dialect: SplitDialect, model?: SchemaModel): Source[] {
  const block = blockAt(blocksOf(sql, dialect, model), pos)
  return block ? scopeOf(block) : []
}

/** What the qualifier of `qualifier.` at `pos` stands for: a table of the model, or known columns. */
export function resolveQualifier(
  sql: string,
  pos: number,
  qualifier: string,
  dialect: SplitDialect,
  model: SchemaModel,
): { table: { schema?: string; name: string } } | { columns: string[] } | undefined {
  const scope = scopeAt(sql, pos, dialect, model)
  const source =
    scope.find((s) => visibleName(s) === qualifier) ??
    scope.find((s) => visibleName(s).toLowerCase() === qualifier.toLowerCase())
  if (!source) return
  if (source.kind === 'table') return { table: { schema: source.schema, name: source.name } }
  return source.columns ? { columns: source.columns } : undefined
}

export interface JoinSuggestion {
  label: string
  apply: string
  detail: string
}

// Short words that cannot be aliases.
const SHORT_WORDS = 'as at by do go if in is of on or to'.split(' ')

/** Initials of the parts of a name: order_items → oi, orderItems → oi. */
function initials(name: string): string {
  const letters = name
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter(Boolean)
    .map((p) => p[0]!.toLowerCase())
    .join('')
  return /^[a-z]/.test(letters) ? letters : 't'
}

/** Tables related by foreign keys to the tables of the block at `pos`, with their ON clause (for `join …`). */
export function joinSuggestions(sql: string, pos: number, dialect: SplitDialect, model: SchemaModel): JoinSuggestion[] {
  const block = blockAt(blocksOf(sql, dialect, model), pos)
  if (!block) return []
  const used = new Set([...scopeOf(block).map((s) => visibleName(s).toLowerCase()), ...SHORT_WORDS])
  const alias = (table: string) => {
    const base = initials(table)
    let name = base
    for (let n = 2; used.has(name); n++) name = `${base}${n}`
    return name
  }
  const out = new Map<string, JoinSuggestion>()
  for (const source of block.sources) {
    const table = source.kind === 'table' ? findTable(model, source.schema, source.name) : undefined
    if (source.kind !== 'table' || !table) continue
    const mine = identifier(dialect, source.alias ?? source.name)
    for (const fk of model.foreignKeys) {
      type Side = [schema: string, name: string, mine: string[], theirs: string[]]
      const sides: (Side | false)[] = [
        fk.schema === table.schema && fk.table === table.name && [fk.refSchema, fk.refTable, fk.columns, fk.refColumns],
        fk.refSchema === table.schema && fk.refTable === table.name && [fk.schema, fk.table, fk.refColumns, fk.columns],
      ]
      for (const side of sides) {
        if (!side) continue
        const [schema, name, myColumns, theirColumns] = side
        const other = alias(name)
        const qualified = schema !== model.defaultSchema || source.schema !== undefined
        const ref = `${qualified ? `${identifier(dialect, schema)}.` : ''}${identifier(dialect, name)}`
        const on = theirColumns
          .map((c, i) => `${other}.${identifier(dialect, c)} = ${mine}.${identifier(dialect, myColumns[i]!)}`)
          .join(' and ')
        const label = `${ref} ${other} on ${on}`
        out.set(label, { label, apply: label, detail: fk.name || 'FK' })
      }
    }
  }
  return [...out.values()]
}
