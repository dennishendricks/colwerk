import { maskLiterals, type SplitDialect } from './sql-split.ts'

export interface TableRef {
  schema?: string
  name: string
}

// On the masked text quoted identifiers are `___`, so `[\w$]+` matches them too; the names are read from the input.
const REF = /\b(?:from|join|update|into)\s+([\w$]+)(?:\s*\.\s*([\w$]+))?/dgi

function unquote(ident: string): string {
  const close = { '"': '"', '`': '`', '[': ']' }[ident[0]!]
  return close ? ident.slice(1, -1).replaceAll(close + close, close) : ident
}

/** Tables named after `from`, `join`, `update` and `into` (without duplicates), e.g. to load their columns. */
export function referencedTables(sql: string, dialect: SplitDialect): TableRef[] {
  const masked = maskLiterals(sql, dialect)
  const refs = new Map<string, TableRef>()
  for (const m of masked.matchAll(REF)) {
    const [first, second] = [m.indices![1]!, m.indices![2]].map(r => r && unquote(sql.slice(r[0], r[1])))
    const ref: TableRef = second ? { schema: first, name: second } : { name: first! }
    refs.set(JSON.stringify(ref), ref)
  }
  return [...refs.values()]
}
