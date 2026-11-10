import type { Ref } from 'vue'
import type { QueryResult, ResultSet } from '#core'
import { invoke } from '@tauri-apps/api/core'
import { emitTo } from '@tauri-apps/api/event'
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window'

// Editor tabs: each tab owns a dedicated server-side session (keyed by tab id).

/** A result set kept in the tab while new executions replace `result`. In memory only, like `result`. */
export interface PinnedResult {
  id: string
  set: ResultSet
  /** Script that produced `set`, whose `statement` points into it (for exporting the full result). */
  source: { connectionId: string; database?: string; sql: string }
  executedAt: number
  durationMs: number
}

export interface QueryTab {
  id: string
  title: string
  connectionId?: string
  /** Database of the connection the tab runs in; undefined = the connection's default. */
  database?: string
  sql: string
  /** File the query was opened from or last saved to. */
  path?: string
  rowLimit: number
  /** Seconds after which the server cancels the statement. */
  timeout: number
  /** Last values entered for the query's `${name}` variables. */
  variables?: Record<string, string>
  running: boolean
  result?: QueryResult
  /** When `result` arrived (ms since epoch). */
  executedAt?: number
  /** Index of the result set shown (scripts can return several). */
  resultIndex: number
  pinned?: PinnedResult[]
  /** Pinned result shown instead of `result`, or next to it while `compare` is set. */
  viewPin?: string
  compare?: boolean
  /** Connection and script that produced `result` (for exporting the full result of one of its statements). */
  source?: { connectionId: string; database?: string; sql: string }
  /** Execution plan shown instead of `result` (cleared by the next execute and vice versa). */
  plan?: { text: string; durationMs: number; executedAt: number }
  /** Set while a download is being written; `cancelled` after the user aborted it. */
  exporting?: 'running' | 'cancelled'
  error?: string
  /** Document offset of the error in the editor, when the database reports it. */
  errorAt?: number
  /** Transaction left open in the tab's session by the last execute (unset when none or unknown). */
  transaction?: 'open' | 'failed'
}

// Explicit type: unwrapping the recursive CellValue type would be "excessively deep".
const tabs: Ref<QueryTab[]> = ref([])
const activeTabId = ref<string>()
const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value))
// Tabs that wait for confirmation because they still contain a query or an open transaction.
const closing = ref<string[]>([])
const closingTabs = computed(() => tabs.value.filter((t) => closing.value.includes(t.id)))
let tabCounter = 0

// Editor content and settings of the open tabs are saved on the server per window (results are not).
type SavedTab = Pick<
  QueryTab,
  'id' | 'title' | 'connectionId' | 'database' | 'sql' | 'path' | 'rowLimit' | 'timeout' | 'variables'
>
interface SavedWorkspace {
  tabs: SavedTab[]
  activeTabId?: string
}
/** A tab handed back to the main window when its window closes, with its transaction still open on the server. */
export type ReturnedTab = SavedTab & Pick<QueryTab, 'transaction'>
const returned = (tab: QueryTab): ReturnedTab => ({ ...saved(tab), transaction: tab.transaction })

const saved = ({ id, title, connectionId, database, sql, path, rowLimit, timeout, variables }: QueryTab): SavedTab => ({
  id,
  title,
  connectionId,
  database,
  sql,
  path,
  rowLimit,
  timeout,
  variables,
})

const saveWorkspace = (window: string, workspace: SavedWorkspace) =>
  api('/api/workspace', { method: 'POST', body: { window, ...workspace } })

let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => JSON.stringify({ window: windowLabel, tabs: tabs.value.map(saved), activeTabId: activeTabId.value }),
  (body) => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => api('/api/workspace', { method: 'POST', body }), 300)
  },
)

/** Whether a tab of the connection has a transaction open. */
export const hasOpenTransaction = (connectionId: string) =>
  tabs.value.some((t) => t.connectionId === connectionId && t.transaction)

/** After disconnecting: the server rolled back the transactions of the connection's tabs. */
export function forgetTransactions(connectionId: string) {
  for (const tab of tabs.value) {
    if (tab.connectionId === connectionId) tab.transaction = undefined
  }
}

