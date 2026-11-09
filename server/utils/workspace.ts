import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultDataDir } from '#core'

// Open editor tabs per window (desktop app: `main` and the windows tabs were moved to), restored on the next start.
// A file instead of localStorage: the app's origin (port) changes with every start.

interface WindowWorkspace {
  tabs: unknown[]
  activeTabId?: string
}

export interface Workspace {
  windows: Record<string, WindowWorkspace>
}

// Several windows save at the same time; each write reads the others' tabs first.
let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn)
  queue = run.catch(() => {})
  return run
}

const file = () => join(defaultDataDir(), 'workspace.json')

async function load(): Promise<Workspace> {
  try {
    const saved = JSON.parse(await readFile(file(), 'utf8'))
    // Before windows: the tabs of the only window.
    return saved.windows ? saved : { windows: { main: saved } }
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return { windows: {} }
    throw e
  }
}

export const getWorkspace = () => serialized(load)

/** Saves the window's tabs; a window other than `main` without tabs is removed. */
export const saveWindowWorkspace = (window: string, workspace: WindowWorkspace) =>
  serialized(async () => {
    const others = Object.entries((await load()).windows).filter(([label]) => label !== window)
    const windows = Object.fromEntries(
      workspace.tabs.length || window === 'main' ? [...others, [window, workspace]] : others,
    )
    await mkdir(defaultDataDir(), { recursive: true })
    const tmp = `${file()}.${crypto.randomUUID()}.tmp`
    await writeFile(tmp, JSON.stringify({ windows } satisfies Workspace), { mode: 0o600 })
    await rename(tmp, file())
  })
