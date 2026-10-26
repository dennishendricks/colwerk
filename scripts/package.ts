// `deno task compile` / `deno task desktop [--all-targets] [--keep-output]`: builds the Nuxt app and packages `.output` with the launcher.
//
// Only `.output` is embedded: Nitro has traced the server dependencies into `.output/server/node_modules`,
// and `.output/deno.json` makes Deno resolve npm packages from there (BYONM) instead of the project's
// full node_modules.
import { basename, dirname, resolve } from 'node:path'

const mode = Deno.args[0]
if (mode !== 'compile' && mode !== 'desktop') {
  console.error('usage: deno run -A scripts/package.ts <compile|desktop> [--all-targets] [--keep-output] [extra deno flags]')
  Deno.exit(2)
}

// `deno desktop --all-targets` itself writes every target to the host's `desktop.output` (Deno 2.9.8),
// so the targets are built one by one with an explicit `--output`. The arm64 build of an OS takes the plain
// `desktop.output` name, the x86_64 build gets the suffix next to it (e.g. `Colwerk-x64.dmg`).
const TARGETS: Record<string, { os: 'macos' | 'windows' | 'linux', duckdb: string, suffix: string }> = {
  'aarch64-apple-darwin': { os: 'macos', duckdb: 'darwin-arm64', suffix: '' },
  'x86_64-apple-darwin': { os: 'macos', duckdb: 'darwin-x64', suffix: '-x64' },
  'x86_64-pc-windows-msvc': { os: 'windows', duckdb: 'win32-x64', suffix: '' },
  'aarch64-unknown-linux-gnu': { os: 'linux', duckdb: 'linux-arm64', suffix: '-arm64' },
  'x86_64-unknown-linux-gnu': { os: 'linux', duckdb: 'linux-x64', suffix: '' },
}
const allTargets = mode === 'desktop' && Deno.args.includes('--all-targets')
const keepOutput = mode === 'desktop' && Deno.args.includes('--keep-output')
const targets = allTargets ? Object.keys(TARGETS) : [Deno.build.target]
const extraArgs = Deno.args.slice(1).filter(arg => arg !== '--all-targets' && arg !== '--keep-output')

async function exec(cmd: string, args: string[]) {
  const { code } = await new Deno.Command(cmd, { args, stdout: 'inherit', stderr: 'inherit' }).spawn().status
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

// DuckDB's native addon comes in one npm package per platform, and only the host's is installed. Every
// build embeds exactly its target's package: the others are fetched from the registry into a staging
// directory and swapped into `.output/server` for their build.
const DUCKDB = '.output/server/node_modules/@duckdb'
const STAGING = '.output/duckdb'
const { version } = JSON.parse(await Deno.readTextFile(`${DUCKDB}/node-bindings/package.json`))
await Deno.mkdir(STAGING, { recursive: true })
for await (const entry of Deno.readDir(DUCKDB)) {
  if (entry.name.startsWith('node-bindings-')) await Deno.rename(`${DUCKDB}/${entry.name}`, `${STAGING}/${entry.name}`)
}

async function stageDuckdb(platform: string) {
  const pkg = `node-bindings-${platform}`
  const dir = `${STAGING}/${pkg}`
  if (!(await Deno.stat(dir).catch(() => null))) {
    const url = `https://registry.npmjs.org/@duckdb/${pkg}/-/${pkg}-${version}.tgz`
    console.log(`fetch ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    await Deno.writeFile(`${dir}.tgz`, new Uint8Array(await res.arrayBuffer()))
    await Deno.mkdir(dir)
    await exec('tar', ['-xzf', `${dir}.tgz`, '-C', dir, '--strip-components=1'])
    await Deno.remove(`${dir}.tgz`)
  }
  // The macOS packages ship a universal libduckdb (x86_64 + arm64). Keep only the target's slice. Each
  // slice carries its own signature, so the result stays validly signed (strip would invalidate it).
  if (platform.startsWith('darwin-')) {
    const lib = `${dir}/libduckdb.dylib`
    await exec('lipo', [lib, '-thin', platform === 'darwin-arm64' ? 'arm64' : 'x86_64', '-output', `${lib}.thin`])
    await Deno.rename(`${lib}.thin`, lib)
  }
  return pkg
}

for (const target of targets) {
  const { os, duckdb, suffix } = TARGETS[target]!
  const pkg = await stageDuckdb(duckdb)
  await Deno.rename(`${STAGING}/${pkg}`, `${DUCKDB}/${pkg}`)

  // `deno desktop` leaves the unpacked app (e.g. `Colwerk.app`) next to the package and makes the .dmg from
  // the whole output directory, so it builds into an empty staging directory; only the package goes to `dist`.
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
    // Network for the databases, file access for config and DuckDB files, env for config,
    // FFI for DuckDB's native addon, run for the OS keychain tools, the native file dialogs (core/dialog.ts)
    // and opening the browser (compile only).
    '--allow-net',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-sys',
    '--allow-ffi',
    `--allow-run=${['security', 'secret-tool', 'powershell', 'osascript', 'zenity', 'kdialog', ...(mode === 'compile' ? ['open', 'cmd', 'xdg-open'] : [])].join(',')}`,
    '--include',
    '.output/public',
    '--include',
    '.output/server',
    ...(mode === 'desktop' ? ['--target', target] : []),
    // Self-extracting bundle; on macOS `--compress` breaks code signing (Deno 2.9.8), and the .dmg is compressed anyway.
    ...(mode === 'desktop' && os !== 'macos' ? ['--compress=xz'] : []),
    '--output',
    output,
    ...extraArgs,
    '.output/launcher/main.ts',
  ])
  if (mode === 'desktop') {
    const dist = resolve(desktop.output[os]).replace(/(\.\w+)$/, `${suffix}$1`)
    await Deno.mkdir(dirname(dist), { recursive: true })
    await Deno.rename(output, dist)

    if (!keepOutput) {
      await Deno.remove(buildDir, { recursive: true })
    }
  }

  await Deno.rename(`${DUCKDB}/${pkg}`, `${STAGING}/${pkg}`)
}
// `.output` itself runs on the host (e.g. the API test), so the host's package goes back.
const hostPkg = `node-bindings-${TARGETS[Deno.build.target]!.duckdb}`
await Deno.rename(`${STAGING}/${hostPkg}`, `${DUCKDB}/${hostPkg}`)
