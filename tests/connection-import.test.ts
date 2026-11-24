import { test } from 'bun:test'
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { assertEquals, assertRejects } from './assert.ts'
import { tempDir } from './helpers.ts'
import type { ConnectionSummary } from '../core/store.ts'
import { AppError } from '../core/types.ts'
import { DBEAVER_CREDENTIALS_KEY } from '../core/connection-import/dbeaver.ts'
import { BEEKEEPER_DEFAULT_KEY } from '../core/connection-import/beekeeper.ts'
import { importPaths, previewImport, readImport, sameConnection } from '../core/connection-import/index.ts'

const fixtures = join(import.meta.dir, 'fixtures', 'connection-import')
const fixture = (name: string) => join(fixtures, name)

const byKey = (result: Awaited<ReturnType<typeof readImport>>, key: string) =>
  result.candidates.find((c) => c.key === key)!

test('pgpass: lines, escapes, wildcards, sockets', async () => {
  const result = await readImport('pgpass', fixture('pgpass'))
  assertEquals(
    result.candidates.map((c) => [c.key, c.config, c.notes]),
    [
      [
        'line-2',
        {
          name: 'alice@db.example.com:5432/sales',
          dialect: 'postgres',
          host: 'db.example.com',
          port: 5432,
          database: 'sales',
          user: 'alice',
          password: 'p@ss:word\\x',
        },
        [],
      ],
      [
        'line-4',
        {
          name: 'alice@db.example.com/*',
          dialect: 'postgres',
          host: 'db.example.com',
          user: 'alice',
          password: 'any-db',
        },
        [],
      ],
      [
        'line-5',
        {
          name: '*@reports.example.com:5433/reports',
          dialect: 'postgres',
          host: 'reports.example.com',
          port: 5433,
          database: 'reports',
          password: 'any-user',
        },
        [{ key: 'wildcard', params: { field: 'user' } }],
      ],
      [
        'line-6',
        {
          name: 'bob@/var/run/postgresql/app',
          dialect: 'postgres',
          socket: '/var/run/postgresql',
          database: 'app',
          user: 'bob',
          password: 'socket-pw',
        },
        [],
      ],
      [
        'line-7',
        {
          name: 'alice@db.example.com:5432/sales',
          dialect: 'postgres',
          host: 'db.example.com',
          port: 5432,
          database: 'sales',
          user: 'alice',
          password: 'p@ss:word\\x',
        },
        [],
      ],
    ],
  )
  assertEquals(result.skipped, [
    { name: 'alice@*:5432/sales', note: { key: 'wildcard', params: { field: 'host' } } },
    { name: 'line 8', note: { key: 'noHost' } },
  ])
})

test('dbt: engines, templates and authentication', async () => {
  const result = await readImport('dbt', fixture('profiles.yml'))
  assertEquals(
    result.candidates.map((c) => c.key),
    ['analytics/dev', 'analytics/prod', 'warehouse/sql', 'warehouse/local'],
  )
  assertEquals(byKey(result, 'analytics/dev').config, {
    name: 'analytics (dev)',
    dialect: 'postgres',
    host: 'localhost',
    port: 5432,
    user: 'dbt',
    password: 'secret',
    database: 'analytics',
    searchPath: 'dbt_dev',
    ssl: true,
  })
  const prod = byKey(result, 'analytics/prod')
  assertEquals(prod.config.password, undefined)
  assertEquals(prod.notes, [{ key: 'envVar', params: { field: 'password', variable: 'DBT_PASSWORD' } }])
  assertEquals(byKey(result, 'warehouse/sql').config, {
    name: 'warehouse (sql)',
    dialect: 'mssql',
    host: 'sql.example.com',
    port: 1433,
    database: 'dw',
    auth: 'entra-service-principal',
    tenantId: 'tenant-1',
    clientId: 'client-1',
    password: 'shh',
    ssl: true,
    sslInsecure: false,
  })
  const local = byKey(result, 'warehouse/local')
  assertEquals(local.config, { name: 'warehouse (local)', dialect: 'duckdb', file: 'data/dw.duckdb' })
  assertEquals(local.notes, [{ key: 'relativePath', params: { path: 'data/dw.duckdb' } }])
  assertEquals(result.skipped, [
    { name: 'warehouse (bq)', note: { key: 'unsupportedEngine', params: { engine: 'bigquery' } } },
  ])
})

