// PII masking of result columns: rules on column names, applied to exports and to the answers of MCP tools
import { literalEnd, maskLiterals, type SplitDialect } from './sql-split.ts'
import type { CellValue, ResultColumn } from './types.ts'
import { cellText } from './values.ts'

export const maskMethods = ['redact', 'partial', 'hash', 'null'] as const
export type MaskMethod = (typeof maskMethods)[number]

/** Matches column names; `pattern` is a regular expression tested against the normalized name (see `normalizeName`). */
export interface MaskRule {
  id: string
  pattern: string
  method: MaskMethod
  enabled: boolean
  /** Shipped with Colwerk: its pattern is fixed, it can be disabled but not removed. */
  builtin?: boolean
}

const builtin = (id: string, pattern: string, method: MaskMethod, enabled = true): MaskRule => ({
  id,
  pattern,
  method,
  enabled,
  builtin: true,
})

export const defaultMaskRules: MaskRule[] = [
  builtin('email', 'e_?mail|^mail$', 'partial'),
  builtin(
    'phone',
    'phone|telefon|telefax|rufnummer|festnetz|(^|_)(tel|mobil|mobile|handy|fax|fon)_?(nr|nummer|no|number)?_?[0-9]*(_|$)',
    'partial',
  ),
  builtin(
    'personName',
    '(first|last|middle|full|sur|given|family|maiden|vor|nach|geburts|familien|ruf|zu|user|login|display|nick)_?name' +
      '|kontoinhaber|account_?holder|ansprechpartner|contact_?person',
    'redact',
  ),
  builtin('ip', '(^|_)ip(_|$)|ip_?addr|(^|_)mac(_|$)|mac_?addr|device_?id|(^|_)imei', 'hash'),
  builtin(
    'address',
    'street|strasse|straße|(^|_)str(_|$)|ad?dress|anschrift|wohnort|(^|_)addr(_|$)|house_?(no|number)|hausnummer' +
      '|hausnr|(^|_)hnr(_|$)',
    'redact',
  ),
  builtin('postalCode', '(^|_)(zip|zip_?code|postal_?code|post_?code|plz)(_|$)|postleitzahl', 'redact'),
  builtin(
    'birthDate',
    'birth|(^|_)b_?day(_|$)|(^|_)dob(_|$)|geburt|geboren|(^|_)geb_?(dat|tag)|(^|_)geb(_|$)',
    'redact',
  ),
  builtin(
    'bankAccount',
    'iban|(^|_)bic(_|$)|swift|bankverbindung|(^|_)blz(_|$)|bankleitzahl|account_?(no|number)|konto_?(nr|nummer)' +
      '|card_?(no|num|number)|(^|_)(cvv|cvc)(_|$)|sort_?code|routing_?(no|number)|(^|_)(kred|credit)',
    'partial',
  ),
  builtin(
    'nationalId',
    'ssn|social_?security|tax_?id|steuer_?(id|nr|nummer)|passport|reisepass|ausweis|national_?id' +
      '|sozialversicherung|(^|_)sv_?(nr|nummer)|(^|_)svnr|versicherten_?(nr|nummer)|(^|_)kv_?nr' +
      '|identifikationsnummer|(^|_)idnr(_|$)|fuehrerschein|führerschein|driver_?s?_?licen|license_?plate|kfz_?kennzeichen',
    'redact',
  ),
  builtin(
    'sensitive',
    'gender|geschlecht|religion|religious|konfession|ethnic|ethnie|nationality|nationalit|staatsangeh' +
      '|gesundheit|krankheit|krankenkasse|diagnose|diagnosis|(^|_)icd(_|$)|disability|behinderung|sexual|sexuell',
    'redact',
  ),
  builtin(
    'credentials',
    'password|passwd|passwort|kennwort|(^|_)pwd(_|$)|(^|_)pin(_|$)|secret|(^|_)token(_|$)|api_?key|private_?key',
    'null',
  ),
  builtin('location', 'latitude|longitude|(^|_)(lat|lng|lon)(_|$)|geo_?loc|koordinate', 'redact', false),
  builtin('name', '^name$', 'redact', false),
]

/**
 * Column name as the patterns see it: camelCase split by `_`, other characters than letters and digits as `_`, lower
 * case (`firstName` → `first_name`, `E-Mail` → `e_mail`).
 */
export const normalizeName = (name: string) =>
  name
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1_$2')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .toLowerCase()

export function isValidPattern(pattern: string): boolean {
  if (!pattern.trim()) return false
  try {
    new RegExp(pattern, 'u')
    return true
  } catch {
    return false
  }
}

/**
 * The rules of `value` (from settings.json): every built-in rule with the stored `enabled` and `method`, then the
 * valid custom rules. Invalid entries are dropped.
 */
