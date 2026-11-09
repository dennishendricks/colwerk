// `bun scripts/update-manifest.ts <dir> <tag> <owner/repo>`: writes `<dir>/latest.json`, the manifest of
// tauri-plugin-updater, from the update packages and their signatures (`.sig`) that scripts/package.ts put into
// `<dir>`. The release workflow uploads it with the draft; the app reads it from the latest published release
// (`releases/latest/download/latest.json`, see src-tauri/tauri.conf.json), so a draft is not offered until it is
// published.
//
// Keys are `<os>-<arch>`. Linux has no update package: a .deb installation finds no update and the app falls back to
// the release page.
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const [dir, tag, repo] = process.argv.slice(2)
if (!dir || !tag || !repo) {
  console.error('usage: bun scripts/update-manifest.ts <dir> <tag> <owner/repo>')
  process.exit(2)
}

/** Update package (suffix of the file name from scripts/package.ts) → manifest key. */
const PLATFORMS: Record<string, string> = {
  '-macos-arm64.app.tar.gz': 'darwin-aarch64',
  '-windows-x64-setup.exe': 'windows-x86_64',
}

const platforms: Record<string, { signature: string; url: string }> = {}
for (const file of await readdir(dir)) {
  if (!file.endsWith('.sig')) continue
  const pkg = file.slice(0, -'.sig'.length)
  const key = Object.entries(PLATFORMS).find(([suffix]) => pkg.endsWith(suffix))?.[1]
  if (!key) continue
  platforms[key] = {
    signature: (await Bun.file(join(dir, file)).text()).trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${pkg}`,
  }
}
if (!Object.keys(platforms).length) {
  console.error(`No signed update packages in ${dir}.`)
  process.exit(1)
}

const manifest = {
  version: tag.replace(/^v/, ''),
  notes: `https://github.com/${repo}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
}
await Bun.write(join(dir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`latest.json: ${Object.keys(platforms).join(', ')}`)
