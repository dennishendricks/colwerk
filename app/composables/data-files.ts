import { fileFormat, isRemote } from '~~/core/file-formats.ts'
import { forgetSchemas } from './schema'

// Data files (CSV, TSV, Parquet, JSON, Excel) and URLs: each becomes a view of a files connection (DuckDB), queried
// in a new tab. Module-level state like `variablePrompt`; the modals are in FileQueryModals.vue.

/** Open prompt to download the DuckDB driver: resolves with whether it is installed now. */
export const duckdbPrompt = ref<{ done: (ok: boolean) => void }>()
export const urlPromptOpen = ref(false)
/** Files are dragged over the window. */
export const dropActive = ref(false)

/** File name of a path or URL. */
const basename = (source: string) => (isRemote(source) ? new URL(source).pathname : source).split(/[\\/]/).pop()!

interface QueryResponse {
  connectionId: string
  added: { source: string; name: string }[]
  failed: { source: string; message: string; key?: string; params?: Record<string, unknown> }[]
}

export function useDataFiles() {
  const { drivers, activeConnectionId, activeDatabase, load, openDatabaseFile, connectionOf } = useConnections()
  const { activeTab, addTab, openFile } = useTabs()
  const { run } = useExecution()
  const { t, te } = useI18n()
  const toast = useToast()

  const error = (title: string, description: string) =>
    toast.add({ title, description, color: 'error', icon: 'i-lucide-circle-alert' })

  /** Whether the DuckDB driver is installed; if not, offers the download first. */
  function ensureDuckdb(): Promise<boolean> {
    if (drivers.value.find((d) => d.dialect === 'files')?.installed) return Promise.resolve(true)
    return new Promise((done) => (duckdbPrompt.value = { done }))
  }

  /** Adds the sources to the active tab's files connection (else the first, else a new one) and queries each. */
  async function queryFiles(sources: string[]) {
    if (!sources.length || !(await ensureDuckdb())) return
    const tabConnection = connectionOf(activeTab.value?.connectionId)
    try {
      const { connectionId, added, failed } = await api<QueryResponse>('/api/files/query', {
        method: 'POST',
        body: {
          sources,
          connectionId: tabConnection?.dialect === 'files' ? tabConnection.id : undefined,
          name: t('files.scratchName'),
        },
      })
      await load()
      forgetSchemas(connectionId)
      activeConnectionId.value = connectionId
      for (const { source, name } of added) {
        const tab = addTab(connectionId)
        tab.title = basename(source)
        tab.sql = `select * from "${name.replaceAll('"', '""')}";`
        run(tab, tab.sql)
      }
      for (const { source, message, key, params } of failed) {
        error(
          t('files.failed', { source: basename(source) }),
          key && te(`errors.${key}`) ? t(`errors.${key}`, params ?? {}) : message,
        )
      }
    } catch (e) {
      error(t('app.openFailed'), errorMessage(e))
    }
  }

  /** Files from the system, dropped onto the window or picked in a dialog: queries, databases and data files. */
  async function openPaths(paths: string[]) {
    const data: string[] = []
    const unsupported: string[] = []
    for (const path of paths) {
      if (/\.(sql|sqlplan)$/i.test(path)) await openFile(activeConnectionId.value, activeDatabase.value, path)
      else if (/\.(duckdb|sqlite3?)$/i.test(path)) {
        try {
          await openDatabaseFile(path, /\.duckdb$/i.test(path) ? 'duckdb' : 'sqlite')
        } catch (e) {
          error(t('app.openFailed'), errorMessage(e))
        }
      } else if (fileFormat(path)) data.push(path)
      else unsupported.push(basename(path))
    }
    if (unsupported.length) {
      error(t('files.unsupportedTitle'), t('files.unsupported', { names: unsupported.join(', ') }))
    }
    await queryFiles(data)
  }

  async function pickAndQuery() {
    try {
      const path = await fileDialog('open', t('dialog.open'))
      if (path) await openPaths([path])
    } catch (e) {
      error(t('app.openFailed'), errorMessage(e))
    }
  }

  const queryUrl = (url: string) => queryFiles([url.trim()])

  return { ensureDuckdb, queryFiles, openPaths, pickAndQuery, queryUrl }
}
