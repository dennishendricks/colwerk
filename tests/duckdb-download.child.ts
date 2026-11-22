// One start of the packaged app for tests/duckdb-download.test.ts, in a process of its own: a process loads DuckDB's
// addon only once (and Windows locks it while loaded). Sets up DuckDB like launcher/main.ts, then either installs and
// queries it (`start`) or installs from a tampered download (`tampered`). Prints one JSON line.
import { duckdbGlobals } from '../launcher/native.ts'
import { duckdbManifest } from '../scripts/duckdb-manifest.ts'

const mode = process.argv[2]
const manifest = await duckdbManifest()

// Counts the downloads of the package; `tampered` flips one byte of it.
let downloads = 0
const realFetch = globalThis.fetch
globalThis.fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    const res = await realFetch(input, init)
    if ((input instanceof Request ? input.url : String(input)) !== manifest.tarball) return res
    downloads++
    if (mode !== 'tampered') return res
    const bytes = await res.bytes()
    const i = bytes.length >> 1
    bytes[i] = bytes[i]! ^ 0xff
    return new Response(bytes, { status: res.status, headers: res.headers })
  },
  { preconnect: realFetch.preconnect },
)

Object.assign(globalThis, duckdbGlobals(manifest))
const { installDriver, loadDriver } = await import('../core/registry.ts')

if (mode === 'tampered') {
  const error = await installDriver('duckdb').then(
    () => undefined,
    (e: Error) => e.message,
  )
  console.log(JSON.stringify({ downloads, error }))
} else {
  await installDriver('duckdb')
  const driver = await loadDriver('duckdb')
  const session = await driver.connect({ id: 'e2e', name: 'e2e', dialect: 'duckdb', file: ':memory:' })
  const { resultSets } = await session.execute('select 42 as answer', { rowLimit: 1 })
  await session.close()
  console.log(JSON.stringify({ downloads, value: resultSets[0]?.rows[0]?.[0] }))
}
// DuckDB's instance cache would keep the process alive.
process.exit(0)
