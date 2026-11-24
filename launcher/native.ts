// DuckDB's native addon in packaged builds. scripts/package.ts embeds the npm package of the build target
// (`@duckdb/node-bindings-<platform>`) as a zstd-compressed tar (scripts/duckdb-archive.ts). At the first start of a
// build (launcher/main.ts) its `duckdb.node` with the DuckDB library next to it is unpacked into the data directory,
// as the addon cannot be loaded from inside the executable.
// core/drivers/duckdb-native.ts loads it from the path in `globalThis.colwerkDuckdbLibrary`.
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import process from 'node:process'
import { defaultDataDir } from '../core/data-dir.ts'

export interface DuckdbArchive {
  /** Version of `@duckdb/node-bindings`. */
  version: string
  /** Platform suffix of the npm package, e.g. `darwin-arm64`. */
  platform: string
}

/** The addon and the shared library it links (`libduckdb.dylib`, `libduckdb.so`, `duckdb.dll`). */
const NATIVE = /\.(node|dylib|so|dll)$/

/** Regular files of a tar archive (ustar; npm tarballs need neither long names nor pax headers here). */
export function* tarFiles(tar: Uint8Array): Generator<{ name: string; data: Uint8Array }> {
  const decoder = new TextDecoder()
  const field = (o: number, length: number) => decoder.decode(tar.subarray(o, o + length)).replace(/\0.*$/s, '')
  for (let o = 0; o + 512 <= tar.length;) {
    const name = field(o, 100)
    if (!name) return
    const size = parseInt(field(o + 124, 12).trim() || '0', 8)
    const type = field(o + 156, 1)
    if (type === '0' || type === '') yield { name, data: tar.subarray(o + 512, o + 512 + size) }
    o += 512 + Math.ceil(size / 512) * 512
  }
}

/** The native files of the npm package's tar, by file name; `duckdb.node` comes last. */
export function nativeFiles(tar: Uint8Array) {
  const files = [...tarFiles(tar)]
    .filter((f) => NATIVE.test(f.name))
    .map((f) => ({ name: basename(f.name), data: f.data }))
  if (!files.some((f) => f.name === 'duckdb.node')) throw new Error('duckdb.node missing in the DuckDB package')
  return files.sort((a, b) => Number(a.name === 'duckdb.node') - Number(b.name === 'duckdb.node'))
}

/**
 * On Windows, renaming a file fails with EPERM/EACCES while a virus scanner still holds it open; like
 * graceful-fs, retry for a while.
 */
async function renameRetrying(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt >= 50 || (code !== 'EPERM' && code !== 'EACCES')) throw e
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
}

/** The globals the server reads; `file` is the embedded archive. */
export function duckdbGlobals(archive: DuckdbArchive, file: string) {
  const root = join(defaultDataDir(), 'drivers')
  const dir = join(root, `duckdb-${archive.version}-${archive.platform}`)
  const library = join(dir, 'duckdb.node')
  const installed = () =>
    stat(library).then(
      () => true,
      () => false,
    )

  async function unpack() {
    // Guards against a build whose executable and DuckDB library were made for different systems.
    const platform = `${process.platform}-${process.arch}`
    if (archive.platform !== platform) {
      throw new Error(`the build contains DuckDB for ${archive.platform}, not ${platform}`)
    }
    const tar = await Bun.zstdDecompress(await Bun.file(file).bytes())

    // Each file is written under a temporary name and renamed into place; `duckdb.node` comes last, as its presence
    // marks a complete install (`installed()`). Files are renamed one by one rather than the whole directory, because
    // Windows refuses to rename a directory while a virus scanner holds any file inside it open.
    await mkdir(dir, { recursive: true })
    for (const { name, data } of nativeFiles(tar)) {
      const target = join(dir, name)
      const tmp = `${target}.${crypto.randomUUID()}.tmp`
      await writeFile(tmp, data, { mode: 0o755 })
      await renameRetrying(tmp, target).catch(async (e) => {
        await rm(tmp, { force: true })
        // Another instance of the app may have finished first.
        if (!(await installed())) throw e
      })
    }
    for (const name of await readdir(root)) {
      if (name.startsWith('duckdb-') && join(root, name) !== dir) {
        await rm(join(root, name), { recursive: true, force: true })
      }
    }
  }

  // Started by the launcher and awaited by DuckDB's first use (core/registry.ts), which share one run.
  let running: Promise<void> | undefined
  const install = () =>
    (running ??= installed()
      .then((done) => (done ? undefined : unpack()))
      .finally(() => (running = undefined)))

  return { colwerkDuckdbLibrary: library, colwerkDuckdb: { installed, install } }
}
