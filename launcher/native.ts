// Workaround for native addons in `deno compile` / `deno desktop` binaries.
//
// Deno extracts only the `.node` file of an addon to `<tmpdir>/deno-native-addons/`.
// DuckDB's `duckdb.node` links `libduckdb.{dylib,so}` / `duckdb.dll` via `@loader_path`/`$ORIGIN`,
// which is therefore missing next to the extracted addon. We copy the sibling libraries from the
// embedded file system into that directory before DuckDB is imported.
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const LIB = /^(lib)?duckdb\.(dylib|so|dll)$/

export function isCompiled(): boolean {
  return Deno.mainModule.includes('/deno-compile-') || Deno.mainModule.includes('\\deno-compile-')
}

export async function prepareDuckdbNative(requireFrom: string): Promise<void> {
  if (!isCompiled()) return
  const pkg = `@duckdb/node-bindings-${process.platform}-${process.arch}/package.json`
  let srcDir: string
  try {
    const resolveFrom = (from: string, id: string) => createRequire(from).resolve(id)
    const api = resolveFrom(requireFrom, '@duckdb/node-api/package.json')
    const bindings = resolveFrom(api, '@duckdb/node-bindings/package.json')
    srcDir = dirname(resolveFrom(bindings, pkg))
  } catch {
    return // DuckDB not bundled: the driver reports the load error itself.
  }
  const targetDir = join(tmpdir(), 'deno-native-addons')
  await Deno.mkdir(targetDir, { recursive: true })
  for await (const entry of Deno.readDir(srcDir)) {
    if (!LIB.test(entry.name)) continue
    const src = join(srcDir, entry.name)
    const dst = join(targetDir, entry.name)
    const [s, d] = await Promise.all([Deno.stat(src), Deno.stat(dst).catch(() => null)])
    if (d?.size === s.size) continue
    const tmp = `${dst}.${crypto.randomUUID()}.tmp`
    await Deno.writeFile(tmp, await Deno.readFile(src))
    await Deno.rename(tmp, dst)
  }
}
