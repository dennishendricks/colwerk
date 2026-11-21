// End-to-end check of DuckDB's download in packaged builds (launcher/native.ts) against the real npm registry, on
// every system in .github/workflows/e2e.yml. Needs the network, so it only runs with COLWERK_E2E=1:
//   COLWERK_E2E=1 bun test ./tests/duckdb-download.test.ts
// Each start of the app is a process of its own (duckdb-download.child.ts) with a fresh data directory.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDir } from './helpers.ts'

interface Start {
  downloads: number
  value?: unknown
  error?: string
}

async function start(dataDir: string, mode: 'start' | 'tampered' = 'start'): Promise<Start> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'duckdb-download.child.ts'), mode], {
    env: { ...process.env, COLWERK_DATA_DIR: dataDir, COLWERK_KEYCHAIN: 'off' },
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (code !== 0) throw new Error(`start exited with ${code}: ${out}`)
  return JSON.parse(out.trim().split('\n').at(-1)!)
}

// The shared library next to `duckdb.node`: libduckdb.dylib, libduckdb.so or duckdb.dll.
const libraryExtension = process.platform === 'darwin' ? '.dylib' : process.platform === 'win32' ? '.dll' : '.so'
const TIMEOUT = 180_000

describe.skipIf(process.env.COLWERK_E2E !== '1')('DuckDB download', () => {
  const dirs: string[] = []
  let dataDir: string
  let driverDir: string

  beforeAll(async () => {
    dataDir = await tempDir()
    dirs.push(dataDir)
  })
  afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5 }))))

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
    'cold start downloads, verifies and loads the library',
    async () => {
      expect(await start(dataDir)).toEqual({ downloads: 1, value: 42 })
    },
    TIMEOUT,
  )

  test('exactly one native library is stored', async () => {
    const entries = await readdir(join(dataDir, 'drivers'))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatch(/^duckdb-/)
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
      expect(await start(dataDir)).toEqual({ downloads: 0, value: 42 })
      expect(await files()).toEqual(before)
    },
    TIMEOUT,
  )

  test(
    'a tampered download is rejected by the hash check and nothing is stored',
    async () => {
      const fresh = await tempDir()
      dirs.push(fresh)
      const result = await start(fresh, 'tampered')
      expect(result.downloads).toBe(1)
      expect(result.error).toContain('checksum mismatch')
      const stored = await stat(join(fresh, 'drivers')).then(
        () => true,
        () => false,
      )
      expect(stored).toBe(false)
    },
    TIMEOUT,
  )
})
