/* eslint-disable @typescript-eslint/no-dynamic-delete -- the reactive records below are keyed maps; deleting entries is intended. */
import type { Ref } from 'vue'
import type { ColumnInfo, ConnectionInput, ConnectionSummary, DatabaseInfo, Dialect, DriverStatus, IndexInfo, IntrospectRequest, QueryResult, RoutineInfo, SchemaInfo, TableInfo, TransactionState } from '#core'

// Client-side state. The app is a single-window SPA, so module-level reactive state is sufficient.

const drivers = ref<DriverStatus[]>([])
const connections = ref<ConnectionSummary[]>([])
const activeConnectionId = ref<string>()
/** Database selected in the sidebar; undefined = the one configured in the connection. */
const activeDatabase = ref<string>()

watch(activeConnectionId, () => (activeDatabase.value = undefined))

export function useWorkspace() {
  async function load() {
    ;[drivers.value, connections.value] = await Promise.all([
      api<DriverStatus[]>('/api/drivers'),
      api<ConnectionSummary[]>('/api/connections'),
    ])
    activeConnectionId.value ??= connections.value[0]?.id
  }

  function driverOf(connectionId?: string): DriverStatus | undefined {
    const dialect = connections.value.find(c => c.id === connectionId)?.dialect
    return drivers.value.find(d => d.dialect === dialect)
  }

  async function saveConnection(input: Partial<ConnectionInput>) {
    const saved = await api<ConnectionSummary>('/api/connections', { method: 'POST', body: input })
    connections.value = await api<ConnectionSummary[]>('/api/connections')
    forgetSchemas(saved.id)
    activeConnectionId.value = saved.id
    return saved
  }

  async function removeConnection(id: string) {
    await api(`/api/connections/${id}`, { method: 'DELETE' })
    connections.value = connections.value.filter(c => c.id !== id)
    forgetSchemas(id)
    if (activeConnectionId.value === id) activeConnectionId.value = connections.value[0]?.id
  }

  /** Disconnecting closes all sessions of the connection on the server; open transactions are rolled back. */
  async function setConnected(id: string, connected: boolean) {
    await api(`/api/connections/${id}/${connected ? 'connect' : 'disconnect'}`, { method: 'POST' })
    const connection = connections.value.find(c => c.id === id)
    if (connection) connection.disconnected = !connected
    if (connected) return
    forgetSchemas(id)
    for (const tab of tabs.value) {
      if (tab.connectionId === id) tab.transaction = undefined
    }
  }

  function testConnection(input: Partial<ConnectionInput>) {
    return api('/api/connections/test', { method: 'POST', body: input })
  }

  /** Downloads the driver's native library; `drivers` shows the progress meanwhile. */
  async function installDriver(dialect: Dialect) {
    let done = false
    const poll = setInterval(async () => {
      const status = await api<DriverStatus[]>('/api/drivers')
      if (!done) drivers.value = status
    }, 300)
    try {
      await api(`/api/drivers/${dialect}/install`, { method: 'POST' })
    } finally {
      done = true
      clearInterval(poll)
      drivers.value = await api<DriverStatus[]>('/api/drivers')
    }
  }

  return { drivers, connections, activeConnectionId, activeDatabase, load, driverOf, saveConnection, removeConnection, setConnected, testConnection, installDriver }
}

// ---------------------------------------------------------------------------------------------
// Schema tree: loaded lazily per level; the server caches, `refresh` bypasses both caches.

/** A connection, switched to `database` when set (otherwise its configured default database). */
export interface SchemaTarget {
  connectionId: string
  database?: string
}

interface SchemaState {
  databases?: DatabaseInfo[]
  schemas?: SchemaInfo[]
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnInfo[]>
  /** Keyed like `columns`. */
  indexes: Record<string, IndexInfo[]>
  routines: Record<string, RoutineInfo[]>
  loading: Record<string, boolean>
  errors: Record<string, string>
}

// Keyed by stateKey().
const schemaState = reactive<Record<string, SchemaState>>({})
const inflight = new Map<string, Promise<void>>()

const stateKey = (target: SchemaTarget) => JSON.stringify([target.connectionId, target.database ?? null])

