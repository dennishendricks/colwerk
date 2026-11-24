// DuckDB's native addon for the build host, embedded by scripts/package.ts and unpacked at the first start by
// launcher/native.ts: the npm package `@duckdb/node-bindings-<platform>` of exactly the version in node_modules,
// verified against the registry's integrity hash, the package's os/cpu and a test load, then recompressed with zstd.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { type DuckdbArchive, nativeFiles, tarFiles } from '../launcher/native.ts'

/** Writes the archive to `outfile`; returns what the launcher needs and DuckDB's license text. */
export async function duckdbArchive(outfile: string): Promise<DuckdbArchive & { license: string }> {
  // The bindings' JavaScript is bundled from node_modules; the native addon must be of the same version.
  const { version } = await Bun.file('node_modules/@duckdb/node-bindings/package.json').json()
  // The executable is compiled for the system running the build (scripts/package.ts), so is the library.
  const platform = `${process.platform}-${process.arch}`
  const registry = `https://registry.npmjs.org/@duckdb/node-bindings-${platform}/${version}`
  const response = await fetch(registry)
  if (!response.ok) throw new Error(`${registry}: ${response.status} ${response.statusText}`)
  const pkg = await response.json()
  if (pkg.version !== version || !pkg.os?.includes(process.platform) || !pkg.cpu?.includes(process.arch)) {
    throw new Error(`${registry}: package ${pkg.version} for ${pkg.os}-${pkg.cpu}, expected ${version} for ${platform}`)
  }
  const tarball = await fetch(pkg.dist.tarball)
  if (!tarball.ok) throw new Error(`${pkg.dist.tarball}: HTTP ${tarball.status}`)
  const tgz = await tarball.bytes()
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-512', tgz))
  if (`sha512-${btoa(String.fromCharCode(...hash))}` !== pkg.dist.integrity) {
    throw new Error(`${pkg.dist.tarball}: checksum mismatch`)
  }
  const tar = gunzipSync(tgz)

  // Loads the addon in a process of its own, which the executable's runtime matches, and compares the version of
  // DuckDB it reports: `2.0.0-r.1` of the bindings contains DuckDB `v2.0.0`.
  const dir = await mkdtemp(join(tmpdir(), 'colwerk-duckdb-'))
  try {
    for (const { name, data } of nativeFiles(tar)) await writeFile(join(dir, name), data, { mode: 0o755 })
    const addon = JSON.stringify(join(dir, 'duckdb.node'))
    const load = Bun.spawnSync([process.execPath, '-e', `console.log(require(${addon}).library_version())`])
    const loaded = load.stdout.toString().trim()
    const expected = `v${version.split('-')[0]}`
    if (loaded !== expected) {
      throw new Error(`${pkg.dist.tarball}: loads DuckDB ${loaded || load.stderr.toString()}, expected ${expected}`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  const license = [...tarFiles(tar)].find((f) => f.name === 'package/LICENSE')
  if (!license) throw new Error(`${pkg.dist.tarball}: LICENSE missing`)
  await Bun.write(outfile, Bun.zstdCompressSync(tar, { level: 19 }))
  return { version, platform, license: new TextDecoder().decode(license.data) }
}
