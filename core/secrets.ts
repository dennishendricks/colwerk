// Reads secrets through the CLIs of password managers (1Password, Bitwarden, KeePassXC). Their arguments name only
// the reference, and the secret is read from stdout. The CLIs are spawned without a shell. Unlock secrets go through
// stdin or the environment, never as arguments. Resolved values and unlock secrets live in memory only.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import process from 'node:process'
import { AppError, type ConnectionConfig, type SecretRef, secretProviders } from './types.ts'

export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a CLI without shell; injectable for tests. */
export type CliRunner = (
  cli: string,
  args: string[],
  options?: { input?: string; env?: Record<string, string> },
) => Promise<CliResult>

const NAMES: Record<SecretRef['provider'], string> = {
  '1password': '1Password',
  bitwarden: 'Bitwarden',
  'bitwarden-sm': 'Bitwarden Secrets Manager',
  keepassxc: 'KeePassXC',
}

// 1Password may wait for the user to confirm in its app.
const TIMEOUT_MS = 120_000

// GUI apps on macOS start without the shell's PATH, so the usual install locations are searched as well.
const EXTRA_DIRS =
  process.platform === 'win32'
    ? [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'KeePassXC')]
    : ['/opt/homebrew/bin', '/usr/local/bin', '/Applications/KeePassXC.app/Contents/MacOS']

function locate(cli: string): string | undefined {
  const file = cli + (process.platform === 'win32' ? '.exe' : '')
  const dirs = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_DIRS]
  return dirs.map((dir) => join(dir, file)).find((path) => existsSync(path))
}

const missing = (cli: string) =>
  new AppError('secretCliMissing', `${cli} not found: install it and make sure it is on the PATH`, { params: { cli } })

export const runCli: CliRunner = (cli, args, options) =>
  new Promise((resolve, reject) => {
    const path = locate(cli)
    if (!path) return reject(missing(cli))
    const child = spawn(path, args, { windowsHide: true, env: { ...process.env, ...options?.env } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(
        new AppError('secretFailed', `${cli}: no answer within 120 s`, {
          params: { name: cli, detail: 'no answer within 120 s' },
        }),
      )
    }, TIMEOUT_MS)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject((e as { code?: string }).code === 'ENOENT' ? missing(cli) : e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    // A CLI that exits without reading stdin must not crash the server.
    child.stdin.on('error', () => {})
    child.stdin.end(options?.input ?? '')
  })

const expand = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

const invalidRef = () => new AppError('invalidSecretRef', 'Invalid secret reference')

/** The secret reference of a request body, a new object with only the known keys, trimmed; throws `invalidSecretRef` if it is incomplete or unsafe. */
export function parseSecretRef(value: unknown): SecretRef | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'object') throw invalidRef()
  const v = value as Record<string, unknown>
  const provider = v.provider as SecretRef['provider']
  if (!secretProviders.includes(provider)) throw invalidRef()
  const text = (k: string) => (typeof v[k] === 'string' ? (v[k] as string).trim() : '')
  const required = (k: string) => {
    const t = text(k)
    // A leading dash would be taken as an option by the CLI.
    if (!t || t.startsWith('-')) throw invalidRef()
    return t
  }
  const optional = (k: string) => (text(k) ? required(k) : undefined)
  const only = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as T
  switch (provider) {
    case '1password': {
      const reference = required('reference')
      if (!/^op:\/\/[^/]+\/[^/]+\/.+/.test(reference)) throw invalidRef()
      return { provider, reference }
    }
    case 'bitwarden':
      return only({ provider, item: required('item'), field: optional('field') })
    case 'bitwarden-sm':
      return { provider, secretId: required('secretId') }
    case 'keepassxc':
      return only({
        provider,
        database: required('database'),
        entry: required('entry'),
        attribute: optional('attribute'),
        keyFile: optional('keyFile'),
      })
  }
}

