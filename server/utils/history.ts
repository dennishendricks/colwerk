import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { addToHistory, defaultDataDir, type HistoryEntry } from '#core'

// Executed tab queries, kept in a file like the workspace (see workspace.post.ts).

let history: HistoryEntry[] | undefined
// Reads and writes run one after another: several tabs may finish at the same time.
let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn)
  queue = run.catch(() => {})
  return run
}

async function load(): Promise<HistoryEntry[]> {
  if (history) return history
  try {
    history = JSON.parse(await readFile(join(defaultDataDir(), 'history.json'), 'utf8')) as HistoryEntry[]
  } catch (e) {
    if ((e as { code?: string }).code !== 'ENOENT') throw e
    history = []
  }
  return history
}

async function save(entries: HistoryEntry[]) {
  const dir = defaultDataDir()
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'history.json')
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(entries), { mode: 0o600 })
  await rename(tmp, file)
  history = entries
}

export const getHistory = () => serialized(load)

export const clearHistory = () => serialized(() => save([]))

/** Never fails: a history that cannot be written must not break the query. */
export function recordHistory(entry: Omit<HistoryEntry, 'id'>): void {
  serialized(async () => save(addToHistory(await load(), { id: crypto.randomUUID(), ...entry }))).catch(() => {})
}
