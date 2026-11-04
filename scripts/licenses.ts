// Collects the license texts of everything the packaged app contains: the npm packages bundled into the client
// and server (recorded during `nuxt build`, see nuxt.config.ts), the Node runtime of the single executable and,
// for the desktop app, the Rust crates of its shell (src-tauri).
import { join } from 'node:path'

type Package = { name: string; version: string; license?: string; text?: string }

const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i

/** The license files in `dir`, concatenated (crates often ship LICENSE-MIT and LICENSE-APACHE). */
async function licenseText(dir: string): Promise<string | undefined> {
  const texts: string[] = []
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && LICENSE_FILE.test(entry.name)) texts.push(await Deno.readTextFile(join(dir, entry.name)))
  }
  return texts.length ? texts.join('\n\n') : undefined
}

async function npmPackage(dir: string): Promise<Package> {
  const { name, version, license } = JSON.parse(await Deno.readTextFile(join(dir, 'package.json')))
  return { name, version, license: typeof license === 'string' ? license : license?.type, text: await licenseText(dir) }
}

interface CargoMetadata {
  packages: {
    id: string
    name: string
    version: string
    license?: string
    manifest_path: string
    targets: { kind: string[] }[]
  }[]
  resolve: { root: string; nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[] }
}

/** The crates linked into the desktop app: normal dependencies of src-tauri for the host, without proc macros. */
async function cargoPackages(): Promise<Package[]> {
  const { stdout } = await new Deno.Command('cargo', {
    args: [
      'metadata',
      '--format-version',
      '1',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--filter-platform',
      Deno.build.target,
    ],
    stderr: 'inherit',
  }).output()
  const { packages, resolve } = JSON.parse(new TextDecoder().decode(stdout)) as CargoMetadata
  const byId = new Map(packages.map((p) => [p.id, p]))
  const nodes = new Map(resolve.nodes.map((n) => [n.id, n]))
  const linked = new Set<string>()
  const visit = (id: string) => {
    const pkg = byId.get(id)!
    if (linked.has(id) || pkg.targets.every((t) => t.kind.includes('proc-macro'))) return
    linked.add(id)
    for (const dep of nodes.get(id)!.deps) if (dep.dep_kinds.some((k) => k.kind === null)) visit(dep.pkg)
  }
  visit(resolve.root)
  linked.delete(resolve.root)
  return Promise.all([...linked].map(async (id) => {
    const { name, version, license, manifest_path } = byId.get(id)!
    return { name, version, license, text: await licenseText(join(manifest_path, '..')) }
  }))
}

/** Writes `THIRD_PARTY_LICENSES.txt` to `file`. */
export async function writeThirdPartyLicenses(
  file: string,
  { node, cargo }: { node: { version: string; license: string }; cargo: boolean },
): Promise<void> {
  const bundled: string[] = JSON.parse(await Deno.readTextFile('.nuxt/bundled-packages.json'))
  const packages = new Map<string, Package>()
  for (const dir of bundled) {
    const pkg = await npmPackage(dir)
    // The app's own sources resolve to the project root, which is no third-party package.
    if (pkg.name !== 'colwerk') packages.set(`${pkg.name}@${pkg.version}`, pkg)
  }
  if (cargo) { for (const pkg of await cargoPackages()) packages.set(`${pkg.name}@${pkg.version}`, pkg) }
  const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))
  const runtime = {
    name: 'Node.js',
    version: node.version,
    license: 'MIT',
    text: await Deno.readTextFile(node.license),
  }
  const rule = '='.repeat(80)
  const body = [runtime, ...sorted].map((p) =>
    `${rule}\n${p.name} ${p.version} (${p.license ?? 'unknown license'})\n${rule}\n\n${
      p.text?.trim() ?? 'No license text included in the package.'
    }\n`
  )
  await Deno.writeTextFile(file, `Colwerk contains the following third-party software.\n\n${body.join('\n')}`)
}
