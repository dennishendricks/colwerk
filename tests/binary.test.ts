// Smoke test of the compiled binary (`deno task compile`), which runs the server with its dependencies bundled by
// Rollup: bundling breaks CommonJS packages only at runtime, so every driver is loaded and queried once.
// Skipped without a build; the step of a database is skipped when it is not reachable.
import { assertEquals } from 'jsr:@std/assert@1'
import type { ConnectionConfig } from '../core/types.ts'
import { reachable, testConnections } from './helpers.ts'

const binary = `dist/colwerk${Deno.build.os === 'windows' ? '.exe' : ''}`
const built = await Deno.stat(binary).then(() => true, () => false)

Deno.test({ name: 'binary: every driver connects and queries', ignore: !built, sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const server = new Deno.Command(binary, {
    // Without PATH the launcher finds no browser to open.
    env: { PATH: '', COLWERK_DATA_DIR: await Deno.makeTempDir(), COLWERK_KEYCHAIN: 'off' },
    stdout: 'piped',
    stderr: 'null',
  }).spawn()

  try {
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
    const [, base, token] = match
    const call = async (path: string, body: object) => {
      const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-colwerk-token': token! }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`)
      return json
    }

    const duckdb: ConnectionConfig = { id: 'duck', name: 'duck', dialect: 'duckdb', file: ':memory:' }
    const sqlite: ConnectionConfig = { id: 'sqlite', name: 'sqlite', dialect: 'sqlite', file: ':memory:' }
    for (const config of [...Object.values(testConnections), duckdb, sqlite]) {
      await t.step({
        name: config.dialect,
        ignore: !!config.host && !(await reachable(config)),
        fn: async () => {
          // Downloads DuckDB's native library into the temporary data directory.
          if (config.dialect === 'duckdb') await call('/api/drivers/duckdb/install', {})
          const saved = await call('/api/connections', { ...config, id: undefined })
          await call(`/api/connections/${saved.id}/introspect`, { request: { kind: 'schemas' } })
          const { resultSets } = await call(`/api/tabs/${config.dialect}/execute`, { connectionId: saved.id, sql: 'select 1 as a' })
          assertEquals(resultSets[0].rows, [[1]])
        },
      })
    }
  } finally {
    server.kill()
    await server.status
  }
})