/** The reference in words for error messages; contains no secret. */
function describe(ref: SecretRef): string {
  switch (ref.provider) {
    case '1password':
      return ref.reference
    case 'bitwarden':
      return `item ${ref.item} field ${ref.field ?? 'password'}`
    case 'bitwarden-sm':
      return `secret ${ref.secretId}`
    case 'keepassxc':
      return `${ref.database} entry ${ref.entry} attribute ${ref.attribute ?? 'Password'}`
  }
}

/** First line of the CLI's message, cut to 300 characters. */
const detail = (r: CliResult) =>
  ((r.stderr.trim() || (r.code !== 0 ? r.stdout.trim() : '')).split('\n')[0] ?? '').slice(0, 300) || 'unknown error'

const locked = (ref: SecretRef) =>
  new AppError('secretLocked', `${NAMES[ref.provider]} is locked: unlock it in Colwerk.`, {
    params: {
      provider: ref.provider,
      name: NAMES[ref.provider],
      database: ref.provider === 'keepassxc' ? expand(ref.database) : '',
      keyFile: ref.provider === 'keepassxc' && ref.keyFile ? expand(ref.keyFile) : '',
    },
  })

const notFound = (ref: SecretRef) =>
  new AppError('secretNotFound', `${NAMES[ref.provider]}: ${describe(ref)} not found.`, {
    params: { name: NAMES[ref.provider], reference: describe(ref) },
  })

const failed = (ref: SecretRef, r: CliResult) =>
  new AppError('secretFailed', `${NAMES[ref.provider]}: ${detail(r)}`, {
    params: { name: NAMES[ref.provider], detail: detail(r) },
  })

const unlockFailed = (provider: SecretRef['provider'], r: CliResult) =>
  new AppError('secretUnlockFailed', `${NAMES[provider]} could not be unlocked: ${detail(r)}`, {
    params: { name: NAMES[provider], detail: detail(r) },
  })

