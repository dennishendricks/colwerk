// `deno task compile` / `deno task desktop [--all-targets] [--keep-output]`: builds the Nuxt app and packages `.output` with the launcher.
//
// Only `.output` is embedded: Nitro has traced the server dependencies into `.output/server/node_modules`,
// and `.output/deno.json` makes Deno resolve npm packages from there (BYONM) instead of the project's
// full node_modules.
import { basename, dirname, extname, resolve } from 'node:path'
import { writeThirdPartyLicenses } from './licenses.ts'

const mode = Deno.args[0]
if (mode !== 'compile' && mode !== 'desktop') {
  console.error('usage: deno run -A scripts/package.ts <compile|desktop> [--all-targets] [--keep-output] [extra deno flags]')
  Deno.exit(2)
}

// `deno desktop --all-targets` itself writes every target to the host's `desktop.output` (Deno 2.9.8),
// so the targets are built one by one with an explicit `--output`. In `dist` each package is named
// `<app>-<version>-<os>-<arch>` with the extension of its `desktop.output` (e.g. `Colwerk-0.1.0-macos-arm64.dmg`).
const TARGETS: Record<string, { os: 'macos' | 'windows' | 'linux', duckdb: string, arch: string }> = {
  'aarch64-apple-darwin': { os: 'macos', duckdb: 'darwin-arm64', arch: 'arm64' },
  'x86_64-apple-darwin': { os: 'macos', duckdb: 'darwin-x64', arch: 'x64' },
  'x86_64-pc-windows-msvc': { os: 'windows', duckdb: 'win32-x64', arch: 'x64' },
  'aarch64-unknown-linux-gnu': { os: 'linux', duckdb: 'linux-arm64', arch: 'arm64' },
  'x86_64-unknown-linux-gnu': { os: 'linux', duckdb: 'linux-x64', arch: 'x64' },
}
const allTargets = mode === 'desktop' && Deno.args.includes('--all-targets')
const keepOutput = mode === 'desktop' && Deno.args.includes('--keep-output')
const targets = allTargets ? Object.keys(TARGETS) : [Deno.build.target]
const extraArgs = Deno.args.slice(1).filter(arg => arg !== '--all-targets' && arg !== '--keep-output')

async function exec(cmd: string, args: string[], cwd?: string) {
  const { code } = await new Deno.Command(cmd, { args, cwd, stdout: 'inherit', stderr: 'inherit' }).spawn().status
  if (code !== 0) Deno.exit(code)
}

function run(args: string[]) {
  console.log(`$ deno ${args.join(' ')}`)
  return exec(Deno.execPath(), args)
}

await run(['run', '-A', 'npm:nuxt', 'build'])

await Deno.mkdir('.output/launcher', { recursive: true })
for (const file of ['main.ts', 'common.ts', 'native.ts', 'mcp-bridge.ts']) {
  await Deno.copyFile(`launcher/${file}`, `.output/launcher/${file}`)
}
// Imported by the launcher outside the server bundle; same relative paths as in the source tree.
await Deno.mkdir('.output/core', { recursive: true })
for (const file of ['data-dir.ts', 'keychain.ts', 'mcp-token.ts']) {
  await Deno.copyFile(`core/${file}`, `.output/core/${file}`)
}
// `desktop.app` and `desktop.output` come from the project's deno.json. Paths are made absolute, otherwise
// they would resolve relative to `.output/deno.json`.
const { desktop } = JSON.parse(await Deno.readTextFile('deno.json'))
const appVersion = JSON.parse(await Deno.readTextFile('package.json')).version
const absolute = (paths: Record<string, string>) => Object.fromEntries(Object.entries(paths).map(([os, path]) => [os, resolve(path)]))
await Deno.writeTextFile(
  '.output/deno.json',
  JSON.stringify(
    {
      nodeModulesDir: 'manual',
      desktop: { app: { ...desktop.app, icons: absolute(desktop.app.icons) } },
    },
    null,
    2,
  ),
)

