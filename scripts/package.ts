// `bun run compile` / `bun run desktop`: builds the Nuxt app and packages it for the host system.
//
// Both build `colwerk-server`, a Bun single-file executable with the launcher, the Nitro server and its
// dependencies. `compile` writes it to `dist/colwerk`, where it opens the default browser; `desktop` makes it the
// sidecar of the Tauri app (src-tauri) and writes the app's packages to `dist/`.
import { copyFile, mkdir, readdir, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { writeThirdPartyLicenses } from './licenses.ts'

const mode = process.argv[2]
if (mode !== 'compile' && mode !== 'desktop') {
  console.error('usage: bun scripts/package.ts <compile|desktop> [extra tauri build flags]')
  process.exit(2)
}
const extraArgs = process.argv.slice(3)

const os = process.platform === 'win32' ? 'windows' : process.platform
const windows = os === 'windows'
const cpu = process.arch
const exe = windows ? '.exe' : ''

async function exec(cmd: string[], cwd?: string) {
  console.log(`$ ${cmd.join(' ')}`)
  const code = await Bun.spawn(cmd, { cwd, stdio: ['inherit', 'inherit', 'inherit'] }).exited
  if (code !== 0) process.exit(code)
}

await exec([process.execPath, '--bun', 'nuxt', 'build'])

// License texts: embedded in every build and placed next to the packages in `dist` for the release. DuckDB is
// not part of them, since it is downloaded at runtime and not distributed.
await writeThirdPartyLicenses('.output/THIRD_PARTY_LICENSES.txt', { cargo: mode === 'desktop' })
await mkdir('dist', { recursive: true })
await copyFile('LICENSE', 'dist/LICENSE')
await copyFile('.output/THIRD_PARTY_LICENSES.txt', 'dist/THIRD_PARTY_LICENSES.txt')

// DuckDB's native addon comes in one npm package per platform. It is not embedded but downloaded on demand
// (launcher/native.ts); the manifest tells the build where to get its platform's package.
const { version: duckdbVersion } = await Bun.file('node_modules/@duckdb/node-bindings/package.json').json()
const duckdbPlatform = `${process.platform}-${cpu}`
const registry = `https://registry.npmjs.org/@duckdb/node-bindings-${duckdbPlatform}/${duckdbVersion}`
const response = await fetch(registry)
if (!response.ok) throw new Error(`${registry}: ${response.status} ${response.statusText}`)
const { dist: duckdbDist } = await response.json()
const duckdb = {
  version: duckdbVersion,
  platform: duckdbPlatform,
  tarball: duckdbDist.tarball,
  integrity: duckdbDist.integrity,
}

// The sidecar is named after the Rust target triple of the host, as Tauri expects.
const target = mode === 'desktop' ? (await Bun.$`rustc --print host-tuple`.text()).trim() : ''
const server =
  mode === 'compile' ? resolve(`dist/colwerk${exe}`) : resolve(`src-tauri/binaries/colwerk-server-${target}${exe}`)
await mkdir(resolve(server, '..'), { recursive: true })

// One executable of the launcher and the Nitro server it imports.
const result = await Bun.build({
  entrypoints: ['launcher/main.ts'],
  compile: { outfile: server },
  minify: true,
  define: { COLWERK_DUCKDB: JSON.stringify(JSON.stringify(duckdb)) },
  plugins: [
    {
      name: 'nitro-output',
      setup(b) {
        b.onResolve({ filter: /\/server\/index\.mjs$/ }, () => ({ path: resolve('.output/server/index.mjs') }))
      },
    },
  ],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

if (mode === 'desktop') {
  const { version } = await Bun.file('package.json').json()
  const name = `Colwerk-${version}-${os === 'darwin' ? 'macos' : os}-${cpu}`

  // Update packages for tauri-plugin-updater, signed with the key of the release workflow (signatures `.sig`,
  // collected into `latest.json` by scripts/update-manifest.ts). Without the key they are not built.
  const signed = !!process.env.TAURI_SIGNING_PRIVATE_KEY
  // The sidecar and the license files only exist after this build, so they are added here and not in
  // tauri.conf.json, which `tauri dev` uses as well.
  const config = {
    bundle: {
      createUpdaterArtifacts: signed,
      externalBin: ['binaries/colwerk-server'],
      resources: { '../LICENSE': 'LICENSE', '../.output/THIRD_PARTY_LICENSES.txt': 'THIRD_PARTY_LICENSES.txt' },
    },
  }
  // Cargo builds the shell exactly from Cargo.lock.
  await exec([
    process.execPath,
    '--bun',
    'tauri',
    'build',
    '--config',
    JSON.stringify(config),
    ...extraArgs,
    '--',
    '--locked',
  ])

  // Packages: the installer of the platform (macOS: the update package as well), with the signature of each
  // update package.
  const release = resolve('src-tauri/target/release')
  const bundle = join(release, 'bundle')
  const outputs: [string, string][] =
    os === 'darwin'
      ? [['dmg', '.dmg'], ...(signed ? [['macos', '.app.tar.gz'] as [string, string]] : [])]
      : windows
        ? [['nsis', '-setup.exe']]
        : [['deb', '.deb']]
  for (const [dir, ext] of outputs) {
    const file = (await readdir(join(bundle, dir))).find((f) => f.endsWith(ext))!
    await rename(join(bundle, dir, file), resolve(`dist/${name}${ext}`))
    const sig = join(bundle, dir, `${file}.sig`)
    if (await Bun.file(sig).exists()) await rename(sig, resolve(`dist/${name}${ext}.sig`))
  }
}
