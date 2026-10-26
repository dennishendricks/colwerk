// Entry point of the `deno compile` and `deno desktop` binaries. `scripts/package.ts` copies this
// directory to `.output/launcher/`, next to the Nitro server it starts.
//
// Starts Nitro on 127.0.0.1 with a fresh session token, then opens the UI in the desktop window
// or, for the self-hosted binary, in the default browser.
import { fileURLToPath } from 'node:url'
import { appUrl, createToken, freePort } from './common.ts'
import { prepareDuckdbNative } from './native.ts'

// Only available inside `deno desktop` binaries; not part of the default type libraries.
type MenuItem = { item: { label: string, id?: string, enabled: boolean } } | 'separator'
type BrowserWindowCtor = new (options: { title?: string, width?: number, height?: number }) => {
  bind(name: string, handler: (...args: never[]) => unknown): void
  showContextMenu(x: number, y: number, menu: MenuItem[]): void
  addEventListener(type: 'contextmenuclick', listener: (e: CustomEvent<{ id: string }>) => void): void
}
const BrowserWindow = (Deno as unknown as { BrowserWindow?: BrowserWindowCtor }).BrowserWindow

const token = createToken()
Deno.env.set('DBM_TOKEN', token)

// The desktop window loads the server root on its own once it listens, which would override a
// `navigate()` to a URL carrying the token. Instead the page fetches the token through a binding,
// registered before the server starts so it is in place when the page loads.
// The first window constructed adopts the startup window.
if (BrowserWindow) {
  const win = new BrowserWindow({ title: 'Colwerk', width: 1400, height: 900 })
  win.bind('sessionToken', () => token)
  // Native context menu for the page: resolves with the id of the chosen item. A dismissed menu fires
  // no event, so its call stays pending until the next menu resolves it with null.
  let choose: ((id: string | null) => void) | undefined
  win.addEventListener('contextmenuclick', (e) => {
    choose?.(e.detail.id)
    choose = undefined
  })
  win.bind('contextMenu', (x: number, y: number, menu: MenuItem[]) => {
    choose?.(null)
    win.showContextMenu(x, y, menu)
    return new Promise<string | null>(resolve => (choose = resolve))
  })
}

// `deno desktop` picks a random port itself and binds every Deno.serve() to it.
const desktopAddress = Deno.env.get('DENO_SERVE_ADDRESS')
const port = desktopAddress ? Number(desktopAddress.split(':').pop()) : freePort()
Deno.env.set('NITRO_HOST', '127.0.0.1')
Deno.env.set('NITRO_PORT', String(port))

// DuckDB's native library is copied on first use, not at every start: core calls this hook before
// importing `@duckdb/node-api` (`prepareDuckdb()` in core/registry.ts). It goes through globalThis
// because the bundled server does not share module instances with the launcher.
const server = fileURLToPath(new URL('../server/index.mjs', import.meta.url))
let duckdbReady: Promise<void> | undefined
Object.assign(globalThis, { dbmPrepareDuckdb: () => (duckdbReady ??= prepareDuckdbNative(server)) })
// Dynamic import so the environment above is set before Nitro reads it.
await import('../server/index.mjs')

if (!BrowserWindow) {
  const url = appUrl(port, token)
  console.log(`\n  Colwerk: ${url}\n`)
  const [cmd, ...args] = Deno.build.os === 'darwin' ? ['open', url] : Deno.build.os === 'windows' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url]
  try {
    new Deno.Command(cmd!, { args, stdout: 'null', stderr: 'null' }).spawn()
  } catch {
    // No browser opener available (e.g. headless server): the URL printed above is enough.
  }
}