/** Drops the loaded schemas of every database of a connection. */
function forgetSchemas(connectionId: string) {
  for (const key of Object.keys(schemaState)) {
    if (JSON.parse(key)[0] === connectionId) delete schemaState[key]
  }
}

const DEFAULT_SCHEMAS = ['public', 'dbo', 'main']

export function useSchema() {
  function state(target: SchemaTarget): SchemaState {
    return (schemaState[stateKey(target)] ??= { tables: {}, columns: {}, indexes: {}, routines: {}, loading: {}, errors: {} })
  }

  // A second call while loading waits for the first one instead of loading again.
  function introspect<T>(target: SchemaTarget, key: string, request: IntrospectRequest, refresh: boolean, assign: (s: SchemaState, v: T) => void) {
    const id = JSON.stringify([stateKey(target), key])
    let pending = inflight.get(id)
    if (pending) return pending
    const s = state(target)
    s.loading[key] = true
    delete s.errors[key]
    pending = api<T>(`/api/connections/${target.connectionId}/introspect`, { method: 'POST', body: { request, refresh, database: target.database } })
      .then(v => assign(s, v), (e) => {
        s.errors[key] = errorMessage(e)
      })
      .finally(() => {
        s.loading[key] = false
        inflight.delete(id)
      })
    inflight.set(id, pending)
    return pending
  }

  /** `group` keys the indexes of a table or the routines of a schema (loading state, expansion). */
  const keyOf = (schema: string, table?: string, group?: 'indexes' | 'routines') => JSON.stringify([schema, table ?? null, ...group ? [group] : []])

  /** Databases the login can switch to; listed through the connection's default database. */
  const loadDatabases = (connectionId: string, refresh = false) =>
    introspect<DatabaseInfo[]>({ connectionId }, 'databases', { kind: 'databases' }, refresh, (s, v) => (s.databases = v))

  const loadSchemas = (target: SchemaTarget, refresh = false) =>
    introspect<SchemaInfo[]>(target, 'schemas', { kind: 'schemas' }, refresh, (s, v) => {
      s.schemas = v
      if (refresh) {
        s.tables = {}
        s.columns = {}
        s.indexes = {}
        s.routines = {}
      }
    })

  const loadTables = (target: SchemaTarget, schema: string, refresh = false) =>
    introspect<TableInfo[]>(target, keyOf(schema), { kind: 'tables', schema }, refresh, (s, v) => (s.tables[schema] = v))

  const loadColumns = (target: SchemaTarget, schema: string, table: string, refresh = false) =>
    introspect<ColumnInfo[]>(target, keyOf(schema, table), { kind: 'columns', schema, table }, refresh, (s, v) => (s.columns[keyOf(schema, table)] = v))

  const loadIndexes = (target: SchemaTarget, schema: string, table: string, refresh = false) =>
    introspect<IndexInfo[]>(target, keyOf(schema, table, 'indexes'), { kind: 'indexes', schema, table }, refresh, (s, v) => (s.indexes[keyOf(schema, table)] = v))

  const loadRoutines = (target: SchemaTarget, schema: string, refresh = false) =>
    introspect<RoutineInfo[]>(target, keyOf(schema, undefined, 'routines'), { kind: 'routines', schema }, refresh, (s, v) => (s.routines[schema] = v))

  /** Current definition of a table, view or routine (not cached). */
  const loadDdl = (target: SchemaTarget, schema: string, name: string, object: 'table' | 'view' | 'routine') =>
    api<{ ddl: string }>(`/api/connections/${target.connectionId}/introspect`, { method: 'POST', body: { request: { kind: 'ddl', schema, name, object }, database: target.database } })
      .then(r => r.ddl)

  /** Default schema for unqualified names in autocomplete. */
  function defaultSchema(target: SchemaTarget): string | undefined {
    const names = state(target).schemas?.map(s => s.name) ?? []
    return names.length === 1 ? names[0] : DEFAULT_SCHEMAS.find(n => names.includes(n))
  }

  /** Everything loaded so far, in the shape `@codemirror/lang-sql` expects: schema → table → columns. */
  function completionSchema(target: SchemaTarget): Record<string, Record<string, string[]>> {
    const s = state(target)
    const out: Record<string, Record<string, string[]>> = {}
    for (const [schema, tables] of Object.entries(s.tables)) {
      out[schema] = Object.fromEntries(tables.map(t => [t.name, s.columns[keyOf(schema, t.name)]?.map(c => c.name) ?? []]))
    }
    return out
  }

  return { state, keyOf, loadDatabases, loadSchemas, loadTables, loadColumns, loadIndexes, loadRoutines, loadDdl, defaultSchema, completionSchema }
}

