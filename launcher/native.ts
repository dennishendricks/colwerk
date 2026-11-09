// DuckDB's native addon in packaged builds. It is not embedded: scripts/package.ts only embeds a manifest of
// the build target's npm package (`@duckdb/node-bindings-<platform>`). On request (`installDriver()` in
// core/registry.ts) the package is downloaded from the npm registry, checked against the integrity hash fixed at
// build time, and its `duckdb.node` with the DuckDB library next to it is unpacked into the data directory.
// core/drivers/duckdb-native.ts loads it from the path in `globalThis.colwerkDuckdbLibrary`.
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { defaultDataDir } from '../core/data-dir.ts'

export interface DuckdbManifest {
  version: string
  /** Platform suffix of the npm package, e.g. `darwin-arm64`. */
  platform: string
  tarball: string
  /** Subresource integrity of the tarball from the registry (`sha512-<base64>`). */
  integrity: string
}

/** The addon and the shared library it links (`libduckdb.dylib`, `libduckdb.so`, `duckdb.dll`). */
const NATIVE = /\.(node|dylib|so|dll)$/

/** Regular files of a tar archive (ustar; npm tarballs need neither long names nor pax headers here). */
function* tarFiles(tar: Uint8Array): Generator<{ name: string; data: Uint8Array }> {
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

/**
 * On Windows, renaming a directory fails with EPERM/EACCES while a virus scanner still holds the freshly
 * written `.node`/`.dll` open; like graceful-fs, retry for a while.
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

/** The globals the server reads. */
export function duckdbGlobals(manifest: DuckdbManifest) {
  const root = join(defaultDataDir(), 'drivers')
  const dir = join(root, `duckdb-${manifest.version}-${manifest.platform}`)
  const library = join(dir, 'duckdb.node')
  const installed = () =>
    stat(library).then(
      () => true,
      () => false,
    )

  async function install(onProgress: (fraction: number) => void) {
    const res = await fetch(manifest.tarball)
    if (!res.ok || !res.body) throw new Error(`${manifest.tarball}: HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length'))
    let received = 0
    const counted = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.length
          if (total) onProgress(received / total)
          controller.enqueue(chunk)
        },
      }),
    )
    const tgz = await new Response(counted).bytes()
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-512', tgz))
    if (`sha512-${btoa(String.fromCharCode(...hash))}` !== manifest.integrity) throw new Error('checksum mismatch')

    // Unpacked next to the target and renamed at the end, so an interrupted download leaves nothing half-done.
    const tmp = `${dir}.${crypto.randomUUID()}.tmp`
    await mkdir(tmp, { recursive: true })
    try {
      for (const { name, data } of tarFiles(gunzipSync(tgz))) {
        if (NATIVE.test(name)) await writeFile(join(tmp, basename(name)), data, { mode: 0o755 })
      }
      // Another instance of the app may have finished first.
      await renameRetrying(tmp, dir).catch(async (e) => {
        if (!(await installed())) throw e
      })
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
    for (const name of await readdir(root)) {
      if (name.startsWith('duckdb-') && join(root, name) !== dir) {
        await rm(join(root, name), { recursive: true, force: true })
      }
    }
  }

  return { colwerkDuckdbLibrary: library, colwerkDuckdb: { installed, install } }
}
