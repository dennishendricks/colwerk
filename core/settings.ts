// Settings the user chooses once (settings dialog), stored in `settings.json` in the data directory
import { type MaskRule, parseMaskRules } from './masking.ts'
import { csvDelimiters, csvEncodings, csvEscapes, type CsvOptions, csvQuotes, defaultCsvOptions } from './values.ts'

export const sqlCases = ['preserve', 'upper', 'lower'] as const
export const sqlIndents = ['spaces4', 'spaces2', 'tab'] as const
export const sqlLogicalNewlines = ['before', 'after'] as const
export const sqlCommas = ['leading', 'trailing'] as const
export const sqlExpressionWidths = { min: 20, max: 1000 } as const

/** Options of Format SQL (app/utils/sql-format.ts); most are passed on to sql-formatter. */
export interface SqlFormatOptions {
  keywordCase: (typeof sqlCases)[number]
  functionCase: (typeof sqlCases)[number]
  dataTypeCase: (typeof sqlCases)[number]
  identifierCase: (typeof sqlCases)[number]
  indent: (typeof sqlIndents)[number]
  logicalOperatorNewline: (typeof sqlLogicalNewlines)[number]
  /** Parenthesized expressions up to this length stay on one line. */
  expressionWidth: number
  commas: (typeof sqlCommas)[number]
  /** `<>` becomes `!=`. */
  bangNotEqual: boolean
}

export const defaultSqlFormatOptions: SqlFormatOptions = {
  keywordCase: 'preserve',
  functionCase: 'preserve',
  dataTypeCase: 'preserve',
  identifierCase: 'preserve',
  indent: 'spaces4',
  logicalOperatorNewline: 'before',
  expressionWidth: 200,
  commas: 'leading',
  bangNotEqual: true,
}

export interface Settings {
  csv: CsvOptions
  sqlFormat: SqlFormatOptions
  /** PII masking of exports and MCP answers (core/masking.ts). */
  masking: { rules: readonly MaskRule[] }
}

export const defaultSettings: Settings = {
  csv: defaultCsvOptions,
  sqlFormat: defaultSqlFormatOptions,
  masking: { rules: parseMaskRules(undefined) },
}

const pick = <T>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

const section = (value: unknown, key: string) =>
  ((value as Record<string, unknown> | null)?.[key] ?? {}) as Record<string, unknown>

/** The known settings of `value`; missing or invalid ones get their default. */
export function parseSettings(value: unknown): Settings {
  const csv = section(value, 'csv')
  const d = defaultCsvOptions
  const sql = section(value, 'sqlFormat')
  const s = defaultSqlFormatOptions
  const width = sql.expressionWidth
  return {
    csv: {
      delimiter: pick(csvDelimiters, csv.delimiter, d.delimiter),
      quote: pick(csvQuotes, csv.quote, d.quote),
      escape: pick(csvEscapes, csv.escape, d.escape),
      encoding: pick(csvEncodings, csv.encoding, d.encoding),
    },
    sqlFormat: {
      keywordCase: pick(sqlCases, sql.keywordCase, s.keywordCase),
      functionCase: pick(sqlCases, sql.functionCase, s.functionCase),
      dataTypeCase: pick(sqlCases, sql.dataTypeCase, s.dataTypeCase),
      identifierCase: pick(sqlCases, sql.identifierCase, s.identifierCase),
      indent: pick(sqlIndents, sql.indent, s.indent),
      logicalOperatorNewline: pick(sqlLogicalNewlines, sql.logicalOperatorNewline, s.logicalOperatorNewline),
      expressionWidth:
        Number.isInteger(width) &&
        (width as number) >= sqlExpressionWidths.min &&
        (width as number) <= sqlExpressionWidths.max
          ? (width as number)
          : s.expressionWidth,
      commas: pick(sqlCommas, sql.commas, s.commas),
      bangNotEqual: typeof sql.bangNotEqual === 'boolean' ? sql.bangNotEqual : s.bangNotEqual,
    },
    masking: { rules: parseMaskRules(section(value, 'masking').rules) },
  }
}
