// End-to-end tests of the Nitro layer against the production build (`.output`, created by
// `deno task compile` / `deno task desktop` or `deno run -A npm:nuxt build`). Skipped without a build.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { freePort } from '../launcher/common.ts'
import { reachable, testConnections } from './helpers.ts'

const built = await Deno.stat('.output/server/index.mjs').then(() => true, () => false)
const pgUp = await reachable(testConnections.postgres)

async function rawStatus(port: number, host: string, token: string): Promise<number> {
  const conn = await Deno.connect({ hostname: '127.0.0.1', port })
  await conn.write(new TextEncoder().encode(`GET /api/drivers HTTP/1.1\r\nHost: ${host}\r\nx-dbm-token: ${token}\r\nConnection: close\r\n\r\n`))
  const buf = new Uint8Array(64)
  const n = await conn.read(buf)
  conn.close()
  return Number(new TextDecoder().decode(buf.subarray(0, n ?? 0)).split(' ')[1])
}

Deno.test({ name: 'api: security and end-to-end flow', ignore: !built, sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const port = freePort()
  const token = 'a'.repeat(64)
  const mcpToken = 'c'.repeat(64)
  const dataDir = await Deno.makeTempDir()
  const server = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--config', '.output/deno.json', '--node-modules-dir=manual', '.output/server/index.mjs'],
    // Without keychain: no entries in the developer's keychain, and the key file can be checked.
    env: { DBM_TOKEN: token, COLWERK_MCP_TOKEN: mcpToken, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), DBM_DATA_DIR: dataDir, DBM_KEYCHAIN: 'off' },
    stdout: 'null',
    stderr: 'null',
  }).spawn()

  const base = `http://127.0.0.1:${port}`
  const call = (path: string, init: RequestInit = {}, headers: Record<string, string> = { 'x-dbm-token': token }) =>
    fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...headers, ...init.headers as Record<string, string> } })
  const json = async (res: Response) => {
    const body = await res.json()
    assert(res.ok, `${res.status} ${JSON.stringify(body)}`)
    return body
  }

  try {
    for (let i = 0; i < 100; i++) {
      if (await fetch(base).then(r => (r.body?.cancel(), true), () => false)) break
      await new Promise(r => setTimeout(r, 100))
    }

    await t.step('rejects requests without valid token, foreign host or origin', async () => {
      const statuses = await Promise.all([
        call('/api/drivers', {}, {}),
        call('/api/drivers', {}, { 'x-dbm-token': 'b'.repeat(64) }),
        call('/api/drivers', {}, { 'x-dbm-token': token, origin: 'http://evil.example' }),
      ].map(p => p.then(r => (r.body?.cancel(), r.status))))
      assertEquals(statuses, [401, 401, 403])
      // fetch() always sends the real Host header, so DNS rebinding is simulated with a raw request.
      assertEquals(await rawStatus(port, `evil.example:${port}`, token), 403)
      assertEquals(await rawStatus(port, `127.0.0.1:${port}`, token), 200)
      const ok = await call('/api/drivers', {}, { 'x-dbm-token': token, origin: base })
      assertEquals((await json(ok)).length, 4)
    })

    await t.step('serves the SPA shell without token', async () => {
      const res = await fetch(base)
      assertEquals(res.status, 200)
      assertStringIncludes(await res.text(), 'id="__nuxt"')
    })

    if (!pgUp) return
    const pg = testConnections.postgres

    await t.step('connection test reports driver errors', async () => {
      const bad = await call('/api/connections/test', { method: 'POST', body: JSON.stringify({ ...pg, password: 'wrong' }) })
      assertEquals(bad.status, 400)
      assertStringIncludes((await bad.json()).message, 'password authentication failed')
      await json(await call('/api/connections/test', { method: 'POST', body: JSON.stringify(pg) }))
    })

    const saved = await json(await call('/api/connections', { method: 'POST', body: JSON.stringify({ ...pg, id: undefined, name: 'Local PG' }) }))

    await t.step('stores the password encrypted and never returns it', async () => {
      assertEquals(saved.hasPassword, true)
      assertEquals('password' in saved, false)
      const file = await Deno.readTextFile(`${dataDir}/connections.json`)
      assertEquals(file.includes('"password"'), false)
      assertStringIncludes(file, '"passwordEnc": "v1:')
      if (Deno.build.os !== 'windows') {
        assertEquals((await Deno.stat(`${dataDir}/secret.key`)).mode! & 0o777, 0o600)
        assertEquals((await Deno.stat(`${dataDir}/connections.json`)).mode! & 0o777, 0o600)
      }
      // Saving without password keeps the stored one.
      await json(await call('/api/connections', { method: 'POST', body: JSON.stringify({ ...pg, id: saved.id, name: 'Renamed', password: undefined }) }))
      await json(await call('/api/connections/test', { method: 'POST', body: JSON.stringify({ ...pg, id: saved.id, password: undefined }) }))
    })

    await t.step('introspection', async () => {
      const cols = await json(await call(`/api/connections/${saved.id}/introspect`, {
        method: 'POST',
        body: JSON.stringify({ request: { kind: 'columns', schema: 'sales', table: 'orders' } }),
      }))
      assertEquals(cols.find((c: { name: string }) => c.name === 'customer_id').references.table, 'customers')
    })

    await t.step('execute keeps a session per tab and honours the row limit', async () => {
      const exec = (tab: string, sql: string, rowLimit = 10) =>
        call(`/api/tabs/${tab}/execute`, { method: 'POST', body: JSON.stringify({ connectionId: saved.id, sql, rowLimit }) })
      const r = (await json(await exec('t1', 'select * from sales.orders', 50))).resultSets[0]
      assertEquals(r.rows.length, 50)
      assertEquals(r.truncated, true)
      await json(await exec('t1', 'create temp table x as select 1 as a'))
      assertEquals((await json(await exec('t1', 'select a from x'))).resultSets[0].rows, [[1]])
      // Another tab has its own session and does not see the temp table.
      const other = await exec('t2', 'select a from x')
      assertEquals(other.status, 400)
      await other.body?.cancel()
    })

    await t.step('export writes the full result or the shown rows to the given path', async () => {
      const dir = await Deno.makeTempDir()
      const exportTo = (name: string, body: object) =>
        call('/api/tabs/t1/export', { method: 'POST', body: JSON.stringify({ path: `${dir}/${name}`, ...body }) })
      // Full result in the tab's session (sees its temp table), without row limit.
      await json(await exportTo('full.csv', { format: 'csv', connectionId: saved.id, sql: 'select o.id, x.a from sales.orders o cross join x' }))
      const lines = (await Deno.readTextFile(`${dir}/full.csv`)).trimEnd().split('\r\n')
      assertEquals(lines.length, 50_001)
      assertEquals(lines[0], 'id,a')

      await json(await exportTo('shown.parquet', { format: 'parquet', columns: [{ name: 'n', type: 'integer' }], rows: [[1], [2]] }))
      const parquet = await Deno.readFile(`${dir}/shown.parquet`)
      assertEquals(new TextDecoder().decode(parquet.subarray(0, 4)), 'PAR1')

      // Statement errors are reported, and no file is left behind.
      const bad = await exportTo('bad.csv', { format: 'csv', connectionId: saved.id, sql: 'select * from nope' })
      assertEquals(bad.status, 400)
      assertStringIncludes((await bad.json()).message, 'nope')
      const relative = await call('/api/tabs/t1/export', { method: 'POST', body: JSON.stringify({ format: 'csv', path: 'x.csv', columns: [], rows: [] }) })
      assertEquals(relative.status, 400)
      await relative.body?.cancel()

      // Running the statement again must not repeat side effects: only single read-only statements.
      for (const sql of ['insert into x values (2) returning a', 'select 1; select a from x']) {
        const refused = await exportTo('refused.csv', { format: 'csv', connectionId: saved.id, sql })
        assertEquals(refused.status, 400)
        assertStringIncludes((await refused.json()).message, 'read-only')
      }
      const count = await call('/api/tabs/t1/execute', { method: 'POST', body: JSON.stringify({ connectionId: saved.id, sql: 'select count(*)::int as n from x' }) })
      assertEquals((await json(count)).resultSets[0].rows, [[1]])

      // The cancel button aborts a running export; an existing file at the target stays untouched.
      await Deno.writeTextFile(`${dir}/big.parquet`, 'old')
      const running = exportTo('big.parquet', { format: 'parquet', connectionId: saved.id, sql: 'select a.id from sales.orders a cross join sales.orders b' })
      await new Promise(r => setTimeout(r, 300))
      await json(await call('/api/tabs/t1/cancel', { method: 'POST' }))
      const outcome = await running
      assertEquals(outcome.status, 400)
      assertStringIncludes((await outcome.json()).message, 'cancel')
      assertEquals(await Deno.readTextFile(`${dir}/big.parquet`), 'old')
      assertEquals([...Deno.readDirSync(dir)].map(e => e.name).sort(), ['big.parquet', 'full.csv', 'shown.parquet'])
      assertEquals((await json(await call('/api/tabs/t1/execute', { method: 'POST', body: JSON.stringify({ connectionId: saved.id, sql: 'select 1 as x' }) }))).resultSets[0].rows, [[1]])
      await Deno.remove(dir, { recursive: true })
    })

    await t.step('mcp: requires the MCP token, reads, refuses writes, opens queries in the editor', async () => {
      let id = 0
      const mcp = async (method: string, params: object, headers: Record<string, string> = { authorization: `Bearer ${mcpToken}` }) => {
        const res = await call('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }, { accept: 'application/json, text/event-stream', ...headers })
        return { status: res.status, body: res.ok ? await res.json() : await res.body?.cancel() }
      }
      const tool = async (name: string, args: object) => {
        const { result } = (await mcp('tools/call', { name, arguments: args })).body
        return { error: result.isError === true, text: result.content[0].text as string }
      }
      // The MCP token only: neither none nor the UI's session token is enough.
      assertEquals((await mcp('tools/list', {}, {})).status, 401)
      assertEquals((await mcp('tools/list', {}, { 'x-dbm-token': token, authorization: `Bearer ${token}` })).status, 401)
      const { tools } = (await mcp('tools/list', {})).body.result
      assertEquals(tools.map((x: { name: string }) => x.name).sort(), ['describe-table', 'list-connections', 'list-schemas', 'list-tables', 'open-query', 'run-query', 'sample-rows'])

      const { connections } = JSON.parse((await tool('list-connections', {})).text)
      assertEquals(connections[0].connectionId, saved.id)
      assertEquals(connections[0].status, 'connected')
      const result = JSON.parse((await tool('run-query', { connectionId: saved.id, sql: 'select id from sales.orders order by id', limit: 2 })).text)
      assertEquals(result.rows, [['1'], ['2']])
      assertEquals(result.truncated, true)
      // Refused by the text check, and by the read-only transaction where the text check cannot tell.
      for (const sql of ['delete from sales.orders', `select nextval('sales.orders_id_seq')`]) {
        assertEquals((await tool('run-query', { connectionId: saved.id, sql })).error, true, sql)
      }

      assertStringIncludes((await tool('open-query', { connectionId: saved.id, sql: 'select 1' })).text, 'No Colwerk editor window')
      const events = await call('/api/events')
      const reader = events.body!.pipeThrough(new TextDecoderStream()).getReader()
      assertEquals((await tool('open-query', { connectionId: saved.id, sql: 'select 1', description: 'Why' })).error, false)
      await reader.read() // ': connected'
      assertStringIncludes((await reader.read()).value!, '"sql":"-- Why\\nselect 1"')
      await reader.cancel()
    })

    await t.step('cancel aborts a running statement', async () => {
      const running = call('/api/tabs/t3/execute', { method: 'POST', body: JSON.stringify({ connectionId: saved.id, sql: 'select pg_sleep(30)' }) })
      await new Promise(r => setTimeout(r, 500))
      await json(await call('/api/tabs/t3/cancel', { method: 'POST' }))
      const res = await running
      assertEquals(res.status, 400)
      assertStringIncludes((await res.json()).message, 'cancel')
    })

    await t.step('closing a tab and deleting a connection', async () => {
      await json(await call('/api/tabs/t1', { method: 'DELETE' }))
      await json(await call(`/api/connections/${saved.id}`, { method: 'DELETE' }))
      assertEquals(await json(await call('/api/connections')), [])
    })
  } finally {
    server.kill()
    await server.status
    await Deno.remove(dataDir, { recursive: true })
  }
})
