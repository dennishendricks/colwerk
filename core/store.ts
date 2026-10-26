import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { type Keychain, keychain, KeychainUnavailable } from './keychain.ts'
import type { ConnectionConfig } from './types.ts'

/** Connection as returned to the UI: never contains the password. */
export type ConnectionSummary = Omit<ConnectionConfig, 'password'> & { hasPassword: boolean }

/**
 * `password: undefined` keeps the stored password, `''` removes it, any other string replaces it.
 */
export type ConnectionInput = ConnectionConfig

type StoredConnection = Omit<ConnectionConfig, 'password'> & { passwordEnc?: string }

// Storage in `defaultDataDir()` (overridable with DBM_DATA_DIR):
//   connections.json  – connection list, passwords AES-256-GCM encrypted
// The 256-bit key lives in the OS keychain (see keychain.ts). Without a usable keychain, or with
// DBM_KEYCHAIN=off, it lives next to the data in `secret.key` (file mode 0600), which only protects
// against accidental disclosure (backups, sync folders, screen sharing). A `secret.key` of an older
// version is moved into the keychain on first use.
export function defaultDataDir(): string {
  const env = process.env.DBM_DATA_DIR
  if (env) return env
  const home = homedir()
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'colwerk')
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'colwerk')
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'colwerk')
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

async function readKeyFile(file: string): Promise<string | undefined> {
  try {
    return (await readFile(file, 'utf8')).trim()
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return undefined
    throw e
  }
}

export class ConnectionStore {
  private key?: Promise<CryptoKey>
  private writing: Promise<unknown> = Promise.resolve()

  constructor(
    private dir = defaultDataDir(),
    private secrets: Keychain | null = process.env.DBM_KEYCHAIN === 'off' ? null : keychain(dir),
  ) {}

  async list(): Promise<ConnectionSummary[]> {
    return (await this.read()).map(({ passwordEnc, ...c }) => ({ ...c, hasPassword: !!passwordEnc }))
  }

  async get(id: string): Promise<ConnectionConfig> {
    const stored = (await this.read()).find(c => c.id === id)
    if (!stored) throw new Error(`Unknown connection: ${id}`)
    const { passwordEnc, ...config } = stored
    return { ...config, password: passwordEnc ? await this.decrypt(passwordEnc) : undefined }
  }

  /** Resolves a password-less input against the stored password (`undefined` = keep). */
  async resolve(input: ConnectionInput): Promise<ConnectionConfig> {
    if (input.password !== undefined) return input
    const existing = (await this.read()).find(c => c.id === input.id)
    return { ...input, password: existing?.passwordEnc ? await this.decrypt(existing.passwordEnc) : undefined }
  }

  save(input: ConnectionInput): Promise<void> {
    return this.mutate(async (all) => {
      const { password, ...config } = input
      const existing = all.find(c => c.id === input.id)
      const passwordEnc = password === undefined
        ? existing?.passwordEnc
        : password === '' ? undefined : await this.encrypt(password)
      const next: StoredConnection = { ...config, passwordEnc }
      return existing ? all.map(c => c.id === input.id ? next : c) : [...all, next]
    })
  }

  remove(id: string): Promise<void> {
    return this.mutate(async all => all.filter(c => c.id !== id))
  }

  private async read(): Promise<StoredConnection[]> {
    try {
      return JSON.parse(await readFile(join(this.dir, 'connections.json'), 'utf8'))
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return []
      throw e
    }
  }

  private mutate(fn: (all: StoredConnection[]) => Promise<StoredConnection[]>): Promise<void> {
    const run = this.writing.then(async () => {
      const next = await fn(await this.read())
      await mkdir(this.dir, { recursive: true })
      const file = join(this.dir, 'connections.json')
      const tmp = `${file}.${crypto.randomUUID()}.tmp`
      await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
      await rename(tmp, file)
    })
    this.writing = run.catch(() => {})
    return run
  }

  private cryptoKey(): Promise<CryptoKey> {
    if (!this.key) {
      this.key = (async () => {
        const raw = unb64(await this.secret())
        return crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt'])
      })()
      // E.g. keychain access denied: ask again on the next call.
      this.key.catch(() => (this.key = undefined))
    }
    return this.key
  }

  /** The key (base64): from the keychain, otherwise from `secret.key`; created on first use. */
  private async secret(): Promise<string> {
    const file = join(this.dir, 'secret.key')
    if (this.secrets) {
      try {
        const stored = await this.secrets.get()
        if (stored) return stored
        const secret = await readKeyFile(file) ?? b64(crypto.getRandomValues(new Uint8Array(32)))
        await this.secrets.set(secret)
        if (await this.secrets.get() !== secret) throw new Error('Keychain: the stored key could not be read back')
        await rm(file, { force: true })
        return secret
      } catch (e) {
        if (!(e instanceof KeychainUnavailable)) throw e
        console.warn(`OS keychain not available (${e.message}), using ${file}`)
      }
    }
    const existing = await readKeyFile(file)
    if (existing) return existing
    const secret = b64(crypto.getRandomValues(new Uint8Array(32)))
    await mkdir(this.dir, { recursive: true })
    await writeFile(file, secret, { mode: 0o600, flag: 'wx' })
    await chmod(file, 0o600)
    return secret
  }

  private async encrypt(plain: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.cryptoKey(), new TextEncoder().encode(plain))
    return `v1:${b64(iv)}:${b64(new Uint8Array(data))}`
  }

  private async decrypt(enc: string): Promise<string> {
    const [version, iv, data] = enc.split(':')
    if (version !== 'v1' || !iv || !data) throw new Error('Unsupported password encoding')
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await this.cryptoKey(), unb64(data))
    return new TextDecoder().decode(plain)
  }
}