test('Azure Data Studio: comments, trailing commas, groups, authentication', async () => {
  const result = await readImport('ads', fixture('ads-settings.json'))
  assertEquals(
    result.candidates.map((c) => c.key),
    ['sql-login', 'integrated', 'mfa', 'pg'],
  )
  assertEquals(byKey(result, 'sql-login').config, {
    name: 'Orders /* EU */',
    folder: 'Prod/EU',
    dialect: 'mssql',
    host: 'db.example.com',
    port: 1444,
    database: 'orders',
    user: 'sa',
    ssl: true,
    sslStrict: true,
    sslInsecure: false,
    sslServerName: 'db.example.com',
    readOnlyIntent: true,
    multiSubnetFailover: true,
    connectRetries: 5,
  })
  assertEquals(byKey(result, 'sql-login').notes, [{ key: 'passwordElsewhere' }])
  const integrated = byKey(result, 'integrated')
  assertEquals(integrated.config.host, 'host1')
  assertEquals(integrated.config.instanceName, 'SQLEXPRESS')
  assertEquals(integrated.config.auth, 'windows')
  // Trust Server Certificate without Encrypt: the server enforces encryption, so TLS is turned on.
  assertEquals([integrated.config.ssl, integrated.config.sslInsecure], [true, true])
  assertEquals(integrated.config.folder, undefined)
  assertEquals(integrated.notes, [{ key: 'windowsLogin' }])
  const mfa = byKey(result, 'mfa').config
  assertEquals([mfa.auth, mfa.tenantId, mfa.user, mfa.ssl], ['entra-interactive', 'tenant-9', 'me@example.com', true])
  assertEquals(byKey(result, 'pg').config, {
    name: 'pg.example.com',
    dialect: 'postgres',
    host: 'pg.example.com',
    port: 5433,
    database: 'app',
    user: 'pguser',
    ssl: true,
  })
  assertEquals(result.skipped, [{ name: 'My', note: { key: 'unsupportedEngine', params: { engine: 'MYSQL' } } }])
})

// DBeaver encrypts like the app does: AES-128-CBC with the IV in front of the ciphertext.
function encryptDbeaver(plain: string): Buffer {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-128-cbc', DBEAVER_CREDENTIALS_KEY, iv)
  return Buffer.concat([iv, cipher.update(plain, 'utf8'), cipher.final()])
}

