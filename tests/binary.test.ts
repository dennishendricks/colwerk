// Smoke test of the compiled binary (`bun run compile`), which runs the server with its dependencies bundled by
// Rollup: bundling breaks CommonJS packages only at runtime, so every driver is loaded and queried once.
// Skipped without a build; the test of a database is skipped when it is not reachable.
import { afterAll, beforeAll, describe, test } from 'bun:test'
import { stat } from 'node:fs/promises'
import { assertEquals } from './assert.ts'
import type { ConnectionConfig } from '../core/types.ts'
import { reachable, tempDir, testConnections } from './helpers.ts'

// COLWERK_BINARY: another build of the same executable, e.g. the sidecar of `bun run desktop` in the release.
const binary = process.env.COLWERK_BINARY ?? `dist/colwerk${process.platform === 'win32' ? '.exe' : ''}`
const built = await stat(binary).then(
  () => true,
  () => false,
)
const duckdb: ConnectionConfig = { id: 'duck', name: 'duck', dialect: 'duckdb', file: ':memory:' }
const sqlite: ConnectionConfig = { id: 'sqlite', name: 'sqlite', dialect: 'sqlite', file: ':memory:' }
const configs = [...Object.values(testConnections), duckdb, sqlite]
const up = await Promise.all(configs.map((c) => !c.host || reachable(c)))

describe.skipIf(!built)('binary: every driver connects and queries', () => {
  let server: Bun.Subprocess<'ignore', 'pipe', 'ignore'>
  let base: string
  let token: string
  const call = async (path: string, body: object) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-colwerk-token': token },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`)
    return json
  }

  beforeAll(async () => {
    server = Bun.spawn([binary], {
      // Without PATH the launcher finds no browser to open.
      env: { ...process.env, PATH: '', COLWERK_DATA_DIR: await tempDir(), COLWERK_KEYCHAIN: 'off' },
      stdout: 'pipe',
      stderr: 'ignore',
    })
    // The launcher prints the URL with the session token once the server listens.
    const reader = server.stdout.pipeThrough(new TextDecoderStream()).getReader()
    let out = ''
    let match: RegExpMatchArray | null = null
    while (!match) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`binary exited: ${out}`)
      out += value
      match = out.match(/(http:\/\/127\.0\.0\.1:\d+)\/#token=(\w+)/)
    }
    reader.releaseLock()
    ;[, base, token] = match as [string, string, string]
  })

  afterAll(async () => {
    server?.kill()
    await server?.exited
  })

  configs.forEach((config, i) => {
    test.skipIf(!up[i])(config.dialect, async () => {
      // Downloads DuckDB's native library into the temporary data directory.
      if (config.dialect === 'duckdb') await call('/api/drivers/duckdb/install', {})
      const saved = await call('/api/connections', { ...config, id: undefined })
      await call(`/api/connections/${saved.id}/introspect`, { request: { kind: 'schemas' } })
      const { resultSets } = await call(`/api/tabs/${config.dialect}/execute`, {
        connectionId: saved.id,
        sql: 'select 1 as a',
      })
      assertEquals(resultSets[0].rows, [[1]])
    })
  })
})
