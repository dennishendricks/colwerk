import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultDataDir } from '#core'

// Open editor tabs, restored on the next start (see workspace.post.ts).
export default defineEventHandler(async () => {
  try {
    return JSON.parse(await readFile(join(defaultDataDir(), 'workspace.json'), 'utf8'))
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return { tabs: [] }
    throw e
  }
})
