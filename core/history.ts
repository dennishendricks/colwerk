export interface HistoryEntry {
  id: string
  connectionId: string
  sql: string
  /** ISO 8601 */
  executedAt: string
  durationMs?: number
  /** Rows of the last result set (the one the editor shows first). */
  rowCount?: number
  affectedRows?: number
  error?: string
}

// Keeps the stored file small; older queries are dropped.
export const HISTORY_LIMIT = 50

/** Newest first. Running the newest query again replaces it instead of adding a duplicate. */
export function addToHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const repeat = history[0]?.connectionId === entry.connectionId && history[0].sql === entry.sql
  return [entry, ...(repeat ? history.slice(1) : history)].slice(0, HISTORY_LIMIT)
}
