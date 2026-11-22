import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type AuditEntry,
  auditRetentions,
  DEFAULT_AUDIT_RETENTION,
  defaultDataDir,
  parseAuditLog,
  pruneAudit,
} from '#core'

// Tool calls of MCP clients, appended to a JSON Lines file (one entry per line, so a crash cuts at most the last one).
// The retention lives next to it.
const file = () => join(defaultDataDir(), 'mcp-audit.jsonl')
const settingsFile = () => join(defaultDataDir(), 'mcp-audit-settings.json')

// Reads and writes run one after another: several tool calls may finish at the same time.
let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn)
  queue = run.catch(() => {})
  return run
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return ''
    throw e
  }
}

async function retention(): Promise<number> {
  try {
    const days = JSON.parse((await readText(settingsFile())) || '{}').retentionDays
    return (auditRetentions as readonly number[]).includes(days) ? days : DEFAULT_AUDIT_RETENTION
  } catch {
    return DEFAULT_AUDIT_RETENTION
  }
}

async function rewrite(entries: AuditEntry[]) {
  await mkdir(defaultDataDir(), { recursive: true })
  const tmp = `${file()}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, entries.map((e) => `${JSON.stringify(e)}\n`).join(''), { mode: 0o600 })
  await rename(tmp, file())
}

// Old entries are also dropped on the first write of a process, so a log nobody opens does not grow without bound.
let pruned = false

/** Never throws: a log that cannot be written must not break the tool call. */
export function recordAudit(entry: Omit<AuditEntry, 'id'>): void {
  serialized(async () => {
    if (!pruned) {
      await rewrite(pruneAudit(parseAuditLog(await readText(file())), await retention()))
      pruned = true
    }
    await mkdir(defaultDataDir(), { recursive: true })
    await appendFile(file(), `${JSON.stringify({ id: crypto.randomUUID(), ...entry })}\n`, { mode: 0o600 })
  }).catch((e) => console.warn(`MCP audit log not written: ${(e as Error).message}`))
}

/** The entries within the retention period, newest first. */
export const getAudit = () =>
  serialized(async () => {
    const retentionDays = await retention()
    const all = parseAuditLog(await readText(file()))
    const kept = pruneAudit(all, retentionDays)
    if (kept.length !== all.length) await rewrite(kept)
    return { retentionDays, entries: kept.reverse() }
  })

export const clearAudit = () => serialized(() => rewrite([]))

export const setAuditRetention = (days: number) =>
  serialized(async () => {
    await mkdir(defaultDataDir(), { recursive: true })
    const tmp = `${settingsFile()}.${crypto.randomUUID()}.tmp`
    await writeFile(tmp, JSON.stringify({ retentionDays: days }), { mode: 0o600 })
    await rename(tmp, settingsFile())
    await rewrite(pruneAudit(parseAuditLog(await readText(file())), days))
  })
