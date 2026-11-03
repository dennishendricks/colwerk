// Collects the license texts of everything the packaged app contains: the npm packages bundled into the client
// and server (recorded during `nuxt build`, see nuxt.config.ts) and the Deno runtime.
import { join } from 'node:path'

const DENO_LICENSE = `MIT License

Copyright 2018-2026 the Deno authors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`

type Package = { name: string; version: string; license?: string; text?: string }

async function readPackage(dir: string): Promise<Package> {
  const { name, version, license } = JSON.parse(await Deno.readTextFile(join(dir, 'package.json')))
  let text: string | undefined
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && /^(licen[cs]e|copying)/i.test(entry.name)) text = await Deno.readTextFile(join(dir, entry.name))
  }
  return { name, version, license: typeof license === 'string' ? license : license?.type, text }
}

/** Writes `THIRD_PARTY_LICENSES.txt` to `file`. */
export async function writeThirdPartyLicenses(file: string): Promise<void> {
  const bundled: string[] = JSON.parse(await Deno.readTextFile('.nuxt/bundled-packages.json'))
  const packages = new Map<string, Package>()
  for (const dir of bundled) {
    const pkg = await readPackage(dir)
    // The app's own sources resolve to the project root, which is no third-party package.
    if (pkg.name !== 'colwerk') packages.set(`${pkg.name}@${pkg.version}`, pkg)
  }
  const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))
  const entries = [{ name: 'Deno', version: Deno.version.deno, license: 'MIT', text: DENO_LICENSE }, ...sorted]
  const rule = '='.repeat(80)
  const body = entries.map((p) =>
    `${rule}\n${p.name} ${p.version} (${p.license ?? 'unknown license'})\n${rule}\n\n${
      p.text?.trim() ?? 'No license text included in the package.'
    }\n`
  )
  await Deno.writeTextFile(file, `Colwerk contains the following third-party software.\n\n${body.join('\n')}`)
}