export function createSecrets(run: CliRunner = runCli) {
  let bwSession: string | undefined
  let bwsToken: string | undefined
  const keepass = new Map<string, string>() // master password per database file
  const pending = new Map<string, Promise<string>>()

  /** Arguments and stdin for keepassxc-cli: the master password goes in on stdin. */
  function keepassAuth(keyFile: string | undefined, password: string) {
    return {
      args: [...(keyFile ? ['-k', expand(keyFile)] : []), ...(password === '' ? ['--no-password'] : [])],
      input: password === '' ? '' : `${password}\n`,
    }
  }

  async function read(ref: SecretRef): Promise<string> {
    switch (ref.provider) {
      case '1password': {
        const r = await run('op', ['read', '--no-newline', ref.reference])
        if (r.code === 0) return r.stdout
        const err = r.stderr
        if (
          /not (currently )?signed in|sign ?in|no accounts? (configured|found)|authorization|locked|session (has )?expired/i.test(
            err,
          )
        ) {
          throw new AppError('opSignedOut', '1Password is locked or not signed in.')
        }
        if (/isn't an? (item|vault|field)|could not find|not found|no item/i.test(err)) throw notFound(ref)
        throw failed(ref, r)
      }
      case 'bitwarden': {
        const r = await run('bw', ['get', 'item', ref.item, '--nointeraction'], {
          env: bwSession ? { BW_SESSION: bwSession } : undefined,
        })
        if (r.code !== 0) {
          const err = r.stderr || r.stdout
          if (/vault is locked/i.test(err)) {
            bwSession = undefined
            throw locked(ref)
          }
          if (/not logged in/i.test(err)) {
            throw new AppError('bwSignedOut', 'The Bitwarden CLI is not logged in: run bw login.')
          }
          if (/^not found/im.test(err)) throw notFound(ref)
          throw failed(ref, r)
        }
        let item: {
          login?: { username?: unknown; password?: unknown }
          notes?: unknown
          fields?: { name?: unknown; value?: unknown }[]
        }
        try {
          item = JSON.parse(r.stdout)
        } catch {
          throw failed(ref, { code: 0, stdout: '', stderr: 'unexpected output of bw' })
        }
        const field = ref.field ?? 'password'
        const value =
          field === 'password'
            ? item.login?.password
            : field === 'username'
              ? item.login?.username
              : field === 'notes'
                ? item.notes
                : item.fields?.find((f) => f.name === field)?.value
        if (typeof value !== 'string') throw notFound(ref)
        return value
      }
      case 'bitwarden-sm': {
        const r = await run('bws', ['secret', 'get', ref.secretId, '--output', 'json'], {
          env: bwsToken ? { BWS_ACCESS_TOKEN: bwsToken } : undefined,
        })
        if (r.code !== 0) {
          if (/access token/i.test(r.stderr)) {
            bwsToken = undefined
            throw locked(ref)
          }
          if (/not found|404/i.test(r.stderr)) throw notFound(ref)
          throw failed(ref, r)
        }
        let value: unknown
        try {
          value = JSON.parse(r.stdout).value
        } catch {
          // Handled below.
        }
        if (typeof value !== 'string') throw failed(ref, { code: 0, stdout: '', stderr: 'unexpected output of bws' })
        return value
      }
      case 'keepassxc': {
        const db = expand(ref.database)
        const password = keepass.get(db)
        if (password === undefined) throw locked(ref)
        const auth = keepassAuth(ref.keyFile, password)
        const r = await run(
          'keepassxc-cli',
          ['show', '-q', '-s', '-a', ref.attribute ?? 'Password', ...auth.args, db, ref.entry],
          { input: auth.input },
        )
        if (r.code === 0) return r.stdout.replace(/\r?\n$/, '')
        if (/invalid credentials|wrong password|HMAC/i.test(r.stderr)) {
          keepass.delete(db)
          throw locked(ref)
        }
        if (/could not find entry|unknown attribute|no attribute/i.test(r.stderr)) throw notFound(ref)
        throw failed(ref, r)
      }
    }
  }

  /** The secret behind `ref`; concurrent requests for the same reference share one CLI call. */
  function resolve(ref: SecretRef): Promise<string> {
    const key = JSON.stringify(ref)
    let promise = pending.get(key)
    if (!promise) {
      promise = read(ref).finally(() => pending.delete(key))
      pending.set(key, promise)
    }
    return promise
  }

  return {
    resolve,
    /** A copy of `config` with the references replaced by their secrets; `config` itself stays untouched. */
    async resolveConfig(config: ConnectionConfig): Promise<ConnectionConfig> {
      if (!config.passwordRef && !config.sshSecretRef) return config
      const [password, sshSecret] = await Promise.all([
        config.passwordRef ? resolve(config.passwordRef) : config.password,
        config.sshSecretRef ? resolve(config.sshSecretRef) : config.sshSecret,
      ])
      return { ...config, password, sshSecret }
    },
    /** Keeps the master password, session or token of a password manager in memory until Colwerk quits. */
    async unlock(request: {
      provider: 'bitwarden' | 'bitwarden-sm' | 'keepassxc'
      database?: string
      keyFile?: string
      secret: string
    }): Promise<void> {
      const { provider, secret } = request
      if (provider === 'bitwarden') {
        const r = await run('bw', ['unlock', '--passwordenv', 'COLWERK_BW_PASSWORD', '--raw', '--nointeraction'], {
          env: { COLWERK_BW_PASSWORD: secret },
        })
        if (r.code !== 0 || !r.stdout.trim()) throw unlockFailed(provider, r)
        bwSession = r.stdout.trim()
        // Once after unlock so the local copy is current; a failure only means the copy may be stale.
        await run('bw', ['sync', '--nointeraction'], { env: { BW_SESSION: bwSession } }).catch(() => {})
      } else if (provider === 'bitwarden-sm') {
        bwsToken = secret.trim()
      } else {
        const db = expand(request.database ?? '')
        const auth = keepassAuth(request.keyFile, secret)
        const r = await run('keepassxc-cli', ['db-info', '-q', ...auth.args, db], { input: auth.input })
        if (r.code !== 0) throw unlockFailed(provider, r)
        keepass.set(db, secret)
      }
    },
  }
}

/** The process-wide resolver: unlocked vaults stay unlocked until Colwerk quits. */
export const secrets = createSecrets()
