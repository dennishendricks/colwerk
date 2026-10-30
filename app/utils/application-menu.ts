// Desktop app only: the native application menu (macOS menu bar), set and answered through the launcher
// (see launcher/main.ts). In the browser there is no such menu and these functions do nothing.
export type ApplicationMenuItem =
  | { item: { label: string, id: string, accelerator?: string, enabled: boolean } }
  | { submenu: { label: string, items: ApplicationMenuItem[] } }
  | { role: { role: string } }
  | 'separator'

const bindings = (window as { bindings?: { applicationMenu?(menu: ApplicationMenuItem[]): Promise<void>, menuClick?(): Promise<string> } }).bindings

export const hasApplicationMenu = !!bindings?.applicationMenu

// The native menu is only rebuilt when it actually changes, not on every reactive update (e.g. each keystroke).
let current = ''
export function setApplicationMenu(menu: ApplicationMenuItem[]) {
  const json = JSON.stringify(menu)
  if (json === current) return
  current = json
  bindings?.applicationMenu?.(menu)
}

const sources = new Set<() => Partial<Record<string, () => unknown>>>()

/** Handlers for menu item ids, registered while the calling component is mounted. */
export function defineMenuHandlers(handlers: MaybeRefOrGetter<Partial<Record<string, () => unknown>>>) {
  const get = () => toValue(handlers)
  sources.add(get)
  onBeforeUnmount(() => sources.delete(get))
}

async function listen() {
  for (;;) {
    const id = await bindings!.menuClick!()
    for (const get of sources) get()[id]?.()
  }
}
if (bindings?.menuClick) listen()
