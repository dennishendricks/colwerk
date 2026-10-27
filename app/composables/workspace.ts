/* eslint-disable @typescript-eslint/no-dynamic-delete -- the reactive records below are keyed maps; deleting entries is intended. */
import type { Ref } from 'vue'
import type { ColumnInfo, ConnectionInput, ConnectionSummary, Dialect, DriverStatus, IntrospectRequest, QueryResult, SchemaInfo, TableInfo } from '#core'

// Client-side state. The app is a single-window SPA, so module-level reactive state is sufficient.

const drivers = ref<DriverStatus[]>([])
const connections = ref<ConnectionSummary[]>([])
const activeConnectionId = ref<string>()

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
    delete schemaState[saved.id]
    activeConnectionId.value = saved.id
    return saved
  }

  async function removeConnection(id: string) {
    await api(`/api/connections/${id}`, { method: 'DELETE' })
    connections.value = connections.value.filter(c => c.id !== id)
    delete schemaState[id]
    if (activeConnectionId.value === id) activeConnectionId.value = connections.value[0]?.id
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

  return { drivers, connections, activeConnectionId, load, driverOf, saveConnection, removeConnection, testConnection, installDriver }
}

// ---------------------------------------------------------------------------------------------
// Schema tree: loaded lazily per level; the server caches, `refresh` bypasses both caches.

interface SchemaState {
  schemas?: SchemaInfo[]
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnInfo[]>
  loading: Record<string, boolean>
  errors: Record<string, string>
}

const schemaState = reactive<Record<string, SchemaState>>({})
const inflight = new Map<string, Promise<void>>()

const DEFAULT_SCHEMAS = ['public', 'dbo', 'main']

export function useSchema() {
  function state(connectionId: string): SchemaState {
    return (schemaState[connectionId] ??= { tables: {}, columns: {}, loading: {}, errors: {} })
  }

  // A second call while loading waits for the first one instead of loading again.
  function introspect<T>(connectionId: string, key: string, request: IntrospectRequest, refresh: boolean, assign: (s: SchemaState, v: T) => void) {
    const id = JSON.stringify([connectionId, key])
    let pending = inflight.get(id)
    if (pending) return pending
    const s = state(connectionId)
    s.loading[key] = true
    delete s.errors[key]
    pending = api<T>(`/api/connections/${connectionId}/introspect`, { method: 'POST', body: { request, refresh } })
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

  const keyOf = (schema: string, table?: string) => JSON.stringify([schema, table ?? null])

  const loadSchemas = (connectionId: string, refresh = false) =>
    introspect<SchemaInfo[]>(connectionId, 'schemas', { kind: 'schemas' }, refresh, (s, v) => {
      s.schemas = v
      if (refresh) {
        s.tables = {}
        s.columns = {}
      }
    })

  const loadTables = (connectionId: string, schema: string, refresh = false) =>
    introspect<TableInfo[]>(connectionId, keyOf(schema), { kind: 'tables', schema }, refresh, (s, v) => (s.tables[schema] = v))

  const loadColumns = (connectionId: string, schema: string, table: string, refresh = false) =>
    introspect<ColumnInfo[]>(connectionId, keyOf(schema, table), { kind: 'columns', schema, table }, refresh, (s, v) => (s.columns[keyOf(schema, table)] = v))

  /** Default schema for unqualified names in autocomplete. */
  function defaultSchema(connectionId: string): string | undefined {
    const names = state(connectionId).schemas?.map(s => s.name) ?? []
    return names.length === 1 ? names[0] : DEFAULT_SCHEMAS.find(n => names.includes(n))
  }

  /** Everything loaded so far, in the shape `@codemirror/lang-sql` expects: schema → table → columns. */
  function completionSchema(connectionId: string): Record<string, Record<string, string[]>> {
    const s = state(connectionId)
    const out: Record<string, Record<string, string[]>> = {}
    for (const [schema, tables] of Object.entries(s.tables)) {
      out[schema] = Object.fromEntries(tables.map(t => [t.name, s.columns[keyOf(schema, t.name)]?.map(c => c.name) ?? []]))
    }
    return out
  }

  return { state, keyOf, loadSchemas, loadTables, loadColumns, defaultSchema, completionSchema }
}

// ---------------------------------------------------------------------------------------------
// Editor tabs: each tab owns a dedicated server-side session (keyed by tab id).

export interface QueryTab {
  id: string
  title: string
  connectionId?: string
  sql: string
  rowLimit: number
  /** Seconds after which the server cancels the statement. */
  timeout: number
  running: boolean
  result?: QueryResult
  /** Index of the result set shown (scripts can return several). */
  resultIndex: number
  /** Connection and statement that produced `result` (for exporting the full result). */
  source?: { connectionId: string, sql: string }
  /** Set while a download is being written; `cancelled` after the user aborted it. */
  exporting?: 'running' | 'cancelled'
  error?: string
}

// Explicit type: unwrapping the recursive CellValue type would be "excessively deep".
const tabs: Ref<QueryTab[]> = ref([])
const activeTabId = ref<string>()
let tabCounter = 0

export function useTabs() {
  function addTab(connectionId?: string) {
    const tab: QueryTab = { id: crypto.randomUUID(), title: `Abfrage ${++tabCounter}`, connectionId, sql: '', rowLimit: 200, timeout: 60, running: false, resultIndex: 0 }
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

  async function run(tab: QueryTab, sql: string) {
    if (!tab.connectionId || !sql.trim() || tab.running || tab.exporting) return
    tab.running = true
    tab.error = undefined
    try {
      tab.result = await api<QueryResult>(`/api/tabs/${tab.id}/execute`, {
        method: 'POST',
        body: { connectionId: tab.connectionId, sql, rowLimit: tab.rowLimit, timeout: tab.timeout },
      })
      // The last result set is usually the one a script is run for.
      tab.resultIndex = Math.max(0, tab.result.resultSets.length - 1)
      tab.source = { connectionId: tab.connectionId, sql }
    } catch (e) {
      tab.result = undefined
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
      const { path } = await api<{ path: string | null }>('/api/dialog', { method: 'POST', body: { kind: 'save', defaultName: `export-${stamp}.${format}` } })
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

  return { tabs, activeTabId, addTab, closeTab, run, cancel, exportResult }
}
