// Entry point of the `deno compile` and `deno desktop` binaries. `scripts/package.ts` copies this
// directory to `.output/launcher/`, next to the Nitro server it starts.
//
// Starts Nitro on 127.0.0.1 with a fresh session token, then opens the UI in the desktop window
// or, for the self-hosted binary, in the default browser. With the argument `mcp` it runs the stdio
// bridge for MCP clients instead (see mcp-bridge.ts).
import { mcpToken } from '../core/mcp-token.ts'
import { appUrl, createToken, freePort, onExit, openInBrowser, readWindowBounds, removeInstance, writeInstance, writeWindowBounds } from './common.ts'
import { duckdbGlobals } from './native.ts'

// Only available inside `deno desktop` binaries; not part of the default type libraries.
type MenuItem =
  | { item: { label: string, id?: string, accelerator?: string, enabled: boolean } }
  | { submenu: { label: string, items: MenuItem[] } }
  | { role: { role: string } }
  | 'separator'
type BrowserWindowCtor = new (options: { title?: string, width?: number, height?: number, x?: number, y?: number }) => {
  bind(name: string, handler: (...args: never[]) => unknown): void
  showContextMenu(x: number, y: number, menu: MenuItem[]): void
  setApplicationMenu(menu: MenuItem[]): void
  getSize(): [number, number]
  getPosition(): [number, number]
  addEventListener(type: 'contextmenuclick' | 'menuclick', listener: (e: CustomEvent<{ id: string }>) => void): void
  addEventListener(type: 'resize' | 'move', listener: () => void): void
}
const BrowserWindow = (Deno as unknown as { BrowserWindow?: BrowserWindowCtor }).BrowserWindow

if (Deno.args[0] === 'mcp') {
  await (await import('./mcp-bridge.ts')).runBridge()
  Deno.exit(0)
}

const token = createToken()
Deno.env.set('DBM_TOKEN', token)

// The desktop window loads the server root on its own once it listens, which would override a
// `navigate()` to a URL carrying the token. Instead the page fetches the token through a binding,
// registered before the server starts so it is in place when the page loads.
// The first window constructed adopts the startup window.
if (BrowserWindow) {
  const win = new BrowserWindow({ title: 'Colwerk', width: 1400, height: 900, ...readWindowBounds() })
  win.bind('sessionToken', () => token)
  // Saved on every change: by the time `close` fires the window is gone and its bounds can no longer be read.
  // There is no maximized state; a maximized or zoomed window is saved with its full size.
  const saveBounds = () => {
    const [width, height] = win.getSize()
    const [x, y] = win.getPosition()
    writeWindowBounds({ width, height, x, y })
  }
  win.addEventListener('resize', saveBounds)
  win.addEventListener('move', saveBounds)
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
  // Application menu (app/utils/application-menu.ts): the page defines it, including the enabled state of
  // its items, and waits for clicks through `menuClick`, which resolves with the id of the next chosen item.
  let clicked: ((id: string) => void) | undefined
  win.addEventListener('menuclick', e => clicked?.(e.detail.id))
  win.bind('applicationMenu', (menu: MenuItem[]) => win.setApplicationMenu(menu))
  win.bind('menuClick', () => new Promise<string>(resolve => (clicked = resolve)))
  // Release pages from the update check (app/utils/update.ts). Restricted to GitHub URLs without shell
  // metacharacters, since the page could pass anything.
  win.bind('openUrl', (url: string) => {
    if (/^https:\/\/github\.com\/[\w./-]+$/.test(url)) openInBrowser(url)
  })
}

// `deno desktop` picks a random port itself and binds every Deno.serve() to it.
const desktopAddress = Deno.env.get('DENO_SERVE_ADDRESS')
const port = desktopAddress ? Number(desktopAddress.split(':').pop()) : freePort()
Deno.env.set('NITRO_HOST', '127.0.0.1')
Deno.env.set('NITRO_PORT', String(port))

// DuckDB's native library is downloaded on demand (native.ts). `duckdb.json` only exists in packaged builds;
// without it the library comes from node_modules.
const duckdb = await Deno.readTextFile(new URL('./duckdb.json', import.meta.url)).then(JSON.parse, () => undefined)
if (duckdb) Object.assign(globalThis, duckdbGlobals(duckdb))
// Dynamic import so the environment above is set before Nitro reads it.
await import('../server/index.mjs')

// The MCP endpoint answers 401 until the token is read; the middleware reads the variable per request.
mcpToken({ create: true }).then(
  t => Deno.env.set('COLWERK_MCP_TOKEN', t!),
  e => console.error(`MCP not available: ${(e as Error).message}`),
)
writeInstance(port)
onExit(() => removeInstance(port))

if (!BrowserWindow) {
  const url = appUrl(port, token)
  console.log(`\n  Colwerk: ${url}\n`)
  // Without a browser opener (e.g. headless server) the URL printed above is enough.
  openInBrowser(url)
}
