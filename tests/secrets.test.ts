import { describe, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { assert, assertEquals, assertRejects } from './assert.ts'
import { type CliResult, type CliRunner, createSecrets, parseSecretRef, runCli } from '../core/secrets.ts'
import { AppError, type ConnectionConfig } from '../core/types.ts'

type Call = { cli: string; args: string[]; options?: { input?: string; env?: Record<string, string> } }

/** A runner that records its calls and answers with `reply(call)`. */
function fake(reply: (call: Call) => Partial<CliResult>) {
  const calls: Call[] = []
  const run: CliRunner = async (cli, args, options) => {
    const call = { cli, args, options }
    calls.push(call)
    return { code: 0, stdout: '', stderr: '', ...reply(call) }
  }
  return { calls, secrets: createSecrets(run) }
}
const fail = (stderr: string, stdout = '') => ({ code: 1, stdout, stderr })
const keyOf = async (p: Promise<unknown>) => ((await assertRejects(() => p, AppError)) as AppError).key

const op = { provider: '1password', reference: 'op://v/i/password' } as const
const bw = { provider: 'bitwarden', item: 'abc' } as const
const kp = { provider: 'keepassxc', database: '~/x.kdbx', entry: 'db' } as const

describe('parseSecretRef', () => {
  test('accepts every provider, trims values and drops unknown keys', () => {
    assertEquals(parseSecretRef({ provider: '1password', reference: ' op://v/i/f ', x: 1 }), {
      provider: '1password',
      reference: 'op://v/i/f',
    })
    assertEquals(parseSecretRef({ provider: 'bitwarden', item: ' a ', field: '' }), {
      provider: 'bitwarden',
      item: 'a',
    })
    assertEquals(parseSecretRef({ provider: 'bitwarden-sm', secretId: 's' }), {
      provider: 'bitwarden-sm',
      secretId: 's',
    })
    assertEquals(parseSecretRef({ provider: 'keepassxc', database: 'd', entry: 'e', attribute: 'a', keyFile: 'k' }), {
      provider: 'keepassxc',
      database: 'd',
      entry: 'e',
      attribute: 'a',
      keyFile: 'k',
    })
  })

  test('nothing means no reference', () => {
    for (const v of [undefined, null, '']) assertEquals(parseSecretRef(v), undefined)
  })

  test('rejects incomplete and unsafe references', () => {
    for (const v of [
      { provider: 'nope' },
      { provider: 'keepassxc', database: 'd' },
      { provider: 'bitwarden', item: '--help' },
      { provider: '1password', reference: 'op://vault' },
    ]) {
      let key: string | undefined
      try {
        parseSecretRef(v)
      } catch (e) {
        key = (e as AppError).key
      }
      assertEquals(key, 'invalidSecretRef')
    }
  })
})

describe('1Password', () => {
  test('reads the reference and returns stdout unchanged', async () => {
    const { calls, secrets } = fake(() => ({ stdout: ' pw ' }))
    assertEquals(await secrets.resolve(op), ' pw ')
    assertEquals(calls[0]!.cli, 'op')
    assertEquals(calls[0]!.args, ['read', '--no-newline', 'op://v/i/password'])
  })

  test('distinguishes signed out, not found and other errors', async () => {
    assertEquals(await keyOf(fake(() => fail('You are not currently signed in.')).secrets.resolve(op)), 'opSignedOut')
    assertEquals(
      await keyOf(fake(() => fail('"x" isn\'t an item in the "v" vault')).secrets.resolve(op)),
      'secretNotFound',
    )
    assertEquals(await keyOf(fake(() => fail('boom')).secrets.resolve(op)), 'secretFailed')
  })
})

describe('Bitwarden', () => {
  const item = JSON.stringify({
    login: { username: 'u', password: 'p' },
    notes: 'n',
    fields: [{ name: 'pg', value: 's' }],
  })

  test('picks the field', async () => {
    const { secrets } = fake(() => ({ stdout: item }))
    assertEquals(await secrets.resolve(bw), 'p')
    assertEquals(await secrets.resolve({ ...bw, field: 'username' }), 'u')
    assertEquals(await secrets.resolve({ ...bw, field: 'notes' }), 'n')
    assertEquals(await secrets.resolve({ ...bw, field: 'pg' }), 's')
    assertEquals(await keyOf(secrets.resolve({ ...bw, field: 'missing' })), 'secretNotFound')
  })

  test('distinguishes locked, logged out and not found', async () => {
    const locked = fake(() => fail('Vault is locked.'))
    const error = (await assertRejects(() => locked.secrets.resolve(bw), AppError)) as AppError
    assertEquals([error.key, error.params?.provider], ['secretLocked', 'bitwarden'])
    assertEquals(await keyOf(fake(() => fail('You are not logged in.')).secrets.resolve(bw)), 'bwSignedOut')
    assertEquals(await keyOf(fake(() => fail('Not found.')).secrets.resolve(bw)), 'secretNotFound')
  })

  test('unlock passes the password in the environment and keeps only the session', async () => {
    const { calls, secrets } = fake(({ args }) => ({ stdout: args[0] === 'unlock' ? 'session\n' : item }))
    await secrets.unlock({ provider: 'bitwarden', secret: 'master' })
    await secrets.resolve(bw)
    assertEquals(calls[0]!.options?.env, { COLWERK_BW_PASSWORD: 'master' })
    assert(calls.every((c) => !c.args.includes('master')))
    assertEquals(calls.at(-1)!.options?.env, { BW_SESSION: 'session' })
  })

  test('a failed unlock is reported', async () => {
    const { secrets } = fake(() => fail('Invalid master password.'))
    assertEquals(await keyOf(secrets.unlock({ provider: 'bitwarden', secret: 'x' })), 'secretUnlockFailed')
  })
})

describe('Bitwarden Secrets Manager', () => {
  const ref = { provider: 'bitwarden-sm', secretId: 'id' } as const

  test('uses the unlocked token', async () => {
    const { calls, secrets } = fake(() => ({ stdout: '{"value":"s"}' }))
    await secrets.unlock({ provider: 'bitwarden-sm', secret: 'tok' })
    assertEquals(await secrets.resolve(ref), 's')
    assertEquals(calls[0]!.options?.env, { BWS_ACCESS_TOKEN: 'tok' })
  })

  test('a missing token means locked', async () => {
    assertEquals(await keyOf(fake(() => fail('Missing access token')).secrets.resolve(ref)), 'secretLocked')
  })
})

describe('KeePassXC', () => {
  test('is locked until unlocked, without running the CLI', async () => {
    const { calls, secrets } = fake(() => ({}))
    const error = (await assertRejects(() => secrets.resolve(kp), AppError)) as AppError
    assertEquals([error.key, error.params?.database], ['secretLocked', join(homedir(), 'x.kdbx')])
    assertEquals(calls.length, 0)
  })

  test('the master password goes in on stdin only', async () => {
    const { calls, secrets } = fake(({ args }) => ({ stdout: args[0] === 'show' ? 'secret\n' : '' }))
    await secrets.unlock({ provider: 'keepassxc', database: kp.database, secret: 'pw' })
    assertEquals(calls[0]!.args[0], 'db-info')
    assertEquals(calls[0]!.options?.input, 'pw\n')
    assertEquals(await secrets.resolve(kp), 'secret')
    const show = calls[1]!
    assertEquals(show.options?.input, 'pw\n')
    assert(show.args.join(' ').includes('-a Password'))
    assert(!show.args.includes('pw'))
  })

  test('a key file with an empty password runs without password', async () => {
    const { calls, secrets } = fake(() => ({ stdout: 's' }))
    const ref = { ...kp, keyFile: '/k.key' }
    await secrets.unlock({ provider: 'keepassxc', database: kp.database, keyFile: ref.keyFile, secret: '' })
    await secrets.resolve(ref)
    const show = calls[1]!
    assert(show.args.includes('-k') && show.args.includes('--no-password'))
    assertEquals(show.options?.input, '')
  })

  test('wrong credentials lock it again', async () => {
    let wrong = false
    const { calls, secrets } = fake(({ args }) => (wrong && args[0] === 'show' ? fail('Invalid credentials') : {}))
    await secrets.unlock({ provider: 'keepassxc', database: kp.database, secret: 'pw' })
    wrong = true
    assertEquals(await keyOf(secrets.resolve(kp)), 'secretLocked')
    const before = calls.length
    assertEquals(await keyOf(secrets.resolve(kp)), 'secretLocked')
    assertEquals(calls.length, before)
  })
})

describe('resolveConfig', () => {
  const config: ConnectionConfig = { id: 'c', name: 'c', dialect: 'postgres', password: 'stored' }

  test('without references it returns the config and runs nothing', async () => {
    const { calls, secrets } = fake(() => ({}))
    assert((await secrets.resolveConfig(config)) === config)
    assertEquals(calls.length, 0)
  })

  test('replaces both references in a copy', async () => {
    const { secrets } = fake(({ cli }) => ({ stdout: cli === 'op' ? 'a' : '{"value":"b"}' }))
    const withRefs = { ...config, passwordRef: op, sshSecretRef: { provider: 'bitwarden-sm', secretId: 'i' } } as const
    const before = structuredClone(withRefs)
    const resolved = await secrets.resolveConfig(withRefs)
    assertEquals([resolved.password, resolved.sshSecret], ['a', 'b'])
    assertEquals(withRefs, before)
  })

  test('concurrent requests for one reference share a CLI call', async () => {
    const { calls, secrets } = fake(() => ({ stdout: 'a' }))
    await Promise.all([secrets.resolve(op), secrets.resolve(op)])
    assertEquals(calls.length, 1)
  })
})

test('runCli: a CLI that is not installed is reported', async () => {
  assertEquals(await keyOf(runCli('colwerk-no-such-cli', [])), 'secretCliMissing')
})
