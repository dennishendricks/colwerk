// End-to-end check of the DuckDB library embedded in packaged builds: scripts/duckdb-archive.ts builds the archive of
// this system from the npm registry (and verifies it), launcher/native.ts unpacks it, the driver queries it. Runs on
// every system in .github/workflows/e2e.yml; needs the network, so it only runs with COLWERK_E2E=1:
//   COLWERK_E2E=1 bun test ./tests/duckdb-archive.test.ts
// Each start of the app is a process of its own (duckdb-archive.child.ts) with the same data directory.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { duckdbArchive } from '../scripts/duckdb-archive.ts'
import { tempDir } from './helpers.ts'

interface Start {
  unpacked: boolean
  row?: unknown[]
  error?: string
}

// The shared library next to `duckdb.node`: libduckdb.dylib, libduckdb.so or duckdb.dll.
const libraryExtension = process.platform === 'darwin' ? '.dylib' : process.platform === 'win32' ? '.dll' : '.so'
const TIMEOUT = 300_000

describe.skipIf(process.env.COLWERK_E2E !== '1')('DuckDB archive', () => {
  let work: string
  let dataDir: string
  let driverDir: string
  let archive: string
  let version: string

  async function start(platform?: string): Promise<Start> {
    const manifest = join(work, 'manifest.json')
    await writeFile(manifest, JSON.stringify({ version, platform: platform ?? `${process.platform}-${process.arch}` }))
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'duckdb-archive.child.ts'), archive, manifest], {
      env: { ...process.env, COLWERK_DATA_DIR: dataDir, COLWERK_KEYCHAIN: 'off' },
      stdout: 'pipe',
      stderr: 'inherit',
    })
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    if (code !== 0) throw new Error(`start exited with ${code}: ${out}`)
    return JSON.parse(out.trim().split('\n').at(-1)!)
  }

  beforeAll(async () => {
    work = await tempDir()
    dataDir = join(work, 'data')
    archive = join(work, 'duckdb.tar.zst')
    ;({ version } = await duckdbArchive(archive))
  }, TIMEOUT)
  afterAll(() => rm(work, { recursive: true, force: true, maxRetries: 5 }))

  const files = () =>
    readdir(driverDir).then((names) =>
      Promise.all(
        names.map(async (name) => {
          const { size, mtimeMs } = await stat(join(driverDir, name))
          return { name, size, mtimeMs }
        }),
      ),
    )

  test(
    'cold start unpacks and loads the library of the bindings version',
    async () => {
      expect(await start()).toEqual({ unpacked: true, row: [`v${version.split('-')[0]}`, 42] })
    },
    TIMEOUT,
  )

  test('exactly one native library is stored', async () => {
    const entries = await readdir(join(dataDir, 'drivers'))
    expect(entries).toEqual([`duckdb-${version}-${process.platform}-${process.arch}`])
    driverDir = join(dataDir, 'drivers', entries[0]!)
    const names = (await files()).map((f) => f.name)
    expect(names).toContain('duckdb.node')
    const libraries = names.filter((n) => /\.(dylib|so|dll)$/.test(n))
    expect(libraries.map((n) => n.slice(n.lastIndexOf('.')))).toEqual([libraryExtension])
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  test(
    'warm start reuses the stored library',
    async () => {
      const before = await files()
      expect((await start()).unpacked).toBe(false)
      expect(await files()).toEqual(before)
    },
    TIMEOUT,
  )

  test(
    'an archive of another system is refused',
    async () => {
      const result = await start('other-arch')
      expect(result.error).toContain('not ' + `${process.platform}-${process.arch}`)
    },
    TIMEOUT,
  )
})
