// Contracts shared by the export formats: the sink each format implements and helpers they have in common.
import type { SplitDialect } from '../sql-split.ts'
import { AppError, type RowSink } from '../types.ts'

/** What the INSERT format needs: the dialect of the source connection, the target table and rows per statement. */
export interface ExportOptions {
  dialect: SplitDialect
  table: string[]
  batchSize: number
}

/** A sink that encodes rows; `write` is awaited for backpressure. */
export interface Exporter extends RowSink {
  /** Writes what is still buffered; called after the last row. */
  finish(): Promise<void>
  /** Releases temporary resources; always called, also after an error. */
  dispose(): Promise<void>
}

export type Write = (chunk: Uint8Array) => Promise<void>

export const encoder = new TextEncoder()
export const needColumns = () => new AppError('noResultSet', 'The statement returned no result set.')
