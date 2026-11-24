// Progress of the guided tours in `tours.json` in the data directory (see core/tours.ts)
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultDataDir, parseTourStates, type TourStates, type TourStatus, withTourStatus } from '#core'

const file = () => join(defaultDataDir(), 'tours.json')

export async function getTourStates(): Promise<TourStates> {
  try {
    return parseTourStates(JSON.parse(await readFile(file(), 'utf8')))
  } catch (e) {
    // A missing or broken file means all tours are open.
    if ((e as { code?: string }).code === 'ENOENT' || e instanceof SyntaxError) return {}
    throw e
  }
}

/** Sets the status of one tour; returns the states of all tours. */
export async function setTourStatus(id: string, status: TourStatus): Promise<TourStates> {
  const states = withTourStatus(await getTourStates(), id, status)
  await mkdir(defaultDataDir(), { recursive: true })
  const tmp = `${file()}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(states, null, 2), { mode: 0o600 })
  await rename(tmp, file())
  return states
}
