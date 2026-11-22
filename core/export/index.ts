// Export of result sets: picks the encoder of a format; the formats live next to this file.
import { AppError } from '../types.ts'
import type { Exporter, ExportOptions, Write } from './common.ts'
import { parquetExporter } from './parquet.ts'
import { csvExporter, insertExporter, jsonExporter, markdownExporter, ndjsonExporter } from './text.ts'
import { xlsxExporter } from './xlsx.ts'

export type { Exporter, ExportOptions } from './common.ts'

export type ExportFormat = 'csv' | 'parquet' | 'xlsx' | 'json' | 'ndjson' | 'markdown' | 'insert'
export const exportFormats: ExportFormat[] = ['csv', 'parquet', 'xlsx', 'json', 'ndjson', 'markdown', 'insert']

export function createExporter(format: ExportFormat, write: Write, options?: ExportOptions): Exporter {
  switch (format) {
    case 'csv':
      return csvExporter(write)
    case 'parquet':
      return parquetExporter(write)
    case 'xlsx':
      return xlsxExporter(write)
    case 'json':
      return jsonExporter(write)
    case 'ndjson':
      return ndjsonExporter(write)
    case 'markdown':
      return markdownExporter(write)
    case 'insert':
      if (!options) throw new AppError('insertTableRequired', 'The target table for INSERT statements is missing.')
      return insertExporter(write, options)
  }
}
