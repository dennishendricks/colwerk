// `deno task dev [--desktop]`: Nuxt dev server on 127.0.0.1 with a random port and a fresh session token.
// With `--desktop` the Tauri shell (src-tauri, debug build) shows it instead of the browser.
import { mcpToken } from '../core/mcp-token.ts'
import { appUrl, createToken, freePort, onExit, removeInstance, writeInstance } from '../launcher/common.ts'

const token = createToken()
const port = Number(Deno.env.get('PORT')) || await freePort()
const url = appUrl(port, token)

console.log(`\n  Open: ${url}\n`)

const spawn = (args: string[], env: Record<string, string>) =>
  new Deno.Command(Deno.execPath(), { args, env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }).spawn()

const nuxt = spawn(['run', '-A', 'npm:nuxt', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
  COLWERK_TOKEN: token,
  COLWERK_MCP_TOKEN: (await mcpToken({ create: true }))!,
})
// The shell opens COLWERK_URL instead of starting the sidecar (debug builds only, see src-tauri/src/main.rs).
const desktop = Deno.args.includes('--desktop')
  ? spawn(['run', '-A', 'npm:@tauri-apps/cli', 'dev', '--no-watch'], { COLWERK_URL: url })
  : undefined

// MCP clients reach the dev server through `deno run -A launcher/main.ts mcp`.
writeInstance(port)
onExit(() => removeInstance(port))

const { code } = await (desktop ?? nuxt).status
Deno.exit(code)