test('DBeaver: dialects, decrypted credentials, SSH, folders', async () => {
  const dir = await tempDir()
  try {
    await copyFile(fixture('dbeaver/data-sources.json'), join(dir, 'data-sources.json'))
    await writeFile(
      join(dir, 'credentials-config.json'),
      encryptDbeaver(await readFile(fixture('dbeaver/credentials.json'), 'utf8')),
    )
    const result = await readImport('dbeaver', join(dir, 'data-sources.json'))
    assertEquals(
      result.candidates.map((c) => c.key),
      ['pg-1', 'maria-1', 'ms-1', 'sqlite-1'],
    )
    const pg = byKey(result, 'pg-1')
    assertEquals(pg.config, {
      name: 'Postgres via SSH',
      folder: 'Prod/EU',
      dialect: 'postgres',
      host: 'db.internal',
      port: 5432,
      database: 'sales',
      user: 'pg-user',
      password: 'pg-secret',
      color: 'red',
      confirmWrites: true,
      ssh: true,
      sshHost: 'bastion.example.com',
      sshPort: 2222,
      sshUser: 'tunnel-user',
      sshAuth: 'password',
      sshSecret: 'tunnel-secret',
    })
    assertEquals(pg.notes, [{ key: 'sshJumpHost' }])
    const maria = byKey(result, 'maria-1')
    assertEquals([maria.config.dialect, maria.config.user, maria.config.password], ['mysql', 'plain-user', 'plain-pw'])
    const ms = byKey(result, 'ms-1').config
    assertEquals([ms.auth, ms.domain, ms.user, ms.password], ['windows', 'CORP', 'svc', 'ms-secret'])
    assertEquals(byKey(result, 'sqlite-1').config, {
      name: 'Local SQLite',
      dialect: 'sqlite',
      file: '/data/app.sqlite',
    })
    assertEquals(result.skipped, [
      { name: 'Oracle', note: { key: 'unsupportedEngine', params: { engine: 'oracle/oracle_thin' } } },
    ])

    // A credentials file that cannot be decrypted is reported on every connection.
    await writeFile(join(dir, 'credentials-config.json'), 'garbage garbage garbage')
    const failed = await readImport('dbeaver', join(dir, 'data-sources.json'))
    assertEquals(
      failed.candidates.map((c) => c.notes.some((n) => n.key === 'decryptFailed')),
      [true, true, true, true],
    )
    assertEquals(byKey(failed, 'pg-1').config.password, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Mirrors the format of the simple-encryptor package, which Beekeeper Studio uses.
function simpleEncrypt(value: unknown, key: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', createHash('sha256').update(key).digest(), iv)
  const encrypted = cipher.update(JSON.stringify(value), 'utf8', 'base64') + cipher.final('base64')
  const hmac = createHmac('sha256', key)
    .update(iv.toString('hex') + encrypted)
    .digest('hex')
  return hmac + iv.toString('hex') + encrypted
}

test('Beekeeper Studio: mapping, decrypted secrets, original untouched', async () => {
  const dir = await tempDir()
  try {
    const file = join(dir, 'app.db')
    const db = new DatabaseSync(file)
    db.exec(await readFile(fixture('beekeeper/schema.sql'), 'utf8'))
    const key = 'user-specific-key'
    const set = db.prepare('UPDATE saved_connection SET password = ?, sshKeyfilePassword = ? WHERE id = 1')
    set.run(simpleEncrypt('bk-secret', key), simpleEncrypt('key-pass', key))
    db.close()
    await writeFile(join(dir, '.key'), simpleEncrypt({ encryptionKey: key }, BEEKEEPER_DEFAULT_KEY))
    const before = await readFile(file)

    const result = await readImport('beekeeper', file)
    assertEquals(
      result.candidates.map((c) => c.key),
      ['bk-1', 'bk-2', 'bk-3'],
    )
    assertEquals(byKey(result, 'bk-1').config, {
      name: 'PG via key',
      folder: 'Work/Databases',
      dialect: 'postgres',
      host: 'pg.example.com',
      port: 5432,
      user: 'bkuser',
      database: 'shop',
      password: 'bk-secret',
      ssl: true,
      sslInsecure: false,
      ssh: true,
      sshHost: 'jump.example.com',
      sshPort: 22,
      sshUser: 'ssh-user',
      sshAuth: 'key',
      sshKeyFile: '/home/u/.ssh/id_ed25519',
      sshSecret: 'key-pass',
      confirmWrites: true,
      color: 'green',
    })
    assertEquals(byKey(result, 'bk-1').notes, [{ key: 'sshJumpHost' }])
    const ms = byKey(result, 'bk-2').config
    assertEquals([ms.dialect, ms.auth, ms.domain, ms.user], ['mssql', 'windows', 'CORP', 'svc'])
    // Trust Server Certificate without SSL: the server enforces encryption, so TLS is turned on.
    assertEquals([ms.ssl, ms.sslInsecure], [true, true])
    assertEquals(byKey(result, 'bk-3').config, { name: 'Local file', dialect: 'sqlite', file: '/data/local.db' })
    assertEquals(result.skipped, [
      { name: 'Redshift', note: { key: 'unsupportedEngine', params: { engine: 'redshift' } } },
    ])
    assertEquals(await readFile(file), before)

    // Without the key file the encrypted columns cannot be read.
    await rm(join(dir, '.key'))
    const noKey = await readImport('beekeeper', file)
    assertEquals(byKey(noKey, 'bk-1').notes, [{ key: 'sshJumpHost' }, { key: 'decryptFailed' }])
    assertEquals(byKey(noKey, 'bk-1').config.password, undefined)
    assertEquals(byKey(noKey, 'bk-2').notes, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('previewImport marks duplicates and never includes secrets', async () => {
  const result = await readImport('pgpass', fixture('pgpass'))
  const existing = [
    {
      id: 'x',
      name: 'Existing',
      dialect: 'postgres',
      host: 'DB.example.com',
      database: 'sales',
      user: 'ALICE',
      hasPassword: false,
      hasSshSecret: false,
      hasMcpPassword: false,
    },
  ] satisfies ConnectionSummary[]
  const preview = previewImport(result, existing, '/p')
  // Port 5432 is the default, so `alice@db.example.com/sales` is the existing connection; line 4 has another database.
  assertEquals(
    preview.items.map((i) => [i.key, i.duplicate]),
    [
      ['line-2', 'Existing'],
      ['line-4', undefined],
      ['line-5', undefined],
      ['line-6', undefined],
      ['line-7', 'Existing'],
    ],
  )
  const repeat = previewImport(result, [], '/p')
  assertEquals(repeat.items[4]!.duplicate, 'alice@db.example.com:5432/sales')
  assertEquals(repeat.items[0]!.connection.hasPassword, true)
  assertEquals(JSON.stringify(repeat).includes('socket-pw'), false)
  assertEquals(JSON.stringify(repeat).includes('p@ss'), false)
})

test('sameConnection compares files, or server, database, login and instance', () => {
  const pg = { dialect: 'postgres', host: 'H', database: 'd', user: 'U' } as const
  assertEquals(sameConnection(pg, { ...pg, host: 'h', port: 5432, user: 'u' }), true)
  assertEquals(sameConnection(pg, { ...pg, port: 5433 }), false)
  assertEquals(sameConnection(pg, { ...pg, dialect: 'mysql' }), false)
  assertEquals(
    sameConnection({ dialect: 'mssql', host: 'h', instanceName: 'a' }, { dialect: 'mssql', host: 'h' }),
    false,
  )
  assertEquals(sameConnection({ dialect: 'sqlite', file: '/a.db' }, { dialect: 'sqlite', file: '/a.db' }), true)
  assertEquals(sameConnection({ dialect: 'sqlite', file: '/a.db' }, { dialect: 'sqlite', file: '/b.db' }), false)
})

test('importPaths: default locations per platform', () => {
  const home = '/home/u'
  assertEquals(importPaths('ads', 'win32', { APPDATA: 'C:\\U\\AppData\\Roaming' }, 'C:\\U'), [
    'C:\\U\\AppData\\Roaming\\azuredatastudio\\User\\settings.json',
  ])
  assertEquals(importPaths('ads', 'darwin', {}, home), [
    `${home}/Library/Application Support/azuredatastudio/User/settings.json`,
  ])
  assertEquals(importPaths('ads', 'linux', { XDG_CONFIG_HOME: '/cfg' }, home), [
    '/cfg/azuredatastudio/User/settings.json',
  ])
  assertEquals(importPaths('dbeaver', 'darwin', {}, home), [
    `${home}/Library/DBeaverData/workspace6/General/.dbeaver/data-sources.json`,
  ])
  assertEquals(importPaths('dbeaver', 'linux', {}, home), [
    `${home}/.local/share/DBeaverData/workspace6/General/.dbeaver/data-sources.json`,
    `${home}/.var/app/io.dbeaver.DBeaverCommunity/data/DBeaverData/workspace6/General/.dbeaver/data-sources.json`,
  ])
  assertEquals(importPaths('beekeeper', 'linux', {}, home).length, 3)
  assertEquals(importPaths('beekeeper', 'win32', {}, 'C:\\U'), ['C:\\U\\AppData\\Roaming\\beekeeper-studio\\app.db'])
  assertEquals(importPaths('pgpass', 'linux', { PGPASSFILE: '/x/pw' }, home), ['/x/pw'])
  assertEquals(importPaths('pgpass', 'linux', {}, home), [`${home}/.pgpass`])
  assertEquals(importPaths('pgpass', 'win32', { APPDATA: 'C:\\A' }, 'C:\\U'), ['C:\\A\\postgresql\\pgpass.conf'])
  assertEquals(importPaths('dbt', 'darwin', { DBT_PROFILES_DIR: '/p' }, home), [
    '/p/profiles.yml',
    `${home}/.dbt/profiles.yml`,
  ])
})

test('readImport reports missing and unreadable files', async () => {
  const dir = await tempDir()
  try {
    const missing = await assertRejects(() => readImport('pgpass', join(dir, 'nope')), AppError)
    assertEquals((missing as AppError).key, 'importNotFound')
    await writeFile(join(dir, 'broken.json'), '{ not json')
    const broken = await assertRejects(() => readImport('ads', join(dir, 'broken.json')), AppError)
    assertEquals((broken as AppError).key, 'importUnreadable')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
