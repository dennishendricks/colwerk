import { test } from 'bun:test'
import { rm, stat } from 'node:fs/promises'
import { tempDir } from './helpers.ts'
import { assertEquals, assertRejects } from './assert.ts'
import { type Keychain, KeychainUnavailable } from '../core/keychain.ts'
import { ConnectionStore } from '../core/store.ts'
import type { ConnectionConfig } from '../core/types.ts'

class FakeKeychain implements Keychain {
  value?: string
  constructor(private error?: Error) {}
  async get() {
    if (this.error) throw this.error
    return this.value
  }

  async set(secret: string) {
    this.value = secret
  }
}

const conn: ConnectionConfig = { id: 'c1', name: 'c', dialect: 'postgres', password: 'geheim' }
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  )

async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await tempDir()
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true })
  }
}

test('store: a new key goes into the keychain, no key file', () =>
  withDir(async (dir) => {
    const chain = new FakeKeychain()
    await new ConnectionStore(dir, chain).save(conn)
    assertEquals(typeof chain.value, 'string')
    assertEquals(await exists(`${dir}/secret.key`), false)
    assertEquals((await new ConnectionStore(dir, chain).get('c1')).password, 'geheim')
  }))

test('store: an existing key file moves into the keychain', () =>
  withDir(async (dir) => {
    await new ConnectionStore(dir, null).save(conn)
    assertEquals(await exists(`${dir}/secret.key`), true)
    const chain = new FakeKeychain()
    assertEquals((await new ConnectionStore(dir, chain).get('c1')).password, 'geheim')
    assertEquals(await exists(`${dir}/secret.key`), false)
    assertEquals((await new ConnectionStore(dir, chain).get('c1')).password, 'geheim')
  }))

test('store: without keychain the key file is used; other keychain errors surface', () =>
  withDir(async (dir) => {
    await new ConnectionStore(dir, new FakeKeychain(new KeychainUnavailable('no secret service'))).save(conn)
    assertEquals(await exists(`${dir}/secret.key`), true)
    assertEquals((await new ConnectionStore(dir, null).get('c1')).password, 'geheim')
    await assertRejects(
      () => new ConnectionStore(dir, new FakeKeychain(new Error('access denied'))).get('c1'),
      Error,
      'access denied',
    )
  }))

test('store: an empty password removes the stored one, undefined keeps it', () =>
  withDir(async (dir) => {
    const store = new ConnectionStore(dir, new FakeKeychain())
    await store.save(conn)
    await store.save({ ...conn, password: undefined })
    assertEquals((await store.list())[0]!.hasPassword, true)
    await store.save({ ...conn, password: '' })
    assertEquals((await store.list())[0]!.hasPassword, false)
  }))

test('store: color and write confirmation reach the summary', () =>
  withDir(async (dir) => {
    const store = new ConnectionStore(dir, new FakeKeychain())
    await store.save({ ...conn, color: 'red', confirmWrites: true })
    const [summary] = await store.list()
    assertEquals([summary!.color, summary!.confirmWrites], ['red', true])
  }))
