// `deno task compile` / `deno task desktop`: builds the Nuxt app and packages it for the host system.
//
// Both build `colwerk-server`, a Node single executable application (SEA) with the launcher, the Nitro server and
// its dependencies in one ESM bundle. `compile` writes it to `dist/colwerk`, where it opens the default browser;
// `desktop` makes it the sidecar of the Tauri app (src-tauri) and writes the app's packages to `dist/`.
//
// The Node binary is the official build of NODE_VERSION, downloaded and checked against its SHASUMS256.txt: a
// system Node (e.g. Homebrew's) may link libraries that other machines do not have.
import { build } from 'esbuild'
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { writeThirdPartyLicenses } from './licenses.ts'

const NODE_VERSION = 'v26.13.0'

const mode = Deno.args[0]
if (mode !== 'compile' && mode !== 'desktop') {
  console.error('usage: deno run -A scripts/package.ts <compile|desktop> [extra tauri build flags]')
  Deno.exit(2)
}
const extraArgs = Deno.args.slice(1)

const { os, arch, target } = Deno.build
const windows = os === 'windows'
const cpu = arch === 'aarch64' ? 'arm64' : 'x64'
const exe = windows ? '.exe' : ''

async function exec(cmd: string, args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  console.log(`$ ${basename(cmd)} ${args.join(' ')}`)
  const { code } = await new Deno.Command(cmd, { args, ...options, stdout: 'inherit', stderr: 'inherit' }).spawn()
    .status
  if (code !== 0) Deno.exit(code)
}
const exists = (path: string) => stat(path).then(() => true, () => false)

await exec(Deno.execPath(), ['run', '-A', 'npm:nuxt', 'build'])

/** The official Node build of the host, unpacked into node_modules/.cache; resolves with its directory. */
async function officialNode(): Promise<string> {
  const name = `node-${NODE_VERSION}-${windows ? 'win' : os}-${cpu}`
  const cache = resolve('node_modules/.cache/colwerk')
  const dir = join(cache, name)
  if (await exists(dir)) return dir
  const archive = `${name}.${windows ? 'zip' : 'tar.gz'}`
  const base = `https://nodejs.org/dist/${NODE_VERSION}`
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text()
  const expected = sums.split('\n').find((line) => line.endsWith(`  ${archive}`))?.split(' ')[0]
  const res = await fetch(`${base}/${archive}`)
  if (!res.ok || !expected) throw new Error(`${base}/${archive}: HTTP ${res.status}`)
  const data = await res.bytes()
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
    (b) => b.toString(16).padStart(2, '0'),
  )
    .join('')
  if (hash !== expected) throw new Error(`${archive}: checksum mismatch`)
  await mkdir(cache, { recursive: true })
  await writeFile(join(cache, archive), data)
  // bsdtar (also the `tar` of Windows) unpacks zip files as well.
  await exec('tar', ['-xf', archive], { cwd: cache })
  await rm(join(cache, archive))
  return dir
}

const node = await officialNode()
const nodeBin = join(node, windows ? 'node.exe' : 'bin/node')

// License texts: embedded in every build and placed next to the packages in `dist` for the release. DuckDB is
// not part of them, since it is downloaded at runtime and not distributed.
await writeThirdPartyLicenses('.output/THIRD_PARTY_LICENSES.txt', {
  node: { version: NODE_VERSION, license: join(node, 'LICENSE') },
  cargo: mode === 'desktop',
})
await mkdir('dist', { recursive: true })
await copyFile('LICENSE', 'dist/LICENSE')
await copyFile('.output/THIRD_PARTY_LICENSES.txt', 'dist/THIRD_PARTY_LICENSES.txt')

// DuckDB's native addon comes in one npm package per platform. It is not embedded but downloaded on demand
// (launcher/native.ts); the manifest tells the build where to get its platform's package.
const { version: duckdbVersion } = JSON.parse(
  await Deno.readTextFile('node_modules/@duckdb/node-bindings/package.json'),
)
const duckdbPlatform = `${windows ? 'win32' : os}-${cpu}`
const registry = `https://registry.npmjs.org/@duckdb/node-bindings-${duckdbPlatform}/${duckdbVersion}`
const { dist: duckdbDist } = await (await fetch(registry)).json()
const duckdb = {
  version: duckdbVersion,
  platform: duckdbPlatform,
  tarball: duckdbDist.tarball,
  integrity: duckdbDist.integrity,
}

