import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { defaultDataDir } from './data-dir.ts'
import { keychain, KeychainUnavailable } from './keychain.ts'

// Used by the launcher, outside the server bundle: no imports beyond data-dir.ts and keychain.ts.
//
// MCP clients authenticate with their own token (`Authorization: Bearer`), separate from the UI's
// per-launch session token. It is created on first start and kept, so a client configuration stays
// valid. Stored like the encryption key: in the OS keychain, otherwise (or with DBM_KEYCHAIN=off)
// in `mcp-token` (mode 0600) next to the data. COLWERK_MCP_TOKEN overrides both.

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return (await readFile(file, 'utf8')).trim() || undefined
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return undefined
    throw e
  }
}

/** The MCP token; with `create`, a new one is stored when none exists yet. */
export async function mcpToken({ create = false, dir = defaultDataDir() } = {}): Promise<string | undefined> {
  if (process.env.COLWERK_MCP_TOKEN) return process.env.COLWERK_MCP_TOKEN
  const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
  if (process.env.DBM_KEYCHAIN !== 'off') {
    const secrets = keychain(dir, 'mcp')
    try {
      const stored = await secrets.get()
      if (stored || !create) return stored
      const token = fresh()
      await secrets.set(token)
      return token
    } catch (e) {
      if (!(e instanceof KeychainUnavailable)) throw e
    }
  }
  const file = join(dir, 'mcp-token')
  const stored = await readOptional(file)
  if (stored || !create) return stored
  const token = fresh()
  await mkdir(dir, { recursive: true })
  await writeFile(file, token, { mode: 0o600 })
  await chmod(file, 0o600)
  return token
}
