import { join } from 'node:path'
import { defaultDataDir } from '../core/data-dir.ts'

export function createToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
}

/** Reserves a random free port on 127.0.0.1. */
export function freePort(): number {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  const { port } = listener.addr as Deno.NetAddr
  listener.close()
  return port
}

/** The token travels in the URL fragment, which is never sent to the server or written to access logs. */
export function appUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/#token=${token}`
}

/** Opens `url` in the default browser; on Windows it passes through `cmd`, so it must not contain `&`, `^` etc. */
export function openInBrowser(url: string): void {
  const [cmd, ...args] = Deno.build.os === 'darwin' ? ['open', url] : Deno.build.os === 'windows' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url]
  try {
    new Deno.Command(cmd!, { args, stdout: 'null', stderr: 'null' }).spawn()
  } catch {
    // No browser opener available (e.g. headless server).
  }
}

// `instance.json` in the data directory tells the MCP bridge (`colwerk mcp`) the port of the running
// app. Not secret: requests also need the MCP token.
const instanceFile = () => join(defaultDataDir(), 'instance.json')

export function writeInstance(port: number): void {
  Deno.mkdirSync(defaultDataDir(), { recursive: true })
  Deno.writeTextFileSync(instanceFile(), JSON.stringify({ port }))
}

export function readInstance(): { port: number } | undefined {
  try {
    return JSON.parse(Deno.readTextFileSync(instanceFile()))
  } catch {
    return undefined
  }
}

/** Removes the file unless another instance has taken it over meanwhile. */
export function removeInstance(port: number): void {
  if (readInstance()?.port === port) Deno.removeSync(instanceFile())
}

// `window.json` in the data directory keeps the desktop window's size and position across runs; Deno does
// not restore them itself. Size is the content size, which both the constructor and `getSize()` use.
export interface WindowBounds { width: number, height: number, x: number, y: number }

const windowFile = () => join(defaultDataDir(), 'window.json')

export function readWindowBounds(): WindowBounds | undefined {
  try {
    return JSON.parse(Deno.readTextFileSync(windowFile()))
  } catch {
    return undefined
  }
}

export function writeWindowBounds(bounds: WindowBounds): void {
  Deno.mkdirSync(defaultDataDir(), { recursive: true })
  Deno.writeTextFileSync(windowFile(), JSON.stringify(bounds))
}

/** Runs `cleanup` when the process ends normally or by Ctrl+C / SIGTERM, then exits. */
export function onExit(cleanup: () => void): void {
  globalThis.addEventListener('unload', cleanup)
  for (const signal of Deno.build.os === 'windows' ? ['SIGINT'] as const : ['SIGINT', 'SIGTERM'] as const) {
    Deno.addSignalListener(signal, () => Deno.exit(130))
  }
}
