// `bun run release`: bumps the version in package.json and pushes the commit with the tag `v<version>`.
// The tag starts .github/workflows/release.yml, which builds all desktop targets and creates a draft GitHub
// release with the contents of `dist` (including the signed update packages and their `latest.json`), their SHA-256
// sums and build provenance attestations. The draft is not visible to the update check (app/utils/update.ts) and
// the auto update until it is published on GitHub.

async function exec(cmd: string, args: string[]) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  return (await Bun.spawn([cmd, ...args], { stdio: ['inherit', 'inherit', 'inherit'] }).exited) === 0
}

async function output(cmd: string, args: string[]) {
  const proc = Bun.spawn([cmd, ...args], { stderr: 'inherit' })
  const stdout = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) process.exit(proc.exitCode!)
  return stdout.trim()
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

// The release is built from exactly what is pushed: a clean `main` that matches `origin/main`.
if ((await output('git', ['branch', '--show-current'])) !== 'main') fail('Releases are made from main.')
if (await output('git', ['status', '--porcelain'])) fail('The working tree has uncommitted changes.')
await output('git', ['fetch', 'origin', 'main'])
if ((await output('git', ['rev-parse', 'HEAD'])) !== (await output('git', ['rev-parse', 'origin/main']))) {
  fail('main is not in sync with origin/main.')
}

const packageJson = await Bun.file('package.json').text()
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
if (!confirm(`Release ${tag}?`)) process.exit(0)

// Replaces only the value, so the formatting of package.json stays as it is.
await Bun.write('package.json', packageJson.replace(`"version": "${current}"`, `"version": "${version}"`))

if (!(await exec('git', ['commit', '-m', `Release ${tag}`, 'package.json']))) fail('Commit failed.')
if (!(await exec('git', ['tag', '-a', tag, '-m', `Release ${tag}`]))) fail('Tagging failed.')
if (!(await exec('git', ['push', '--atomic', 'origin', 'main', tag]))) fail('Push failed.')

console.log(`${tag} pushed. The release workflow builds it and creates a draft release; publish it on GitHub.`)
