// Entry point of `colwerk-server`, the Bun single-file executable built by scripts/package.ts: the sidecar of the
// desktop app (src-tauri) and, on its own, the self-hosted binary of `bun run compile`.
//
// Starts the server on 127.0.0.1 with a fresh session token and prints its URL once it listens. The desktop app
// reads that line and opens the URL in its window; standalone, the URL opens in the default browser. With the
// argument `mcp` it runs the stdio bridge for MCP clients instead (see mcp-bridge.ts).
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import process from 'node:process'
import { mcpToken } from '../core/mcp-token.ts'
import { appUrl, createToken, onExit, openInBrowser, removeInstance, writeInstance } from './common.ts'
import { duckdbGlobals } from './native.ts'

if (process.argv[2] === 'mcp') {
  await (await import('./mcp-bridge.ts')).runBridge()
  process.exit(0)
}

// Set by the desktop app, which keeps the sidecar's stdin open for as long as it runs: once it closes (the app
// quit or crashed), the server ends too.
const desktop = process.env.COLWERK_DESKTOP === '1'
if (desktop) process.stdin.on('close', () => process.exit(0)).resume()

const token = createToken()
process.env.COLWERK_TOKEN = token

// DuckDB's native addon is downloaded on demand (native.ts). The manifest is embedded by scripts/package.ts;
// without it (running from source) the addon comes from node_modules.
declare const COLWERK_DUCKDB: string | undefined
if (typeof COLWERK_DUCKDB !== 'undefined') Object.assign(globalThis, duckdbGlobals(JSON.parse(COLWERK_DUCKDB)))

// Dynamic import so the environment above is set before Nitro reads it. scripts/package.ts resolves this path
// to the Nitro build (preset `node-listener`).
// @ts-expect-error -- the path only exists after the bundler's resolution
const { listener } = (await import('../server/index.mjs')) as { listener: RequestListener }
const server = createServer(listener)
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address() as AddressInfo

// The MCP endpoint answers 401 until the token is read; the middleware reads the variable per request.
mcpToken({ create: true }).then(
  (t) => (process.env.COLWERK_MCP_TOKEN = t!),
  (e) => console.error(`MCP not available: ${(e as Error).message}`),
)
writeInstance(port)
onExit(() => removeInstance(port))

const url = appUrl(port, token)
console.log(`\n  Colwerk: ${url}\n`)
// Without a browser opener (e.g. headless server) the URL printed above is enough.
if (!desktop) openInBrowser(url)
