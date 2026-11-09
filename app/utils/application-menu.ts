// Desktop app only: the native application menu (menu bar on macOS, window menu on Windows and Linux). In the
// browser there is no such menu and these functions do nothing.
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createMenu, isDesktop, type MenuEntry } from './desktop'

/** An application menu entry: items name their handler by id instead of carrying an action. */
export type ApplicationMenuItem =
  | { id: string; label: string; enabled?: boolean; checked?: boolean; accelerator?: string }
  | { label: string; items: ApplicationMenuItem[] }
  | Extract<MenuEntry, { role: string }>
  | 'separator'

const sources = new Set<() => Partial<Record<string, () => unknown>>>()

/** Handlers for menu item ids, registered while the calling component is mounted. */
export function defineMenuHandlers(handlers: MaybeRefOrGetter<Partial<Record<string, () => unknown>>>) {
  const get = () => toValue(handlers)
  sources.add(get)
  onBeforeUnmount(() => sources.delete(get))
}

let shown: ApplicationMenuItem[] = []
let current = ''
let queue = Promise.resolve()
// Each window sets its own menu, whose items act on that window: only the focused window's menu is shown.
let focused = true
if (isDesktop)
  void getCurrentWindow().onFocusChanged(({ payload }) => {
    focused = payload
    if (focused && shown.length) setApplicationMenu(shown, true)
  })

function withActions(entry: ApplicationMenuItem): MenuEntry {
  if (entry === 'separator' || 'role' in entry) return entry
  if ('items' in entry) return { label: entry.label, items: entry.items.map(withActions) }
  const { id, ...item } = entry
  return {
    ...item,
    action: () => {
      for (const get of sources) get()[id]?.()
      // A check item toggles itself when clicked, also when its handler changes nothing: the menu is set again,
      // showing the state the handler left.
      if (entry.checked !== undefined) setApplicationMenu(shown, true)
    },
  }
}

/** Sets the menu; it is only rebuilt when it actually changes, not on every reactive update (e.g. each keystroke). */
export function setApplicationMenu(menu: ApplicationMenuItem[], force = false) {
  const json = JSON.stringify(menu)
  if (!isDesktop || (json === current && !force)) return
  current = json
  shown = menu
  if (!focused) return
  // One after another, so the last menu set is the one shown.
  queue = queue
    .then(async () => {
      const previous = await (await createMenu(menu.map(withActions))).setAsAppMenu()
      await previous?.close()
    })
    .catch((e) => console.error('Application menu:', e))
}