export function parseMaskRules(value: unknown): MaskRule[] {
  const stored = Array.isArray(value) ? (value as Partial<MaskRule>[]) : []
  const method = (m: unknown, fallback: MaskMethod) =>
    maskMethods.includes(m as MaskMethod) ? (m as MaskMethod) : fallback
  const builtins = defaultMaskRules.map((rule) => {
    const s = stored.find((r) => r?.id === rule.id)
    return {
      ...rule,
      method: method(s?.method, rule.method),
      enabled: typeof s?.enabled === 'boolean' ? s.enabled : rule.enabled,
    }
  })
  const ids = new Set(builtins.map((r) => r.id))
  const custom = stored.flatMap((r): MaskRule[] => {
    if (!r || typeof r.id !== 'string' || ids.has(r.id) || typeof r.pattern !== 'string') return []
    if (!isValidPattern(r.pattern) || !maskMethods.includes(r.method as MaskMethod)) return []
    ids.add(r.id)
    return [{ id: r.id, pattern: r.pattern, method: r.method as MaskMethod, enabled: r.enabled !== false }]
  })
  return [...builtins, ...custom]
}

/** Strings of a list of column names (`column`, `table.column` or `schema.table.column`), trimmed, empty ones dropped. */
export function parseColumnList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
  return list.length ? list : undefined
}

export interface MaskOptions {
  rules: readonly MaskRule[]
  /** Always masked (method `redact`): `column`, `table.column` or `schema.table.column`. */
  columns?: string[]
  /** Never masked: same notation. A qualified entry applies only where the source table is known. */
  exempt?: string[]
  /** Keyed hash of the method `hash` (HMAC on the server, see server/utils/masking.ts). */
  hash: (text: string) => string
  /** Table the columns come from, if known (e.g. MCP `sample-rows`). */
  source?: { schema: string; table: string }
}

const RECORD_TYPES = new Set(['record'])

// Compiled once per pattern: nested JSON values test every key of every cell.
const compiled = new Map<string, RegExp>()
function regex(pattern: string): RegExp {
  let re = compiled.get(pattern)
  if (!re) compiled.set(pattern, (re = new RegExp(pattern, 'iu')))
  return re
}

/**
 * Method that masks column `name`, undefined if it is not masked. Without a known source, qualified entries of
 * `columns` match by their last part (masks more, never less), qualified entries of `exempt` do not match.
 */
export function maskMethodOf(name: string, options: Omit<MaskOptions, 'hash'>): MaskMethod | undefined {
  const lower = name.toLowerCase()
  const matches = (entry: string, qualifiedNeedsSource: boolean) => {
    const parts = entry.toLowerCase().split('.')
    if (parts.at(-1) !== lower) return false
    if (parts.length === 1) return true
    const { source } = options
    if (!source) return !qualifiedNeedsSource
    const table = parts.at(-2)
    const schema = parts.length > 2 ? parts.at(-3) : undefined
    return table === source.table.toLowerCase() && (!schema || schema === source.schema.toLowerCase())
  }
  if (options.exempt?.some((e) => matches(e, true))) return undefined
  if (options.columns?.some((c) => matches(c, false))) return 'redact'
  const normalized = normalizeName(name)
  // Custom rules first: they are the user's more specific intent.
  const ordered = [...options.rules.filter((r) => !r.builtin), ...options.rules.filter((r) => r.builtin)]
  for (const rule of ordered) {
    if (rule.enabled && regex(rule.pattern).test(normalized)) return rule.method
  }
  return undefined
}

export const REDACTED = '***'

/** Keeps a hint: the first letter and domain of an email address, otherwise the last 4 characters of long values. */
function partial(text: string): string {
  const at = text.lastIndexOf('@')
  if (at > 0) return `${text[0]}${REDACTED}${text.slice(at)}`
  return text.length >= 8 ? `${REDACTED}${text.slice(-4)}` : REDACTED
}

function maskValue(value: CellValue, method: MaskMethod, hash: (text: string) => string): CellValue {
  if (value === null || method === 'null') return null
  if (method === 'redact') return REDACTED
  const text = cellText(value)
  if (method === 'partial') return partial(text)
  return hash(text)
}

/** Masks the keys of JSON objects and structs that a rule matches, at any depth. */
function maskNested(value: CellValue, options: MaskOptions): CellValue {
  if (Array.isArray(value)) return value.map((v) => maskNested(v, options))
  if (value === null || typeof value !== 'object') return value
  const out: { [key: string]: CellValue } = {}
  for (const [k, v] of Object.entries(value)) {
    const method = maskMethodOf(k, { ...options, source: undefined })
    out[k] = method ? maskValue(v, method, options.hash) : maskNested(v, options)
  }
  return out
}

