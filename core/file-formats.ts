// Data files DuckDB reads (file querying, data import): the format of a path or URL, the table function reading it
// and the extensions that needs.
export type FileFormat = 'csv' | 'tsv' | 'parquet' | 'json' | 'xlsx'

const FORMATS: Record<string, FileFormat> = {
  csv: 'csv',
  tsv: 'tsv',
  tab: 'tsv',
  parquet: 'parquet',
  json: 'json',
  ndjson: 'json',
  jsonl: 'json',
  xlsx: 'xlsx',
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/** Format by extension; `.gz`/`.zst` of text formats is skipped. Undefined: not supported. */
export function fileFormat(source: string): FileFormat | undefined {
  const name = (URL_SCHEME.test(source) ? new URL(source).pathname : source).toLowerCase()
  const m = name.match(/\.([a-z0-9]+)(\.(?:gz|zst))?$/)
  const format = m ? FORMATS[m[1]!] : undefined
  if (m?.[2] && (format === 'parquet' || format === 'xlsx')) return undefined
  return format
}

const lit = (value: string) => `'${value.replaceAll("'", "''")}'`

/** DuckDB table function reading `source`. */
export function scanSql(source: string, format: FileFormat): string {
  if (format === 'csv') return `read_csv(${lit(source)})`
  if (format === 'tsv') return `read_csv(${lit(source)}, delim = '\t')`
  if (format === 'parquet') return `read_parquet(${lit(source)})`
  if (format === 'json') return `read_json(${lit(source)})`
  return `read_xlsx(${lit(source)})`
}

/** Whether `source` is a remote URL DuckDB reads through httpfs. */
export const isRemote = (source: string) => /^(?:s3|gs|gcs|https?):\/\//i.test(source)

/** Extensions reading `source` needs; installed from DuckDB's extension repository on first use. */
export function extensionsFor(source: string, format: FileFormat): string[] {
  return [...(format === 'xlsx' ? ['excel'] : []), ...(isRemote(source) ? ['httpfs'] : [])]
}