// One ESM file of the launcher and the Nitro server it imports.
await build({
  entryPoints: ['launcher/main.ts'],
  outfile: '.output/colwerk-server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  logLevel: 'warning',
  define: { COLWERK_DUCKDB: JSON.stringify(JSON.stringify(duckdb)) },
  plugins: [{
    name: 'nitro-output',
    setup(b) {
      b.onResolve({ filter: /\/server\/index\.mjs$/ }, () => ({ path: resolve('.output/server/index.mjs') }))
    },
  }],
})

// The SEA is a copy of the Node binary with the bundle injected. Stripped first (debug symbols are a quarter of
// it); on macOS every modified binary needs a signature again, ad hoc unless Tauri signs the app.
const base = join(node, `colwerk-base${exe}`)
await copyFile(nodeBin, base)
if (os === 'darwin') {
  await exec('strip', ['-x', base])
  await exec('codesign', ['--sign', '-', '--force', base])
} else if (os === 'linux') {
  await exec('strip', [base])
}
const server = mode === 'compile'
  ? resolve(`dist/colwerk${exe}`)
  : resolve(`src-tauri/binaries/colwerk-server-${target}${exe}`)
await mkdir(resolve(server, '..'), { recursive: true })
await writeFile(
  '.output/sea.json',
  JSON.stringify({
    main: resolve('.output/colwerk-server.mjs'),
    mainFormat: 'module',
    output: server,
    disableExperimentalSEAWarning: true,
  }),
)
await exec(base, ['--build-sea', resolve('.output/sea.json')])
if (os === 'darwin') await exec('codesign', ['--sign', '-', '--force', server])

if (mode === 'desktop') {
  const version = JSON.parse(await Deno.readTextFile('package.json')).version
  const name = `Colwerk-${version}-${os === 'darwin' ? 'macos' : os}-${cpu}`

  // The sidecar and the license files only exist after this build, so they are added here and not in
  // tauri.conf.json, which `tauri dev` uses as well.
  const config = {
    bundle: {
      externalBin: ['binaries/colwerk-server'],
      resources: { '../LICENSE': 'LICENSE', '../.output/THIRD_PARTY_LICENSES.txt': 'THIRD_PARTY_LICENSES.txt' },
    },
  }
  await exec(Deno.execPath(), [
    'run',
    '-A',
    'npm:@tauri-apps/cli',
    'build',
    '--config',
    JSON.stringify(config),
    ...extraArgs,
    // Cargo builds the shell exactly from Cargo.lock.
    '--',
    '--locked',
  ])

  // Packages: the installer of the platform, and the unpacked app as a .zip.
  const release = resolve('src-tauri/target/release')
  const bundle = join(release, 'bundle')
  const outputs: [string, string][] = os === 'darwin'
    ? [['dmg', '.dmg']]
    : windows
    ? [['msi', '.msi']]
    : [['appimage', '.AppImage'], ['deb', '.deb']]
  for (const [dir, ext] of outputs) {
    const file = (await readdir(join(bundle, dir))).find((f) => f.endsWith(ext))!
    await rename(join(bundle, dir, file), resolve(`dist/${name}${ext}`))
  }
  const zip = resolve(`dist/${name}.zip`)
  await rm(zip, { force: true })
  if (os === 'darwin') {
    // `-y` keeps the symlinks inside the .app (its signature covers them).
    await exec('zip', ['-qry', zip, 'Colwerk.app'], { cwd: join(bundle, 'macos') })
  } else if (windows) {
    // Portable: the app, its sidecar and the license files, as the installer lays them out.
    const files = ['colwerk.exe', 'colwerk-server.exe', 'LICENSE', 'THIRD_PARTY_LICENSES.txt']
    await exec('tar', ['-a', '-cf', zip, ...files], { cwd: release })
  }
}