// DuckDB's native library (core/drivers/duckdb-ffi.ts) comes in one npm package per platform. It is not
// embedded but downloaded on demand (launcher/native.ts); `duckdb.json` tells each build where to get its
// target's package.
const { version } = JSON.parse(await Deno.readTextFile('node_modules/@duckdb/node-bindings/package.json'))

// License texts: embedded in every build and placed next to the packages in `dist` for the release. DuckDB is
// not part of them, since it is downloaded at runtime and not distributed.
await Deno.copyFile('LICENSE', '.output/LICENSE')
await writeThirdPartyLicenses('.output/THIRD_PARTY_LICENSES.txt')
await Deno.mkdir('dist', { recursive: true })
for (const file of ['LICENSE', 'THIRD_PARTY_LICENSES.txt']) await Deno.copyFile(`.output/${file}`, `dist/${file}`)

async function writeDuckdbManifest(platform: string) {
  const url = `https://registry.npmjs.org/@duckdb/node-bindings-${platform}/${version}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const { dist } = await res.json()
  await Deno.writeTextFile('.output/launcher/duckdb.json', JSON.stringify({ version, platform, tarball: dist.tarball, integrity: dist.integrity }))
}

for (const target of targets) {
  const { os, duckdb, arch } = TARGETS[target]!
  await writeDuckdbManifest(duckdb)

  // `deno desktop` leaves the unpacked app (e.g. `Colwerk.app`) next to the package and makes the .dmg from
  // the whole output directory, so it builds into an empty staging directory. The package goes to `dist`,
  // the unpacked app next to it with the same name as `.zip`.
  const buildDir = resolve('.output/desktop', target)
  if (mode === 'desktop') await Deno.remove(buildDir, { recursive: true }).catch(() => {})
  const output = mode === 'desktop' ? `${buildDir}/${basename(desktop.output[os])}` : `dist/colwerk${os === 'windows' ? '.exe' : ''}`
  await Deno.mkdir(dirname(output), { recursive: true })
  await run([
    mode,
    '--config',
    '.output/deno.json',
    // Type-checked in the project context by `deno task typecheck`; `.output` has no type packages.
    '--no-check',
    // Network for the databases and the DuckDB download, file access for config and DuckDB files, env for config,
    // FFI for DuckDB's native library, run for the OS keychain tools, the native file dialogs (core/dialog.ts)
    // and opening the browser (app URL, release pages).
    '--allow-net',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-sys',
    '--allow-ffi',
    `--allow-run=${['security', 'secret-tool', 'powershell', 'osascript', 'zenity', 'kdialog', 'open', 'cmd', 'xdg-open'].join(',')}`,
    '--include',
    '.output/public',
    '--include',
    '.output/server',
    '--include',
    '.output/launcher/duckdb.json',
    '--include',
    '.output/LICENSE',
    '--include',
    '.output/THIRD_PARTY_LICENSES.txt',
    ...(mode === 'desktop' ? ['--target', target] : []),
    // Self-extracting bundle; on macOS `--compress` breaks code signing (Deno 2.9.8), and the .dmg is compressed anyway.
    ...(mode === 'desktop' && os !== 'macos' ? ['--compress=xz'] : []),
    '--output',
    output,
    ...extraArgs,
    '.output/launcher/main.ts',
  ])
  if (mode === 'desktop') {
    const name = `${desktop.app.name}-${appVersion}-${os}-${arch}`
    const dist = resolve(dirname(desktop.output[os]), `${name}${extname(desktop.output[os])}`)
    await Deno.mkdir(dirname(dist), { recursive: true })
    await Deno.rename(output, dist)

    const zip = resolve(dirname(dist), `${name}.zip`)
    await Deno.remove(zip).catch(() => {})
    const files = [...Deno.readDirSync(buildDir)].map(entry => entry.name)
    // `-y` keeps the symlinks inside a macOS .app (its signature covers them); Windows only has bsdtar.
    if (Deno.build.os === 'windows') await exec('tar', ['-a', '-cf', zip, ...files], buildDir)
    else await exec('zip', ['-qry', zip, ...files], buildDir)

    if (!keepOutput) {
      await Deno.remove(buildDir, { recursive: true })
    }
  }
}
