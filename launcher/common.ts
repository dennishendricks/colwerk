import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import process from 'node:process'
import { defaultDataDir } from '../core/data-dir.ts'

export function createToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Reserves a random free port on 127.0.0.1 (for the Nuxt dev server, which takes a port number). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
      .once('error', reject)
      .listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number }
        server.close(() => resolve(port))
      })
  })
}

/** The token travels in the URL fragment, which is never sent to the server or written to access logs. */
export function appUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/#token=${token}`
}

/** Opens `url` in the default browser; on Windows it passes through `cmd`, so it must not contain `&`, `^` etc. */
export function openInBrowser(url: string): void {
  const [cmd, ...args] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  // No browser opener available (e.g. headless server): the printed URL is enough.
  spawn(cmd!, args, { stdio: 'ignore', detached: true, windowsHide: true })
    .on('error', () => {})
    .unref()
}

// `instance.json` in the data directory tells the MCP bridge (`colwerk-server mcp`) the port of the running
// app. Not secret: requests also need the MCP token.
const instanceFile = () => join(defaultDataDir(), 'instance.json')

export function writeInstance(port: number): void {
  mkdirSync(defaultDataDir(), { recursive: true })
  writeFileSync(instanceFile(), JSON.stringify({ port }))
}

export function readInstance(): { port: number } | undefined {
  try {
    return JSON.parse(readFileSync(instanceFile(), 'utf8'))
  } catch {
    return undefined
  }
}

/** Removes the file unless another instance has taken it over meanwhile. */
export function removeInstance(port: number): void {
  if (readInstance()?.port === port) rmSync(instanceFile(), { force: true })
}

/** Runs `cleanup` when the process ends normally or by Ctrl+C / SIGTERM. */
export function onExit(cleanup: () => void): void {
  process.on('exit', cleanup)
  process.on('SIGINT', () => process.exit(130))
  process.on('SIGTERM', () => process.exit(143))
}
