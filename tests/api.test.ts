// End-to-end tests of the Nitro layer against the production build (`.output`, created by
// `bun run compile` / `bun run desktop` or `bun --bun nuxt build`). Skipped without a build.
import { afterAll, beforeAll, describe, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { assert, assertEquals, assertStringIncludes } from './assert.ts'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { freePort } from '../launcher/common.ts'
import { reachable, tempDir, testConnections } from './helpers.ts'

const built = await stat('.output/server/index.mjs').then(
  () => true,
  () => false,
)
const pgUp = await reachable(testConnections.postgres)

async function rawStatus(port: number, host: string, token: string): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: { data: (_, data) => resolve(data.toString()), error: (_, e) => reject(e) },
  })
  socket.write(`GET /api/drivers HTTP/1.1\r\nHost: ${host}\r\nx-colwerk-token: ${token}\r\nConnection: close\r\n\r\n`)
  const status = Number((await promise).split(' ')[1])
  socket.end()
  return status
}

describe.skipIf(!built)('api: security and end-to-end flow', () => {
  const token = 'a'.repeat(64)
  const mcpToken = 'c'.repeat(64)
  let port: number
  let base: string
  let dataDir: string
  let server: Bun.Subprocess

  const call = (path: string, init: RequestInit = {}, headers: Record<string, string> = { 'x-colwerk-token': token }) =>
    fetch(base + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...headers, ...(init.headers as Record<string, string>) },
    })
  const json = async (res: Response) => {
    const body = await res.json()
    assert(res.ok, `${res.status} ${JSON.stringify(body)}`)
    return body
  }

  beforeAll(async () => {
    port = await freePort()
    base = `http://127.0.0.1:${port}`
    dataDir = await tempDir()
    // The build only exports the request listener (preset `node-listener`); launcher/main.ts serves it in the app.
    const serve = `import { createServer } from 'node:http'
      const { listener } = await import('${pathToFileURL(resolve('.output/server/index.mjs'))}')
      createServer(listener).listen(${port}, '127.0.0.1')`
    server = Bun.spawn([process.execPath, '-e', serve], {
      // Without keychain: no entries in the developer's keychain, and the key file can be checked.
      env: {
        ...process.env,
        COLWERK_TOKEN: token,
        COLWERK_MCP_TOKEN: mcpToken,
        COLWERK_DATA_DIR: dataDir,
        COLWERK_KEYCHAIN: 'off',
      },
      stdout: 'ignore',
      stderr: 'ignore',
    })
    for (let i = 0; i < 100; i++) {
      if (
        await fetch(base).then(
          (r) => (r.body?.cancel(), true),
          () => false,
        )
      )
        break
      await new Promise((r) => setTimeout(r, 100))
    }
  })

  afterAll(async () => {
    server?.kill()
    await server?.exited
    if (dataDir) await rm(dataDir, { recursive: true })
  })

  test('rejects requests without valid token, foreign host or origin', async () => {
    const statuses = await Promise.all(
      [
        call('/api/drivers', {}, {}),
        call('/api/drivers', {}, { 'x-colwerk-token': 'b'.repeat(64) }),
        call('/api/drivers', {}, { 'x-colwerk-token': token, origin: 'http://evil.example' }),
      ].map((p) => p.then((r) => (r.body?.cancel(), r.status))),
    )
    assertEquals(statuses, [401, 401, 403])
    // fetch() always sends the real Host header, so DNS rebinding is simulated with a raw request.
    assertEquals(await rawStatus(port, `evil.example:${port}`, token), 403)
    assertEquals(await rawStatus(port, `127.0.0.1:${port}`, token), 200)
    const ok = await call('/api/drivers', {}, { 'x-colwerk-token': token, origin: base })
    assertEquals((await json(ok)).length, 5)
  })

  test('serves the SPA shell without token', async () => {
    const res = await fetch(base)
    assertEquals(res.status, 200)
    assertStringIncludes(await res.text(), 'id="__nuxt"')
  })

  test('saves and restores the open tabs', async () => {
    assertEquals(await json(await call('/api/workspace')), { tabs: [] })
    const workspace = {
      tabs: [{ id: 't1', title: 'Abfrage 1', sql: 'select 1', rowLimit: 200, timeout: 60 }],
      activeTabId: 't1',
    }
    await json(await call('/api/workspace', { method: 'POST', body: JSON.stringify(workspace) }))
    assertEquals(await json(await call('/api/workspace')), workspace)
    const bad = await call('/api/workspace', { method: 'POST', body: '{}' })
    assertEquals((bad.body?.cancel(), bad.status), 400)
  })

  test('writes and reads query files', async () => {
    const path = `${dataDir}/query.sql`
    await json(await call('/api/files/write', { method: 'POST', body: JSON.stringify({ path, sql: 'select 1;\n' }) }))
    assertEquals(await json(await call('/api/files/read', { method: 'POST', body: JSON.stringify({ path }) })), {
      sql: 'select 1;\n',
    })
    const statuses = await Promise.all(
      [
        call('/api/files/read', { method: 'POST', body: JSON.stringify({ path: 'query.sql' }) }),
        call('/api/files/read', { method: 'POST', body: JSON.stringify({ path: `${dataDir}/missing.sql` }) }),
        call('/api/files/write', { method: 'POST', body: JSON.stringify({ path }) }),
      ].map((p) => p.then((r) => (r.body?.cancel(), r.status))),
    )
    assertEquals(statuses, [400, 400, 400])
  })

  describe.skipIf(!pgUp)('postgres', () => {
    const pg = testConnections.postgres
    let saved: { id: string; hasPassword: boolean }

    beforeAll(async () => {
      saved = await json(
        await call('/api/connections', {
          method: 'POST',
          body: JSON.stringify({ ...pg, id: undefined, name: 'Local PG' }),
        }),
      )
    })

    test('connection test reports driver errors', async () => {
      const bad = await call('/api/connections/test', {
        method: 'POST',
        body: JSON.stringify({ ...pg, password: 'wrong' }),
      })
      assertEquals(bad.status, 400)
      assertStringIncludes((await bad.json()).message, 'password authentication failed')
      await json(await call('/api/connections/test', { method: 'POST', body: JSON.stringify(pg) }))
    })

    test('rejects logins the driver does not offer and incomplete service principals', async () => {
      const windows = await call('/api/connections/test', {
        method: 'POST',
        body: JSON.stringify({ ...pg, auth: 'windows' }),
      })
      assertEquals(windows.status, 400)
      const sp = await call('/api/connections/test', {
        method: 'POST',
        body: JSON.stringify({ ...pg, auth: 'entra-service-principal', tenantId: 't' }),
      })
      assertEquals(sp.status, 400)
      assertEquals((await sp.json()).data.key, 'servicePrincipalRequired')
    })

    test('stores the password encrypted and never returns it', async () => {
      assertEquals(saved.hasPassword, true)
      assertEquals('password' in saved, false)
      const file = await readFile(`${dataDir}/connections.json`, 'utf8')
      assertEquals(file.includes('"password":'), false)
      assertStringIncludes(file, '"passwordEnc": "v1:')
      if (process.platform !== 'win32') {
        assertEquals((await stat(`${dataDir}/secret.key`)).mode! & 0o777, 0o600)
        assertEquals((await stat(`${dataDir}/connections.json`)).mode! & 0o777, 0o600)
      }
      // Saving without password keeps the stored one.
      await json(
        await call('/api/connections', {
          method: 'POST',
          body: JSON.stringify({ ...pg, id: saved.id, name: 'Renamed', password: undefined }),
        }),
      )
      await json(
        await call('/api/connections/test', {
          method: 'POST',
          body: JSON.stringify({ ...pg, id: saved.id, password: undefined }),
        }),
      )
    })

    test('introspection', async () => {
      const cols = await json(
        await call(`/api/connections/${saved.id}/introspect`, {
          method: 'POST',
          body: JSON.stringify({ request: { kind: 'columns', schema: 'sales', table: 'orders' } }),
        }),
      )
      assertEquals(cols.find((c: { name: string }) => c.name === 'customer_id').references.table, 'customers')
    })

    test('execute keeps a session per tab and honours the row limit', async () => {
      const exec = (tab: string, sql: string, rowLimit = 10) =>
        call(`/api/tabs/${tab}/execute`, {
          method: 'POST',
          body: JSON.stringify({ connectionId: saved.id, sql, rowLimit }),
        })
      const r = (await json(await exec('t1', 'select * from sales.orders', 50))).resultSets[0]
      assertEquals(r.rows.length, 50)
      assertEquals(r.truncated, true)
      await json(await exec('t1', 'create temp table x as select 1 as a'))
      assertEquals((await json(await exec('t1', 'select a from x'))).resultSets[0].rows, [[1]])
      // Another tab has its own session and does not see the temp table. The error carries the transaction state.
      assertEquals((await json(await exec('t2', 'begin'))).transaction, 'open')
      const other = await exec('t2', 'select a from x')
      assertEquals(other.status, 400)
      assertEquals((await other.json()).data.transaction, 'failed')
      assertEquals((await json(await exec('t2', 'rollback'))).transaction, 'idle')
    })

    test('history records executes, newest first, including failed ones', async () => {
      const history = await json(await call('/api/history'))
      // The failed run in t2 is kept next to the identical query from t1: `begin` ran in between.
      assertEquals(
        history.map((e: { sql: string }) => e.sql),
        [
          'rollback',
          'select a from x',
          'begin',
          'select a from x',
          'create temp table x as select 1 as a',
          'select * from sales.orders',
        ],
      )
      assertStringIncludes(history[1].error, 'x')
      assertEquals(history[5].rowCount, 50)
      await json(await call('/api/history', { method: 'DELETE' }))
      assertEquals(await json(await call('/api/history')), [])
    })

    test('export writes the full result or the shown rows to the given path', async () => {
      const dir = await tempDir()
      const exportTo = (name: string, body: object) =>
        call('/api/tabs/t1/export', { method: 'POST', body: JSON.stringify({ path: `${dir}/${name}`, ...body }) })
      // Full result in the tab's session (sees its temp table), without row limit.
      await json(
        await exportTo('full.csv', {
          format: 'csv',
          connectionId: saved.id,
          sql: 'select o.id, x.a from sales.orders o cross join x',
        }),
      )
      const lines = new TextDecoder('utf-8', { ignoreBOM: true })
        .decode(await readFile(`${dir}/full.csv`))
        .trimEnd()
        .split('\r\n')
      assertEquals(lines.length, 50_001)
      assertEquals(lines[0], '\uFEFF"id";"a"')

      await json(
        await exportTo('shown.parquet', {
          format: 'parquet',
          columns: [{ name: 'n', type: 'integer' }],
          rows: [[1], [2]],
        }),
      )
      const parquet = await readFile(`${dir}/shown.parquet`)
      assertEquals(new TextDecoder().decode(parquet.subarray(0, 4)), 'PAR1')

      // Statement errors are reported, and no file is left behind.
      const bad = await exportTo('bad.csv', { format: 'csv', connectionId: saved.id, sql: 'select * from nope' })
      assertEquals(bad.status, 400)
      assertStringIncludes((await bad.json()).message, 'nope')
      const relative = await call('/api/tabs/t1/export', {
        method: 'POST',
        body: JSON.stringify({ format: 'csv', path: 'x.csv', columns: [], rows: [] }),
      })
      assertEquals(relative.status, 400)
      await relative.body?.cancel()

      // Running the statement again must not repeat side effects: only single read-only statements.
      for (const sql of ['insert into x values (2) returning a', 'select 1; select a from x']) {
        const refused = await exportTo('refused.csv', { format: 'csv', connectionId: saved.id, sql })
        assertEquals(refused.status, 400)
        assertStringIncludes((await refused.json()).message, 'read-only')
      }
      const count = await call('/api/tabs/t1/execute', {
        method: 'POST',
        body: JSON.stringify({ connectionId: saved.id, sql: 'select count(*)::int as n from x' }),
      })
      assertEquals((await json(count)).resultSets[0].rows, [[1]])

      // The cancel button aborts a running export; an existing file at the target stays untouched.
      await writeFile(`${dir}/big.parquet`, 'old')
      const running = exportTo('big.parquet', {
        format: 'parquet',
        connectionId: saved.id,
        sql: 'select a.id from sales.orders a cross join sales.orders b',
      })
      await new Promise((r) => setTimeout(r, 300))
      await json(await call('/api/tabs/t1/cancel', { method: 'POST' }))
      const outcome = await running
      assertEquals(outcome.status, 400)
      assertStringIncludes((await outcome.json()).message, 'cancel')
      assertEquals(await readFile(`${dir}/big.parquet`, 'utf8'), 'old')
      assertEquals(readdirSync(dir).sort(), ['big.parquet', 'full.csv', 'shown.parquet'])
      assertEquals(
        (
          await json(
            await call('/api/tabs/t1/execute', {
              method: 'POST',
              body: JSON.stringify({ connectionId: saved.id, sql: 'select 1 as x' }),
            }),
          )
        ).resultSets[0].rows,
        [[1]],
      )
      await rm(dir, { recursive: true })
    })

    test('mcp: requires the MCP token, reads, refuses writes, opens queries in the editor', async () => {
      let id = 0
      const mcp = async (
        method: string,
        params: object,
        headers: Record<string, string> = { authorization: `Bearer ${mcpToken}` },
      ) => {
        const res = await call(
          '/mcp',
          {
            method: 'POST',
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          },
          { accept: 'application/json, text/event-stream', ...headers },
        )
        return { status: res.status, body: res.ok ? await res.json() : await res.body?.cancel() }
      }
      const tool = async (name: string, args: object) => {
        const { result } = (await mcp('tools/call', { name, arguments: args })).body
        return { error: result.isError === true, text: result.content[0].text as string }
      }
      // The MCP token only: neither none nor the UI's session token is enough.
      assertEquals((await mcp('tools/list', {}, {})).status, 401)
      assertEquals(
        (await mcp('tools/list', {}, { 'x-colwerk-token': token, authorization: `Bearer ${token}` })).status,
        401,
      )
      const { tools } = (await mcp('tools/list', {})).body.result
      assertEquals(tools.map((x: { name: string }) => x.name).sort(), [
        'describe-table',
        'list-connections',
        'list-schemas',
        'list-tables',
        'open-query',
        'run-query',
        'sample-rows',
      ])

      const { connections } = JSON.parse((await tool('list-connections', {})).text)
      assertEquals(connections[0].connectionId, saved.id)
      assertEquals(connections[0].status, 'connected')
      const result = JSON.parse(
        (
          await tool('run-query', {
            connectionId: saved.id,
            sql: 'select id from sales.orders order by id',
            limit: 2,
          })
        ).text,
      )
      assertEquals(result.rows, [['1'], ['2']])
      assertEquals(result.truncated, true)
      // Refused by the text check, and by the read-only transaction where the text check cannot tell.
      for (const sql of ['delete from sales.orders', `select nextval('sales.orders_id_seq')`]) {
        assertEquals((await tool('run-query', { connectionId: saved.id, sql })).error, true, sql)
      }

      assertStringIncludes(
        (await tool('open-query', { connectionId: saved.id, sql: 'select 1' })).text,
        'No Colwerk editor window',
      )
      const events = await call('/api/events')
      const reader = events.body!.pipeThrough(new TextDecoderStream()).getReader()
      assertEquals(
        (await tool('open-query', { connectionId: saved.id, sql: 'select 1', description: 'Why' })).error,
        false,
      )
      await reader.read() // ': connected'
      assertStringIncludes((await reader.read()).value!, '"sql":"-- Why\\nselect 1"')
      await reader.cancel()

      // A browser login is never started for an MCP client.
      const entra = await json(
        await call('/api/connections', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Azure',
            dialect: 'mssql',
            host: 'example.database.windows.net',
            auth: 'entra-interactive',
          }),
        }),
      )
      const denied = await tool('run-query', { connectionId: entra.id, sql: 'select 1' })
      assertEquals(denied.error, true)
      assertStringIncludes(denied.text, 'Microsoft Entra sign-in required')
      await json(await call(`/api/connections/${entra.id}`, { method: 'DELETE' }))
    })

    test('cancel aborts a running statement', async () => {
      const running = call('/api/tabs/t3/execute', {
        method: 'POST',
        body: JSON.stringify({ connectionId: saved.id, sql: 'select pg_sleep(30)' }),
      })
      await new Promise((r) => setTimeout(r, 500))
      await json(await call('/api/tabs/t3/cancel', { method: 'POST' }))
      const res = await running
      assertEquals(res.status, 400)
      assertStringIncludes((await res.json()).message, 'cancel')
    })

    test('closing a tab and deleting a connection', async () => {
      await json(await call('/api/tabs/t1', { method: 'DELETE' }))
      await json(await call(`/api/connections/${saved.id}`, { method: 'DELETE' }))
      assertEquals(await json(await call('/api/connections')), [])
    })
  })
})
