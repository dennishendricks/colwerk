// Native parts of the desktop app (src-tauri) through Tauri's JS API: menus and file dialogs. The page is served
// by the sidecar on 127.0.0.1, which src-tauri/capabilities allows to use them. In the browser (dev server,
// self-hosted binary) there are no native menus, and file dialogs open through the server (core/dialog.ts).
import { isTauri } from '@tauri-apps/api/core'
import { LogicalPosition } from '@tauri-apps/api/dpi'
import {
  type CheckMenuItemOptions,
  Menu,
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from '@tauri-apps/api/menu'
import { open, save } from '@tauri-apps/plugin-dialog'
import { api } from './api'

export const isDesktop = isTauri()

/** Items with `checked` show a checkmark. Roles are the platform's own items (see `PredefinedMenuItemOptions`). */
export type MenuEntry =
  | { label: string; action: () => unknown; enabled?: boolean; checked?: boolean; accelerator?: string }
  | { label: string; items: MenuEntry[] }
  | { role: NonNullable<Extract<PredefinedMenuItemOptions['item'], string>> }
  | 'separator'

type NativeItem = MenuItemOptions | CheckMenuItemOptions | PredefinedMenuItemOptions | SubmenuOptions

function native(entry: MenuEntry): NativeItem {
  if (entry === 'separator') return { item: 'Separator' }
  if ('role' in entry) return { item: entry.role }
  if ('items' in entry) return { text: entry.label, items: entry.items.map(native) }
  const { label: text, action, enabled = true, checked, accelerator } = entry
  return { text, enabled, accelerator, action: () => action(), ...(checked === undefined ? {} : { checked }) }
}

/** Builds a native menu; the previous one is released once replaced. */
export function createMenu(entries: MenuEntry[]): Promise<Menu> {
  return Menu.new({ items: entries.map(native) })
}

let context: Menu | undefined

/** Shows a native context menu at the pointer (desktop app only); the chosen item's action runs. */
export async function showContextMenu(e: MouseEvent, entries: MenuEntry[]): Promise<void> {
  e.preventDefault()
  await context?.close()
  context = await createMenu(entries)
  await context.popup(new LogicalPosition(e.clientX, e.clientY))
}

/** Asks for a file to open or save, or a folder; resolves with its absolute path, null if the user cancelled. */
export async function fileDialog(
  kind: 'open' | 'save' | 'folder',
  title: string,
  defaultName?: string,
): Promise<string | null> {
  if (isDesktop)
    return kind === 'save' ? save({ title, defaultPath: defaultName }) : open({ title, directory: kind === 'folder' })
  const { path } = await api<{ path: string | null }>('/api/dialog', {
    method: 'POST',
    body: { kind, title, defaultName },
  })
  return path
}
