// Pure helpers of the data import wizard: table names from a source and matching of source to target columns
import type { ImportSource } from '#core'

export const sanitized = (name: string) => name.toLowerCase().replace(/[^a-z0-9_]+/g, '_')

export const defaultTableName = (s: ImportSource) =>
  s.kind === 'file'
    ? sanitized(
        s.path
          .split(/[\\/]/)
          .pop()!
          .replace(/(?:\.(?:gz|zst))?\.[^.]+$/, '') || 'import',
      )
    : s.kind === 'table'
      ? s.table
      : 'import'

/** The target column of each source column: exact name, else case-insensitive, else skipped (''). */
export const matchColumnNames = (sources: string[], targets: string[]) =>
  sources.map((s) => targets.find((n) => n === s) ?? targets.find((n) => n.toLowerCase() === s.toLowerCase()) ?? '')
