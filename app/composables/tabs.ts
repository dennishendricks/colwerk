import type { Ref } from 'vue'
import type { QueryResult } from '#core'

// Editor tabs: each tab owns a dedicated server-side session (keyed by tab id).

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
  running: boolean
  result?: QueryResult
  /** Index of the result set shown (scripts can return several). */
  resultIndex: number
  /** Connection and statement that produced `result` (for exporting the full result). */
  source?: { connectionId: string; database?: string; sql: string }
  /** Execution plan shown instead of `result` (cleared by the next execute and vice versa). */
  plan?: { text: string; durationMs: number }
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
// Tab that waits for confirmation because it still contains a query or an open transaction.
const closing = ref<string>()
const closingTab = computed(() => tabs.value.find((t) => t.id === closing.value))
let tabCounter = 0

// Editor content and settings of the open tabs are saved on the server (results are not).
type SavedTab = Pick<QueryTab, 'id' | 'title' | 'connectionId' | 'database' | 'sql' | 'path' | 'rowLimit' | 'timeout'>
interface SavedWorkspace {
  tabs: SavedTab[]
  activeTabId?: string
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () =>
    JSON.stringify({
      tabs: tabs.value.map(({ id, title, connectionId, database, sql, path, rowLimit, timeout }): SavedTab => ({
        id,
        title,
        connectionId,
        database,
        sql,
        path,
        rowLimit,
        timeout,
      })),
      activeTabId: activeTabId.value,
    } satisfies SavedWorkspace),
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
    const saved = await api<SavedWorkspace>('/api/workspace')
    tabs.value = saved.tabs.map((t) => ({ ...t, running: false, resultIndex: 0 }))
    activeTabId.value = tabs.value.some((t) => t.id === saved.activeTabId) ? saved.activeTabId : tabs.value[0]?.id
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
    })
  }

  async function closeTab(id: string) {
    const index = tabs.value.findIndex((t) => t.id === id)
    if (index === -1) return
    tabs.value.splice(index, 1)
    if (activeTabId.value === id) activeTabId.value = tabs.value[Math.max(0, index - 1)]?.id
    await api(`/api/tabs/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  /** Closes the tab, or asks first (`closing`) while it still contains a query or an open transaction. */
  function requestClose(tab?: QueryTab) {
    if (!tab) return
    if (tab.sql.trim() || tab.transaction) closing.value = tab.id
    else closeTab(tab.id)
  }

  function confirmClose() {
    if (closing.value) closeTab(closing.value)
    closing.value = undefined
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

  /** Asks for a query file in a native dialog and opens it in a new tab (or switches to the tab that already has it). */
  async function openFile(connectionId?: string, database?: string) {
    try {
      const path = await fileDialog('open', t('dialog.open'))
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
    closingTab,
    restoreTabs,
    addTab,
    duplicateTab,
    closeTab,
    requestClose,
    confirmClose,
    selectTab,
    cycleTab,
    openFile,
    saveFile,
  }
}
