// Settings of the settings dialog in `settings.json` in the data directory (see core/settings.ts)
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultDataDir, parseSettings, type Settings } from '#core'

const file = () => join(defaultDataDir(), 'settings.json')

export async function getSettings(): Promise<Settings> {
  try {
    return parseSettings(JSON.parse(await readFile(file(), 'utf8')))
  } catch (e) {
    // A missing or broken file means the defaults.
    if ((e as { code?: string }).code === 'ENOENT' || e instanceof SyntaxError) return parseSettings({})
    throw e
  }
}

/** Saves the known settings of `value`, invalid ones replaced by their default; returns what was saved. */
export async function saveSettings(value: unknown): Promise<Settings> {
  const settings = parseSettings(value)
  await mkdir(defaultDataDir(), { recursive: true })
  const tmp = `${file()}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 })
  await rename(tmp, file())
  return settings
}
