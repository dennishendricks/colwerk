/** One tool call of an MCP client. Never holds result rows. */
export interface AuditEntry {
  id: string
  /** ISO 8601, start of the call. */
  at: string
  /** Name and version the MCP client reported, `unknown` without. */
  client: string
  tool: string
  connectionId?: string
  /** Name at the time of the call; the connection may be renamed or deleted since. */
  connectionName?: string
  sql?: string
  durationMs: number
  /** Rows returned to the client (run-query, sample-rows). */
  rowCount?: number
  status: 'ok' | 'error' | 'timeout'
  error?: string
}

/** Choices for how long entries are kept, in days. */
export const auditRetentions = [7, 30, 90, 365] as const
export const DEFAULT_AUDIT_RETENTION = 30
// Bounds the file also within the retention period.
export const AUDIT_LIMIT = 10_000

/** Entries of a JSON Lines log, oldest first; unreadable lines (e.g. cut off by a crash) are skipped. */
export function parseAuditLog(text: string): AuditEntry[] {
  const entries: AuditEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (typeof entry?.id === 'string' && typeof entry.at === 'string' && typeof entry.tool === 'string') {
        entries.push(entry)
      }
    } catch {
      // Skipped, see above.
    }
  }
  return entries
}

/** The entries younger than `retentionDays`, at most AUDIT_LIMIT (the newest); order kept. */
export function pruneAudit(entries: AuditEntry[], retentionDays: number, now = Date.now()): AuditEntry[] {
  const since = now - retentionDays * 86_400_000
  return entries.filter((e) => Date.parse(e.at) >= since).slice(-AUDIT_LIMIT)
}