export interface Masker {
  /** Columns as written: masked columns become text, except with the method `null`. */
  columns: ResultColumn[]
  /** Names of the masked columns. */
  masked: string[]
  mask(rows: CellValue[][]): CellValue[][]
}

/** Masking of a result with `columns`. Whole rows as one value (Postgres `record`) are always redacted. */
export function createMasker(columns: ResultColumn[], options: MaskOptions): Masker {
  const methods = columns.map((c) => (RECORD_TYPES.has(c.type) ? 'redact' : maskMethodOf(c.name, options)))
  return {
    columns: columns.map((c, i) => (methods[i] && methods[i] !== 'null' ? { name: c.name, type: 'text' } : c)),
    masked: columns.filter((_, i) => methods[i]).map((c) => c.name),
    mask: (rows) =>
      rows.map((row) =>
        row.map((v, i) => {
          const method = methods[i]
          return method ? maskValue(v, method, options.hash) : maskNested(v, options)
        }),
      ),
  }
}

/** `sink` with masked rows; `onColumns` learns which columns were masked. */
export function maskingSink<S extends { columns(c: ResultColumn[]): void; rows(r: CellValue[][]): Promise<void> }>(
  sink: S,
  options: MaskOptions,
  onColumns?: (masked: string[]) => void,
): S {
  let masker: Masker | undefined
  return {
    ...sink,
    columns(columns: ResultColumn[]) {
      masker = createMasker(columns, options)
      onColumns?.(masker.masked)
      sink.columns(masker.columns)
    },
    rows: (rows: CellValue[][]) => sink.rows(masker ? masker.mask(rows) : rows),
  }
}

// Functions that turn whole rows into one value, around the column names a reference check looks for.
const WHOLE_ROW =
  /\b(row_to_json|to_json|to_jsonb|json_agg|jsonb_agg|array_agg|hstore|struct_pack|row|json_group_array|json_arrayagg)\s*\(|\bfor\s+(json|xml)\b/i

const IDENT_START = /[\p{L}_]/u
const IDENT_PART = /[\p{L}\p{N}_$]/u
const TABLE_KEYWORDS = new Set(['from', 'join', 'update', 'into', 'table'])

type Token = { text: string; ident: boolean }

/** Identifiers (quoted ones without their quotes) and punctuation of `sql`; strings and comments skipped. */
function tokens(sql: string, dialect: SplitDialect): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < sql.length) {
    const end = literalEnd(sql, dialect, i)
    const ch = sql[i]!
    if (end !== undefined) {
      const close = ch === '[' ? ']' : ch
      if (ch === '"' || ch === '`' || ch === '[') {
        out.push({ text: sql.slice(i + 1, end - 1).replaceAll(close + close, close), ident: true })
      }
      i = end
    } else if (IDENT_START.test(ch) && (i === 0 || !IDENT_PART.test(sql[i - 1]!))) {
      let j = i + 1
      while (j < sql.length && IDENT_PART.test(sql[j]!)) j++
      out.push({ text: sql.slice(i, j), ident: true })
      i = j
    } else {
      if (!/\s/.test(ch)) out.push({ text: ch, ident: false })
      i++
    }
  }
  return out
}

/**
 * Identifiers of `sql` that may name a column: not a qualifier before `.`, not a function before `(`, not a table
 * after FROM, JOIN, UPDATE, INTO or TABLE (also schema-qualified).
 */
export function columnCandidates(sql: string, dialect: SplitDialect): string[] {
  const list = tokens(sql, dialect)
  return list.flatMap((t, i) => {
    if (!t.ident || list[i + 1]?.text === '.' || list[i + 1]?.text === '(') return []
    let k = i
    while (list[k - 1]?.text === '.' && list[k - 2]?.ident) k -= 2
    const before = list[k - 1]
    return before?.ident && TABLE_KEYWORDS.has(before.text.toLowerCase()) ? [] : [t.text]
  })
}

/**
 * Why `sql` may not run under masking, undefined if it may: it names a masked column (in any clause, so filters
 * cannot probe values either) or turns whole rows into one value. A text check, not a guarantee.
 */
export function maskViolation(
  sql: string,
  dialect: SplitDialect,
  options: Omit<MaskOptions, 'hash'>,
): string | undefined {
  const masked = [...new Set(columnCandidates(sql, dialect).filter((id) => maskMethodOf(id, options)))]
  if (masked.length) return `The query references masked columns: ${masked.join(', ')}.`
  if (WHOLE_ROW.test(maskLiterals(sql, dialect)))
    return 'Functions that return whole rows (e.g. row_to_json, FOR JSON) are not allowed.'
  return undefined
}
