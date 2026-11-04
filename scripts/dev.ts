// `bun run dev [--desktop]`: Nuxt dev server on 127.0.0.1 with a random port and a fresh session token.
// With `--desktop` the Tauri shell (src-tauri, debug build) shows it instead of the browser.
import { mcpToken } from '../core/mcp-token.ts'
import { appUrl, createToken, freePort, onExit, removeInstance, writeInstance } from '../launcher/common.ts'

const token = createToken()
const port = Number(process.env.PORT) || (await freePort())
const url = appUrl(port, token)

console.log(`\n  Open: ${url}\n`)

const spawn = (args: string[], env: Record<string, string>) =>
  Bun.spawn([process.execPath, '--bun', ...args], {
    env: { ...process.env, ...env },
    stdio: ['inherit', 'inherit', 'inherit'],
  })

const nuxt = spawn(['nuxt', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
  COLWERK_TOKEN: token,
  COLWERK_MCP_TOKEN: (await mcpToken({ create: true }))!,
})
// The shell opens COLWERK_URL instead of starting the sidecar (debug builds only, see src-tauri/src/main.rs).
const desktop = process.argv.includes('--desktop')
  ? spawn(['tauri', 'dev', '--no-watch'], { COLWERK_URL: url })
  : undefined

// MCP clients reach the dev server through `bun launcher/main.ts mcp`.
writeInstance(port)
onExit(() => removeInstance(port))

process.exit(await (desktop ?? nuxt).exited)
