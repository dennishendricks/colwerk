// `deno task dev`: Nuxt dev server on 127.0.0.1 with a random port and a fresh session token.
import { mcpToken } from '../core/mcp-token.ts'
import { appUrl, createToken, freePort, onExit, removeInstance, writeInstance } from '../launcher/common.ts'

const token = createToken()
const port = Number(Deno.env.get('PORT')) || freePort()

console.log(`\n  Open: ${appUrl(port, token)}\n`)

const child = new Deno.Command(Deno.execPath(), {
  args: ['run', '-A', 'npm:nuxt', 'dev', '--host', '127.0.0.1', '--port', String(port)],
  env: { DBM_TOKEN: token, COLWERK_MCP_TOKEN: (await mcpToken({ create: true }))! },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn()

// MCP clients reach the dev server through `deno run -A launcher/main.ts mcp`.
writeInstance(port)
onExit(() => removeInstance(port))

Deno.exit((await child.status).code)
