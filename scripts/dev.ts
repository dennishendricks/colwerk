// `deno task dev`: Nuxt dev server on 127.0.0.1 with a random port and a fresh session token.
import { appUrl, createToken, freePort } from '../launcher/common.ts'

const token = createToken()
const port = Number(Deno.env.get('PORT')) || freePort()

console.log(`\n  Open: ${appUrl(port, token)}\n`)

const child = new Deno.Command(Deno.execPath(), {
  args: ['run', '-A', 'npm:nuxt', 'dev', '--host', '127.0.0.1', '--port', String(port)],
  env: { DBM_TOKEN: token },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn()

Deno.exit((await child.status).code)
