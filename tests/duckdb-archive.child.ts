// One start of the packaged app for tests/duckdb-archive.test.ts, in a process of its own: a process loads DuckDB's
// addon only once (and Windows locks it while loaded). Sets up DuckDB like launcher/main.ts from the archive and
// manifest given as arguments, then installs and queries it. Prints one JSON line.
import { readFile } from 'node:fs/promises'
import { duckdbGlobals } from '../launcher/native.ts'

const [file, manifest] = process.argv.slice(2) as [string, string]
const globals = duckdbGlobals(JSON.parse(await readFile(manifest, 'utf8')), file)
const unpacked = !(await globals.colwerkDuckdb.installed())
Object.assign(globalThis, globals)
// Like launcher/main.ts: the start unpacks in the background, the driver's first use waits for the same run.
void globals.colwerkDuckdb.install().catch(() => {})
const { loadDriver } = await import('../core/registry.ts')

try {
  const driver = await loadDriver('duckdb')
  const session = await driver.connect({ id: 'e2e', name: 'e2e', dialect: 'duckdb', file: ':memory:' })
  const { resultSets } = await session.execute('select version() as v, 42 as answer', { rowLimit: 1 })
  await session.close()
  console.log(JSON.stringify({ unpacked, row: resultSets[0]?.rows[0] }))
} catch (e) {
  console.log(JSON.stringify({ unpacked, error: (e as Error).message }))
}
// DuckDB's instance cache would keep the process alive.
process.exit(0)
