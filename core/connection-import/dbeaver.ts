import { Buffer } from 'node:buffer'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ConnectionConfig, Dialect } from '../types.ts'
import type { ImportNote, ImportResult } from './index.ts'

// DBeaver encrypts credentials-config.json with a key built into the application: AES-128-CBC, the IV in front
// of the ciphertext. Key (`LOCAL_KEY_CACHE`) and format are from DBeaver's source:
// plugins/org.jkiss.dbeaver.model/src/org/jkiss/dbeaver/model/impl/app/BaseProjectImpl.java and DefaultValueEncryptor.java.
export const DBEAVER_CREDENTIALS_KEY = Buffer.from('babb4a9f774ab853c96c2d653dfe544a', 'hex')

type Json = Record<string, unknown>
type Credentials = Record<string, Record<string, Record<string, string>>>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {})
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

/**
 * Decrypts the content of `credentials-config.json`: per connection id the sections `#connection` and
 * `network/<handler id>`, each with `user` and `password`.
 */
export async function decryptDbeaverCredentials(bytes: Uint8Array): Promise<Credentials> {
  const key = await crypto.subtle.importKey('raw', DBEAVER_CREDENTIALS_KEY, 'AES-CBC', false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: bytes.slice(0, 16) }, key, bytes.slice(16))
  return JSON.parse(new TextDecoder().decode(plain))
}

const dialects: Record<string, Dialect> = {
  postgresql: 'postgres',
  mysql: 'mysql',
  sqlserver: 'mssql',
  mssql: 'mssql',
  clickhouse: 'clickhouse',
}

/** Reads the connections of `data-sources.json`, the other `data-sources*.json` files next to it and `credentials-config.json`. */
export async function readDbeaver(file: string): Promise<ImportResult> {
  const dir = path.dirname(file)
  const names = new Set([path.basename(file)])
  for (const f of await readdir(dir).catch(() => [])) if (/^data-sources.*\.json$/.test(f)) names.add(f)
  const connections: Record<string, Json> = {}
  for (const name of names) {
    const text = await readFile(path.join(dir, name), 'utf8')
    for (const [id, c] of Object.entries(obj(obj(JSON.parse(text)).connections))) connections[id] ??= obj(c)
  }
  let credentials: Credentials = {}
  let decryptFailed = false
  try {
    credentials = await decryptDbeaverCredentials(await readFile(path.join(dir, 'credentials-config.json')))
  } catch (e) {
    decryptFailed = (e as { code?: string }).code !== 'ENOENT'
  }
  const result: ImportResult = { candidates: [], skipped: [] }
  for (const [id, c] of Object.entries(connections)) {
    const cfg = obj(c.configuration)
    const name = str(c.name) ?? id
    const driver = String(c.driver ?? '')
    const provider = String(c.provider ?? '')
    const url = str(cfg.url)
    const dialect: Dialect | undefined = /sqlite/i.test(driver)
      ? 'sqlite'
      : /duckdb/i.test(driver)
        ? 'duckdb'
        : dialects[provider]
    if (!dialect) {
      result.skipped.push({ name, note: { key: 'unsupportedEngine', params: { engine: `${provider}/${driver}` } } })
      continue
    }
    const notes: ImportNote[] = decryptFailed ? [{ key: 'decryptFailed' }] : []
    if (dialect === 'sqlite' || dialect === 'duckdb') {
      const file = str(cfg.database) ?? url?.match(/^jdbc:(?:sqlite|duckdb):(.+)$/)?.[1]
      if (file) result.candidates.push({ key: id, config: { name, folder: str(c.folder), dialect, file }, notes })
      else result.skipped.push({ name, note: { key: 'noHost' } })
      continue
    }
    const jdbc = url?.match(/^jdbc:[\w:]+:\/\/([^:/;?]+)(?::(\d+))?(?:\/([^?;]*))?/)
    const host = str(cfg.host) ?? jdbc?.[1]
    if (!host) {
      result.skipped.push({ name, note: { key: 'noHost' } })
      continue
    }
    const port = str(cfg.port) ?? jdbc?.[2]
    const own = credentials[id]?.['#connection']
    const config: Omit<ConnectionConfig, 'id'> = {
      name,
      folder: str(c.folder),
      dialect,
      host,
      port: port ? Number(port) : undefined,
      database: str(cfg.database) ?? str(jdbc?.[3]),
      user: str(own?.user) ?? str(cfg.user),
      password: str(own?.password) ?? str(cfg.password),
    }
    if (!config.password && config.user && !decryptFailed) notes.push({ key: 'passwordElsewhere' })
    const model = String(cfg['auth-model'] ?? 'native').toLowerCase()
    if (dialect === 'mssql' && /ntlm|windows/.test(model)) {
      config.auth = 'windows'
      const [domain, user] = config.user?.split('\\') ?? []
      if (user !== undefined) Object.assign(config, { domain, user })
    } else if (dialect === 'mssql' && /azure|entra|(^|[_-])ad([_-]|$)/.test(model)) {
      config.auth = /msi|integrated|default/.test(model) ? 'entra-default' : 'entra-interactive'
    } else if (model !== 'native') notes.push({ key: 'authUnsupported', params: { auth: model } })
    if (cfg.type === 'prod') Object.assign(config, { color: 'red', confirmWrites: true })
    for (const [handler, h] of Object.entries(obj(cfg.handlers))) {
      const hc = obj(h)
      if (hc.enabled !== true) continue
      const props = obj(hc.properties)
      if (handler === 'ssh_tunnel') {
        const secrets = credentials[id]?.['network/ssh_tunnel']
        const authType = String(props.authType ?? 'PASSWORD')
        const auth = { PASSWORD: 'password', PUBLIC_KEY: 'key', AGENT: 'agent' }[authType] as
          'password' | 'key' | 'agent' | undefined
        if (!auth) notes.push({ key: 'options', params: { options: `SSH ${authType}` } })
        else {
          Object.assign(config, {
            ssh: true,
            sshHost: str(props.host),
            sshPort: props.port ? Number(props.port) : undefined,
            sshUser: str(secrets?.user) ?? str(hc.user),
            sshAuth: auth,
            sshKeyFile: auth === 'key' ? str(props.keyPath) : undefined,
            sshSecret: auth === 'agent' ? undefined : (str(secrets?.password) ?? str(hc.password)),
          })
          if (Object.keys(props).some((k) => k.startsWith('jump'))) notes.push({ key: 'sshJumpHost' })
        }
      } else if (handler.includes('ssl')) {
        config.ssl = true
        notes.push({ key: 'tlsOptions' })
      } else notes.push({ key: 'options', params: { options: handler } })
    }
    result.candidates.push({ key: id, config, notes })
  }
  return result
}
