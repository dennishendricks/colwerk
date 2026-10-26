// `deno task release`: bumps the version in package.json, builds all desktop targets, pushes the commit with
// the tag `v<version>` and creates a draft GitHub release with the contents of `dist` and their SHA-256 sums.
// The draft is not visible to the update check (app/utils/update.ts) until it is published on GitHub.
// Requires the GitHub CLI (`gh`), logged in with push access.

async function exec(cmd: string, args: string[]) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  const { code } = await new Deno.Command(cmd, { args, stdout: 'inherit', stderr: 'inherit' }).spawn().status
  return code === 0
}

async function output(cmd: string, args: string[]) {
  const { code, stdout } = await new Deno.Command(cmd, { args, stderr: 'inherit' }).output()
  if (code !== 0) Deno.exit(code)
  return new TextDecoder().decode(stdout).trim()
}

function fail(message: string): never {
  console.error(message)
  Deno.exit(1)
}

// The release is built from exactly what is pushed: a clean `main` that matches `origin/main`.
if (await output('git', ['branch', '--show-current']) !== 'main') fail('Releases are made from main.')
if (await output('git', ['status', '--porcelain'])) fail('The working tree has uncommitted changes.')
await output('git', ['fetch', 'origin', 'main'])
if (await output('git', ['rev-parse', 'HEAD']) !== await output('git', ['rev-parse', 'origin/main'])) fail('main is not in sync with origin/main.')
if (!await exec('gh', ['auth', 'status'])) fail('The GitHub CLI is not logged in (gh auth login).')

const packageJson = await Deno.readTextFile('package.json')
const current = JSON.parse(packageJson).version as string
const [major, minor, patch] = current.split('.').map(Number) as [number, number, number]
const bumps: Record<string, string> = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}
const type = prompt(`Current version ${current}. Release type (major/minor/patch):`)?.trim() ?? ''
const version = bumps[type] ?? fail(`Unknown release type "${type}".`)
const tag = `v${version}`
if (!confirm(`Release ${tag}?`)) Deno.exit(0)

// Replaces only the value, so the formatting of package.json stays as it is.
await Deno.writeTextFile('package.json', packageJson.replace(`"version": "${current}"`, `"version": "${version}"`))

// `dist` is emptied first, so only this build's files end up in the release.
await Deno.remove('dist', { recursive: true }).catch(() => {})
if (!await exec(Deno.execPath(), ['task', 'desktop', '--all-targets'])) {
  await Deno.writeTextFile('package.json', packageJson)
  fail('Build failed, package.json is reset.')
}

const files = [...Deno.readDirSync('dist')].filter(entry => entry.isFile && !entry.name.startsWith('.')).map(entry => entry.name).sort()
const sums = []
for (const file of files) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await Deno.readFile(`dist/${file}`)))
  sums.push(`${Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')}  ${file}\n`)
}
await Deno.writeTextFile('dist/SHA256SUMS.txt', sums.join(''))

if (!await exec('git', ['commit', '-m', `Release ${tag}`, 'package.json'])) fail('Commit failed.')
if (!await exec('git', ['tag', '-a', tag, '-m', `Release ${tag}`])) fail('Tagging failed.')
if (!await exec('git', ['push', '--atomic', 'origin', 'main', tag])) fail('Push failed.')

const assets = [...files, 'SHA256SUMS.txt'].map(file => `dist/${file}`)
if (!await exec('gh', ['release', 'create', tag, '--draft', '--verify-tag', '--title', `Colwerk ${version}`, '--generate-notes', ...assets])) {
  fail(`Creating the release failed; ${tag} is pushed, retry with gh release create.`)
}
console.log(`Draft release ${tag} created. Check it and publish it on GitHub.`)
