import { exit } from '@tauri-apps/plugin-process'
import type { ApplicationMenuItem } from '~/utils/application-menu'

/** Actions of the menu that open or toggle parts of the page owned by the caller. */
interface MenuViewActions {
  openMcp: () => void
  openHistory: () => void
  openShortcuts: () => void
  openAbout: () => void
  openConnection: () => void
  toggleSidebar: () => void
}

// Native application menu (desktop app). On macOS the page sees each key first: a shortcut it handles calls
// preventDefault, which keeps the menu item with the same accelerator from firing as well. On Windows and Linux
// the menu takes its accelerators before the page; both run the same handler. ⌘↵ and ⇧⌘[ / ⇧⌘] stay with the
// page, which treats them differently depending on the focus. ⌘= (zoom in) is only handled by the page.
// The platform's own items (roles) are only used on macOS, where Tauri implements all of them.
export function useApplicationMenu(view: MenuViewActions) {
  const { activeConnection, activeConnectionId, activeDatabase, driverOf } = useConnections()
  const { canToggle, togglingConnection, toggleConnection } = useConnectionToggle()
  const { tabs, activeTabId, activeTab, addTab, duplicateTab, requestClose, selectTab, cycleTab, openFile, saveFile } =
    useTabs()
  const { t, locale, locales, setLocale } = useI18n()
  const chosenLocale = useChosenLocale()
  const colorMode = useColorMode()
  const { macOS } = useKbd()
  const { zoomIn, zoomOut, resetZoom } = useZoom()

  watchEffect(() => {
    if (!isDesktop) return
    const tab = activeTab.value
    const busy = !!tab && (tab.running || !!tab.exporting)
    const shown = tab?.result?.resultSets[tab.resultIndex]
    const item = (label: string, id: string, enabled = true, accelerator?: string): ApplicationMenuItem => ({
      label,
      id,
      enabled,
      accelerator,
    })
    const check = (label: string, id: string, checked: boolean): ApplicationMenuItem => ({ label, id, checked })
    const submenu = (label: string, items: ApplicationMenuItem[]): ApplicationMenuItem => ({ label, items })
    const roles = (...roles: (Extract<ApplicationMenuItem, { role: string }>['role'] | 'separator')[]) =>
      macOS.value ? roles.map((role) => (role === 'separator' ? role : { role })) : []
    setApplicationMenu([
      // macOS replaces the label of the first menu with the app name.
      submenu('Colwerk', [
        // On Windows and Linux in the Help menu.
        ...(macOS.value ? [item(t('menu.about'), 'about'), 'separator' as const] : []),
        item(t('menu.setupMcp'), 'mcp'),
        item(t('menu.checkUpdates'), 'update'),
        'separator',
        ...(macOS.value ? roles('Quit') : [item(t('menu.quit'), 'quit')]),
      ]),
      submenu(t('menu.file'), [
        item(t('menu.newTab'), 'new-tab', true, 'CmdOrCtrl+T'),
        item(t('menu.duplicateTab'), 'duplicate-tab', !!tab, 'CmdOrCtrl+Shift+D'),
        'separator',
        item(t('menu.open'), 'open', true, 'CmdOrCtrl+O'),
        item(t('menu.save'), 'save', !!tab, 'CmdOrCtrl+S'),
        item(t('menu.saveAs'), 'save-as', !!tab, 'CmdOrCtrl+Shift+S'),
        'separator',
        item(t('menu.newConnection'), 'new-connection'),
        item(
          activeConnection.value?.disconnected ? t('menu.connect') : t('menu.disconnect'),
          'toggle-connection',
          canToggle.value && !togglingConnection.value,
        ),
        'separator',
        item(t('menu.exportResult'), 'export', !!tab && !tab.error && !!shown?.columns.length && !busy),
        'separator',
        item(t('menu.closeTab'), 'close-tab', !!tab, 'CmdOrCtrl+W'),
      ]),
      submenu(t('menu.edit'), [
        ...roles('Undo', 'Redo', 'separator', 'Cut', 'Copy', 'Paste', 'SelectAll', 'separator'),
        item(t('menu.format'), 'format', !!tab?.sql.trim(), 'CmdOrCtrl+Shift+F'),
      ]),
      submenu(t('menu.query'), [
        item(t('menu.run'), 'run', !!tab?.connectionId && !tab.exporting),
        item(t('menu.explain'), 'explain', !!tab?.connectionId && !busy, 'CmdOrCtrl+E'),
        item(
          t('menu.cancel'),
          'cancel',
          busy && tab?.exporting !== 'cancelled' && !!driverOf(tab?.connectionId)?.capabilities.supportsCancel,
        ),
        'separator',
        // A failed transaction can only be rolled back.
        item('Commit', 'commit', tab?.transaction === 'open' && !busy),
        item('Rollback', 'rollback', !!tab?.transaction && !busy),
        'separator',
        item(t('menu.history'), 'history'),
      ]),
      submenu(t('menu.view'), [
        item(t('menu.sidebar'), 'sidebar', true, 'CmdOrCtrl+B'),
        ...roles('Fullscreen'),
        'separator',
        item(t('menu.zoomIn'), 'zoom-in', true, 'CmdOrCtrl+Plus'),
        item(t('menu.zoomOut'), 'zoom-out', true, 'CmdOrCtrl+-'),
        item(t('menu.actualSize'), 'actual-size', true, 'CmdOrCtrl+0'),
        'separator',
        check(t('menu.designSystem'), 'design-system', colorMode.preference === 'system'),
        check(t('menu.designLight'), 'design-light', colorMode.preference === 'light'),
        check(t('menu.designDark'), 'design-dark', colorMode.preference === 'dark'),
        'separator',
        // Each language under its own name, so it can be found in a language one cannot read.
        ...locales.value.map((l) => check(l.name!, `locale-${l.code}`, l.code === locale.value)),
      ]),
      submenu(t('menu.window'), [
        ...roles('Minimize', 'separator'),
        item(t('menu.previousTab'), 'previous-tab', tabs.value.length > 1),
        item(t('menu.nextTab'), 'next-tab', tabs.value.length > 1),
        'separator',
        ...tabs.value
          .slice(0, 9)
          .map((t, i) => item(t.title, `tab-${i + 1}`, t.id !== activeTabId.value, `CmdOrCtrl+${i + 1}`)),
      ]),
      submenu(t('menu.help'), [
        item(t('menu.shortcuts'), 'shortcuts'),
        item(t('menu.releaseNotes'), 'release-notes'),
        'separator',
        item(t('menu.privacy'), 'privacy'),
        item(t('menu.exportDiagnostics'), 'diagnostics'),
        ...(macOS.value ? [] : ['separator' as const, item(t('menu.about'), 'about')]),
      ]),
    ])
  })

  defineMenuHandlers({
    mcp: view.openMcp,
    update: () => checkForUpdate(true),
    quit: () => exit(),
    privacy: () => openUrl(privacyUrl),
    diagnostics: exportDiagnostics,
    'new-tab': () => addTab(activeConnectionId.value, activeDatabase.value),
    'duplicate-tab': () => duplicateTab(activeTab.value),
    open: () => openFile(activeConnectionId.value, activeDatabase.value),
    save: () => saveFile(activeTab.value),
    'save-as': () => saveFile(activeTab.value, true),
    'new-connection': view.openConnection,
    'toggle-connection': () => toggleConnection(),
    'close-tab': () => requestClose(activeTab.value),
    history: view.openHistory,
    sidebar: view.toggleSidebar,
    'zoom-in': zoomIn,
    'zoom-out': zoomOut,
    'actual-size': resetZoom,
    'design-system': () => (colorMode.preference = 'system'),
    'design-light': () => (colorMode.preference = 'light'),
    'design-dark': () => (colorMode.preference = 'dark'),
    ...Object.fromEntries(
      locales.value.map((l) => [
        `locale-${l.code}`,
        () => {
          chosenLocale.value = l.code
          return setLocale(l.code)
        },
      ]),
    ),
    'previous-tab': () => cycleTab(-1),
    'next-tab': () => cycleTab(1),
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`tab-${i + 1}`, () => selectTab(i)])),
    shortcuts: view.openShortcuts,
    about: view.openAbout,
  })
}
