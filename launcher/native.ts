// DuckDB's native library in packaged builds. It is not embedded: `scripts/package.ts` writes `duckdb.json` with
// the npm package of the build target. On request (`installDriver()` in core/registry.ts) the package is
// downloaded from the npm registry, checked against the integrity hash fixed at build time, and its
// `libduckdb.{dylib,so}` / `duckdb.dll` is unpacked into the data directory. core/drivers/duckdb-ffi.ts loads
// it from the path in `globalThis.dbmDuckdbLibrary`.
import { basename, join } from 'node:path'
import { UntarStream } from 'jsr:@std/tar@0.1/untar-stream'
import { defaultDataDir } from '../core/data-dir.ts'

export interface DuckdbManifest {
  version: string
  /** Platform suffix of the npm package, e.g. `darwin-arm64`. */
  platform: string
  tarball: string
  /** Subresource integrity of the tarball from the registry (`sha512-<base64>`). */
  integrity: string
}

const LIBRARY: Record<string, string> = { darwin: 'libduckdb.dylib', linux: 'libduckdb.so', win32: 'duckdb.dll' }

/** The globals the server reads. */
export function duckdbGlobals(manifest: DuckdbManifest) {
  const root = join(defaultDataDir(), 'drivers')
  const dir = join(root, `duckdb-${manifest.version}-${manifest.platform}`)
  const file = LIBRARY[manifest.platform.split('-')[0]!]!
  const library = join(dir, file)
  const installed = () => Deno.stat(library).then(() => true, () => false)

  async function install(onProgress: (fraction: number) => void) {
    const res = await fetch(manifest.tarball)
    if (!res.ok || !res.body) throw new Error(`${manifest.tarball}: HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length'))
    let received = 0
    const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.length
        if (total) onProgress(received / total)
        controller.enqueue(chunk)
      },
    }))
    const tgz = await new Response(counted).bytes()
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-512', tgz))
    if (`sha512-${btoa(String.fromCharCode(...hash))}` !== manifest.integrity) throw new Error('checksum mismatch')

    // Unpacked next to the target and renamed at the end, so an interrupted download leaves nothing half-done.
    const tmp = `${dir}.${crypto.randomUUID()}.tmp`
    await Deno.mkdir(tmp, { recursive: true })
    try {
      const entries = ReadableStream.from([tgz]).pipeThrough(new DecompressionStream('gzip')).pipeThrough(new UntarStream())
      for await (const entry of entries) {
        const name = basename(entry.path)
        if (entry.readable && name === file) await Deno.writeFile(join(tmp, name), entry.readable)
        else await entry.readable?.cancel()
      }
      // Another instance of the app may have finished first.
      await Deno.rename(tmp, dir).catch(async (e) => {
        if (!(await installed())) throw e
      })
    } finally {
      await Deno.remove(tmp, { recursive: true }).catch(() => {})
    }
    for await (const entry of Deno.readDir(root)) {
      if (entry.name.startsWith('duckdb-') && join(root, entry.name) !== dir) await Deno.remove(join(root, entry.name), { recursive: true }).catch(() => {})
    }
  }

  return { dbmDuckdbLibrary: library, dbmDuckdb: { installed, install } }
}