/** File name without directory and `.sql` extension, used as tab title. */
const fileTitle = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()!
    .replace(/\.sql$/i, '')

export function useTabs() {
  const { t } = useNuxtApp().$i18n
  const toast = useToast()

  async function restoreTabs() {
    const { windows } = await api<{ windows: Record<string, SavedWorkspace> }>('/api/workspace')
    const own = windows[windowLabel] ?? { tabs: [] }
    tabs.value = own.tabs.map((t) => ({ ...t, running: false, resultIndex: 0 }))
    activeTabId.value = tabs.value.some((t) => t.id === own.activeTabId) ? own.activeTabId : tabs.value[0]?.id
    // The main window opens the other windows of the last run again.
    if (isDesktop && windowLabel === 'main') {
      for (const label of Object.keys(windows).filter((l) => l !== 'main'))
        invoke('open_window', { label }).catch((e) => failed(t('app.openFailed'), e))
    }
    // Only titles in the current language count; those of another language may repeat a number.
    const untitled = new RegExp(`^${t('tabs.untitled', { n: '(\\d+)' })}$`)
    tabCounter = Math.max(0, ...tabs.value.map((tab) => Number(tab.title.match(untitled)?.[1] ?? 0)))
  }

  function addTab(connectionId?: string, database?: string) {
    const tab: QueryTab = {
      id: crypto.randomUUID(),
      title: t('tabs.untitled', { n: ++tabCounter }),
      connectionId,
      database,
      sql: '',
      rowLimit: 200,
      timeout: 60,
      running: false,
      resultIndex: 0,
    }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    // The reactive proxy, not `tab`: changes made through the raw object would not update the UI.
    return tabs.value.at(-1)!
  }

  function duplicateTab(tab?: QueryTab) {
    if (!tab) return
    const copy = addTab(tab.connectionId, tab.database)
    Object.assign(copy, {
      title: t('app.copySuffix', { title: tab.title }),
      sql: tab.sql,
      rowLimit: tab.rowLimit,
      timeout: tab.timeout,
      variables: tab.variables && { ...tab.variables },
    })
  }

  /** Removes the tab from the window; its session on the server stays. */
  function removeTab(id: string) {
    const index = tabs.value.findIndex((t) => t.id === id)
    if (index === -1) return false
    tabs.value.splice(index, 1)
    if (activeTabId.value === id) activeTabId.value = tabs.value[Math.max(0, index - 1)]?.id
    return true
  }

  async function closeTab(id: string) {
    if (!removeTab(id)) return
    await api(`/api/tabs/${id}`, { method: 'DELETE' }).catch(() => {})
    // A window the tabs were moved to closes with its last tab.
    if (!tabs.value.length && windowLabel !== 'main') await getCurrentWindow().close()
  }

  /**
   * Moves the tab to a new window (desktop app): saved as that window's only tab, which the window restores. Not
   * while it runs, as the result would be lost, or has a transaction open, which only the window's tabs know about.
   */
  const canMove = (tab: QueryTab) => tabs.value.length > 1 && !tab.running && !tab.exporting && !tab.transaction

  async function moveToNewWindow(tab: QueryTab) {
    const open = new Set((await getAllWindows()).map((w) => w.label))
    let n = 2
    while (open.has(`window-${n}`)) n++
    const label = `window-${n}`
    try {
      await saveWorkspace(label, { tabs: [saved(tab)], activeTabId: tab.id })
      await invoke('open_window', { label })
    } catch (e) {
      saveWorkspace(label, { tabs: [] }).catch(() => {})
      failed(t('app.moveFailed'), e)
      return
    }
    removeTab(tab.id)
  }

  /**
   * Moves the tab back to the main window (windows other than `main`), with its transaction; not while it runs, as
   * the result would be lost. The window closes with its last tab.
   */
  const canReturn = (tab: QueryTab) => !tab.running && !tab.exporting

  async function moveToMainWindow(tab: QueryTab) {
    try {
      await emitTo('main', 'tabs-returned', [returned(tab)])
    } catch (e) {
      failed(t('app.moveFailed'), e)
      return
    }
    removeTab(tab.id)
    if (!tabs.value.length) await getCurrentWindow().close()
  }

  /** As a window other than `main` closes: hands its tabs to the main window, so no query is lost. */
  async function returnTabs() {
    clearTimeout(saveTimer)
    if (tabs.value.length) await emitTo('main', 'tabs-returned', tabs.value.map(returned))
    await saveWorkspace(windowLabel, { tabs: [] }).catch(() => {})
  }

  /** Main window: takes tabs moved back from another window (`moveToMainWindow`, `returnTabs`). */
  function takeTabs(taken: ReturnedTab[]) {
    tabs.value.push(...taken.map((tab) => ({ ...tab, running: false, resultIndex: 0 })))
    activeTabId.value = taken.at(-1)?.id ?? activeTabId.value
  }

  function needsConfirm(tab: QueryTab) {
    return !!(tab.sql.trim() || tab.transaction)
  }

  /** Closes the tab, or asks first (`closing`) while it still contains a query or an open transaction. */
  function requestClose(tab?: QueryTab) {
    if (!tab) return
    if (needsConfirm(tab)) closing.value = [tab.id]
    else closeTab(tab.id)
  }

  /** Closes the tabs with the given ids and makes `keep` active; asks once (`closing`) for those with a query or transaction. */
  function requestCloseMany(ids: string[], keep: QueryTab) {
    const affected = tabs.value.filter((t) => ids.includes(t.id))
    if (!affected.length) return
    if (affected.some((t) => t.id === activeTabId.value)) activeTabId.value = keep.id
    closing.value = affected.filter(needsConfirm).map((t) => t.id)
    for (const tab of affected) if (!needsConfirm(tab)) closeTab(tab.id)
  }

  function confirmClose() {
    const ids = closing.value
    closing.value = []
    for (const id of ids) closeTab(id)
  }

  function selectTab(index: number) {
    const tab = tabs.value[index]
    if (tab) activeTabId.value = tab.id
  }

  // Wraps around at both ends.
  function cycleTab(step: number) {
    const index = tabs.value.findIndex((t) => t.id === activeTabId.value)
    const tab = tabs.value[(index + step + tabs.value.length) % tabs.value.length]
    if (tab) activeTabId.value = tab.id
  }

  const failed = (title: string, e: unknown) =>
    toast.add({ title, description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })

  /**
   * Opens a query file in a new tab (or switches to the tab that already has it): `path` (a file opened from the
   * system), otherwise one asked for in a native dialog.
   */
  async function openFile(connectionId?: string, database?: string, path?: string) {
    try {
      path ??= (await fileDialog('open', t('dialog.open'))) ?? undefined
      if (!path) return
      const { sql } = await api<{ sql: string }>('/api/files/read', { method: 'POST', body: { path } })
      const existing = tabs.value.find((t) => t.path === path)
      if (existing) {
        activeTabId.value = existing.id
        return
      }
      const tab = addTab(connectionId, database)
      Object.assign(tab, { title: fileTitle(path), sql, path })
    } catch (e) {
      failed(t('app.openFailed'), e)
    }
  }

  /** Writes the editor content to the tab's file; asks for the file first when the tab has none or `saveAs` is set. */
  async function saveFile(tab?: QueryTab, saveAs = false) {
    if (!tab) return
    try {
      const path = !saveAs && tab.path ? tab.path : await fileDialog('save', t('dialog.save'), `${tab.title}.sql`)
      if (!path) return
      await api('/api/files/write', { method: 'POST', body: { path, sql: tab.sql } })
      tab.path = path
      tab.title = fileTitle(path)
      toast.add({ title: t('common.saved'), description: path, color: 'success', icon: 'i-lucide-check' })
    } catch (e) {
      failed(t('app.saveFailed'), e)
    }
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    closing,
    closingTabs,
    restoreTabs,
    addTab,
    duplicateTab,
    closeTab,
    canMove,
    moveToNewWindow,
    canReturn,
    moveToMainWindow,
    returnTabs,
    takeTabs,
    requestClose,
    requestCloseMany,
    confirmClose,
    selectTab,
    cycleTab,
    openFile,
    saveFile,
  }
}
