// The npm package of DuckDB's native addon for the host system (launcher/native.ts downloads it on demand):
// embedded into the build by scripts/package.ts, and used by tests/duckdb-download.test.ts to download it the same way.
import type { DuckdbManifest } from '../launcher/native.ts'

export async function duckdbManifest(): Promise<DuckdbManifest> {
  const { version } = await Bun.file('node_modules/@duckdb/node-bindings/package.json').json()
  const platform = `${process.platform}-${process.arch}`
  const registry = `https://registry.npmjs.org/@duckdb/node-bindings-${platform}/${version}`
  const response = await fetch(registry)
  if (!response.ok) throw new Error(`${registry}: ${response.status} ${response.statusText}`)
  const { dist } = await response.json()
  return { version, platform, tarball: dist.tarball, integrity: dist.integrity }
}
