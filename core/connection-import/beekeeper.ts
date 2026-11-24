import { Buffer } from 'node:buffer'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type ConnectionColor, connectionColors, type ConnectionConfig, type Dialect } from '../types.ts'
import type { ImportNote, ImportResult } from './index.ts'

// Key that Beekeeper Studio encrypts its `.key` file with (`defaultEncryptionKey`); that file holds the key
// for the passwords. From Beekeeper's source: apps/studio/src/common/encryption_key.ts
export const BEEKEEPER_DEFAULT_KEY = '38782F413F442A472D4B6150645367566B59703373367639792442264529482B'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

/**
 * Decrypts a value of the `simple-encryptor` npm package, which Beekeeper uses: 64 hex characters HMAC (not
 * checked), 32 hex characters IV, then the AES-256-CBC ciphertext in base64. The AES key is the SHA-256 of the
 * key string; the plaintext is JSON.
 */
export async function simpleDecrypt(value: string, key: string): Promise<unknown> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  const aes = await crypto.subtle.importKey('raw', hash, 'AES-CBC', false, ['decrypt'])
  const iv = Buffer.from(value.slice(64, 96), 'hex')
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aes, Buffer.from(value.slice(96), 'base64'))
  return JSON.parse(new TextDecoder().decode(plain))
}

const dialects: Record<string, Dialect> = {
  postgresql: 'postgres',
  postgres: 'postgres',
  psql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  sqlserver: 'mssql',
  mssql: 'mssql',
  sqlite: 'sqlite',
  duckdb: 'duckdb',
  clickhouse: 'clickhouse',
}

/** Reads the saved connections of Beekeeper Studio's `app.db`, working on a copy so that the original stays untouched. */
export async function readBeekeeper(file: string): Promise<ImportResult> {
  const dir = await mkdtemp(path.join(tmpdir(), 'colwerk-import-'))
  try {
    const copy = path.join(dir, 'app.db')
    await copyFile(file, copy)
    // Changes that are not yet written into the main file.
    await copyFile(`${file}-wal`, `${copy}-wal`).catch(() => undefined)
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(copy)
    let rows: Row[]
    let folderRows: Row[] = []
    try {
      rows = db.prepare('SELECT * FROM saved_connection ORDER BY id').all() as Row[]
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'connection_folder'").get()) {
        folderRows = db.prepare('SELECT id, name, parentId FROM connection_folder').all() as Row[]
      }
    } finally {
      db.close()
    }
    let secretKey: string | undefined
    try {
      const encrypted = await readFile(path.join(path.dirname(file), '.key'), 'utf8')
      const key = (await simpleDecrypt(encrypted.trim(), BEEKEEPER_DEFAULT_KEY)) as { encryptionKey: string }
      secretKey = key.encryptionKey
    } catch {
      // Without the key no secret can be read; the connections that have one say so below.
    }
    const folders = new Map(folderRows.map((f) => [f.id, f]))
    const folderOf = (id: unknown) => {
      const names: string[] = []
      for (let f = folders.get(id), n = 0; f && n < 20; f = folders.get(f.parentId), n++) names.unshift(String(f.name))
      return names.join('/') || undefined
    }
    const result: ImportResult = { candidates: [], skipped: [] }
    for (const r of rows) {
      const name = str(r.name) ?? `bk-${r.id}`
      const dialect = dialects[String(r.connectionType)]
      if (!dialect) {
        result.skipped.push({ name, note: { key: 'unsupportedEngine', params: { engine: String(r.connectionType) } } })
        continue
      }
      const notes: ImportNote[] = []
      let failed = false
      const secret = async (column: string) => {
        const value = str(r[column])
        if (!value) return undefined
        try {
          if (!secretKey) throw new Error('no key')
          return String(await simpleDecrypt(value, secretKey))
        } catch {
          failed = true
        }
      }
      const config: Omit<ConnectionConfig, 'id'> = { name, folder: folderOf(r.connectionFolderId), dialect }
      if (dialect === 'sqlite' || dialect === 'duckdb') {
        config.file = str(r.defaultDatabase)
        if (!config.file) {
          result.skipped.push({ name, note: { key: 'noHost' } })
          continue
        }
      } else {
        // Trusting the certificate only matters with encryption, which the server may enforce without SSL turned on.
        const trust = dialect === 'mssql' && !!r.trustServerCertificate
        const ssl = !!r.ssl || trust
        Object.assign(config, {
          host: r.socketPathEnabled ? undefined : str(r.host),
          socket: r.socketPathEnabled ? str(r.socketPath) : undefined,
          port: r.port ? Number(r.port) : undefined,
          user: str(r.username),
          database: str(r.defaultDatabase),
          password: await secret('password'),
          ssl,
          sslCa: str(r.sslCaFile),
          sslInsecure: trust || (ssl && r.sslRejectUnauthorized === 0),
        })
        if (!config.host && !config.socket) {
          result.skipped.push({ name, note: { key: 'noHost' } })
          continue
        }
        if (r.windowsAuthEnabled) Object.assign(config, { auth: 'windows', domain: str(r.domain) })
        try {
          const azure = JSON.parse(String(r.azureAuthOptions)) as { azureAuthEnabled?: boolean; tenantId?: string }
          if (azure.azureAuthEnabled) {
            Object.assign(config, { auth: 'entra-interactive', tenantId: azure.tenantId })
            notes.push({ key: 'authUnsupported', params: { auth: 'Azure' } })
          }
        } catch {
          // Not set in older versions.
        }
        if (str(r.sslCertFile) || str(r.sslKeyFile)) notes.push({ key: 'tlsCertificates' })
        if (r.sshEnabled) {
          const auth = r.sshMode === 'userpass' ? 'password' : r.sshMode === 'keyfile' ? 'key' : 'agent'
          Object.assign(config, {
            ssh: true,
            sshHost: str(r.sshHost),
            sshPort: r.sshPort ? Number(r.sshPort) : undefined,
            sshUser: str(r.sshUsername),
            sshAuth: auth,
            sshKeyFile: auth === 'key' ? str(r.sshKeyfile) : undefined,
            sshSecret:
              auth === 'agent' ? undefined : await secret(auth === 'key' ? 'sshKeyfilePassword' : 'sshPassword'),
          })
          if (str(r.sshBastionHost)) notes.push({ key: 'sshJumpHost' })
        }
      }
      if (r.readOnlyMode) config.confirmWrites = true
      if (connectionColors.includes(r.labelColor as ConnectionColor)) config.color = r.labelColor as ConnectionColor
      if (failed) notes.push({ key: 'decryptFailed' })
      result.candidates.push({ key: `bk-${r.id}`, config, notes })
    }
    return result
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
