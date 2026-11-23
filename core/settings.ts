// Settings the user chooses once (settings dialog), stored in `settings.json` in the data directory
import { csvDelimiters, csvEncodings, csvEscapes, type CsvOptions, csvQuotes, defaultCsvOptions } from './values.ts'

export interface Settings {
  csv: CsvOptions
}

export const defaultSettings: Settings = { csv: defaultCsvOptions }

const pick = <T>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

/** The known settings of `value`; missing or invalid ones get their default. */
export function parseSettings(value: unknown): Settings {
  const csv = ((value as { csv?: unknown } | null)?.csv ?? {}) as Record<string, unknown>
  const d = defaultCsvOptions
  return {
    csv: {
      delimiter: pick(csvDelimiters, csv.delimiter, d.delimiter),
      quote: pick(csvQuotes, csv.quote, d.quote),
      escape: pick(csvEscapes, csv.escape, d.escape),
      encoding: pick(csvEncodings, csv.encoding, d.encoding),
    },
  }
}