// ---------------------------------------------------------------------------------------------
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
  source?: { connectionId: string, database?: string, sql: string }
  /** Execution plan shown instead of `result` (cleared by the next execute and vice versa). */
  plan?: { text: string, durationMs: number }
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
let tabCounter = 0

// Editor content and settings of the open tabs are saved on the server (results are not).
type SavedTab = Pick<QueryTab, 'id' | 'title' | 'connectionId' | 'database' | 'sql' | 'path' | 'rowLimit' | 'timeout'>
interface SavedWorkspace { tabs: SavedTab[], activeTabId?: string }

let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(() => JSON.stringify({
  tabs: tabs.value.map(({ id, title, connectionId, database, sql, path, rowLimit, timeout }): SavedTab => ({ id, title, connectionId, database, sql, path, rowLimit, timeout })),
  activeTabId: activeTabId.value,
} satisfies SavedWorkspace), (body) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => api('/api/workspace', { method: 'POST', body }), 300)
})

const openTransaction = (state?: TransactionState) => state === 'idle' ? undefined : state

/** File name without directory and `.sql` extension, used as tab title. */
const fileTitle = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.sql$/i, '')

export function useTabs() {
  const { t } = useNuxtApp().$i18n

  async function restoreTabs() {
    const saved = await api<SavedWorkspace>('/api/workspace')
    tabs.value = saved.tabs.map(t => ({ ...t, running: false, resultIndex: 0 }))
    activeTabId.value = tabs.value.some(t => t.id === saved.activeTabId) ? saved.activeTabId : tabs.value[0]?.id
    // Only titles in the current language count; those of another language may repeat a number.
    const untitled = new RegExp(`^${t('tabs.untitled', { n: '(\\d+)' })}$`)
    tabCounter = Math.max(0, ...tabs.value.map(tab => Number(tab.title.match(untitled)?.[1] ?? 0)))
  }

  function addTab(connectionId?: string, database?: string) {
    const tab: QueryTab = { id: crypto.randomUUID(), title: t('tabs.untitled', { n: ++tabCounter }), connectionId, database, sql: '', rowLimit: 200, timeout: 60, running: false, resultIndex: 0 }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    // The reactive proxy, not `tab`: changes made through the raw object would not update the UI.
    return tabs.value.at(-1)!
  }

  async function closeTab(id: string) {
    const index = tabs.value.findIndex(t => t.id === id)
    if (index === -1) return
    tabs.value.splice(index, 1)
    if (activeTabId.value === id) activeTabId.value = tabs.value[Math.max(0, index - 1)]?.id
    await api(`/api/tabs/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  /** `from`: document offset where `sql` starts in the editor, to place the error position. */
  async function run(tab: QueryTab, sql: string, from = 0) {
    if (!tab.connectionId || !sql.trim() || tab.running || tab.exporting) return
    tab.running = true
    tab.error = undefined
    tab.errorAt = undefined
    tab.plan = undefined
    try {
      // Raw: deep reactivity on up to 100k rows would wrap every row and cell in a proxy.
      tab.result = markRaw(await api<QueryResult>(`/api/tabs/${tab.id}/execute`, {
        method: 'POST',
        body: { connectionId: tab.connectionId, database: tab.database, sql, rowLimit: tab.rowLimit, timeout: tab.timeout },
      }))
      // The last result set is usually the one a script is run for.
      tab.resultIndex = Math.max(0, tab.result.resultSets.length - 1)
      tab.source = { connectionId: tab.connectionId, database: tab.database, sql }
      tab.transaction = openTransaction(tab.result.transaction)
    } catch (e) {
      tab.result = undefined
      tab.error = errorMessage(e)
      const position = (e as { data?: { data?: { position?: number } } }).data?.data?.position
      if (position !== undefined) tab.errorAt = from + position
      // A failed statement can leave the transaction open; the server sends the state along with the error.
      tab.transaction = openTransaction((e as { data?: { data?: { transaction?: TransactionState } } }).data?.data?.transaction)
    } finally {
      tab.running = false
    }
  }

  /** `analyze` executes the statement; the server only accepts it for read-only statements. */
  async function explain(tab: QueryTab, sql: string, analyze = false) {
    if (!tab.connectionId || !sql.trim() || tab.running || tab.exporting) return
    tab.running = true
    tab.error = undefined
    tab.errorAt = undefined
    tab.result = undefined
    tab.source = undefined
    tab.plan = undefined
    try {
      const { plan, durationMs } = await api<{ plan: string, durationMs: number }>(`/api/tabs/${tab.id}/explain`, {
        method: 'POST',
        body: { connectionId: tab.connectionId, database: tab.database, sql, analyze, timeout: tab.timeout },
      })
      tab.plan = { text: plan, durationMs }
    } catch (e) {
      tab.error = errorMessage(e)
    } finally {
      tab.running = false
    }
  }

  async function cancel(tab: QueryTab) {
    if (tab.exporting) tab.exporting = 'cancelled'
    await api(`/api/tabs/${tab.id}/cancel`, { method: 'POST' }).catch((e) => {
      tab.error = errorMessage(e)
    })
  }

  /**
   * Asks for the target file in a native dialog, then the server writes it.
   * `full`: runs the statement again without row limit; otherwise exports the rows of the result set shown.
   * Resolves with the path once the file is written completely, with `undefined` if the user cancelled.
   */
  async function exportResult(tab: QueryTab, format: 'csv' | 'parquet', full: boolean): Promise<string | undefined> {
    const shown = tab.result?.resultSets[tab.resultIndex]
    tab.exporting = 'running'
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
      const { path } = await api<{ path: string | null }>('/api/dialog', { method: 'POST', body: { kind: 'save', defaultName: `export-${stamp}.${format}`, title: t('dialog.save') } })
      // Widened: `cancel()` changes it while this call is waiting.
      if (!path || (tab.exporting as QueryTab['exporting']) === 'cancelled') return undefined
      const body = full ? { format, path, ...tab.source } : { format, path, columns: shown?.columns, rows: shown?.rows }
      await api(`/api/tabs/${tab.id}/export`, { method: 'POST', body })
      return path
    } catch (e) {
      if ((tab.exporting as QueryTab['exporting']) === 'cancelled') return undefined
      throw e
    } finally {
      tab.exporting = undefined
    }
  }

  /**
   * Asks for a query file in a native dialog and opens it in a new tab (or switches to the tab that already has it).
   * Resolves with the tab, `undefined` if the user cancelled.
   */
  async function openFile(connectionId?: string, database?: string): Promise<QueryTab | undefined> {
    const { path } = await api<{ path: string | null }>('/api/dialog', { method: 'POST', body: { kind: 'open', title: t('dialog.open') } })
    if (!path) return undefined
    const { sql } = await api<{ sql: string }>('/api/files/read', { method: 'POST', body: { path } })
    const existing = tabs.value.find(t => t.path === path)
    if (existing) {
      activeTabId.value = existing.id
      return existing
    }
    const tab = addTab(connectionId, database)
    Object.assign(tab, { title: fileTitle(path), sql, path })
    return tab
  }

  /**
   * Writes the editor content to the tab's file; asks for the file first when the tab has none or `saveAs` is set.
   * Resolves with the path, `undefined` if the user cancelled.
   */
  async function saveFile(tab: QueryTab, saveAs = false): Promise<string | undefined> {
    const path = !saveAs && tab.path
      ? tab.path
      : (await api<{ path: string | null }>('/api/dialog', { method: 'POST', body: { kind: 'save', defaultName: `${tab.title}.sql`, title: t('dialog.save') } })).path
    if (!path) return undefined
    await api('/api/files/write', { method: 'POST', body: { path, sql: tab.sql } })
    tab.path = path
    tab.title = fileTitle(path)
    return path
  }

  return { tabs, activeTabId, restoreTabs, addTab, closeTab, run, explain, cancel, exportResult, openFile, saveFile }
}
