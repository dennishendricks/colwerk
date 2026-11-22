// State and actions of the data import wizard (DataImportModal and its step components), one instance per modal
import type { CellValue, ImportSource, ImportSummary, ResultColumn, ImportProgress } from '#core'
import { fileFormat } from '~~/core/file-formats.ts'
import { createTableSql, strategies, targetType, truncateSql, type ImportStrategy } from '~~/core/import-sql.ts'
import { qualifiedName } from '~~/core/sql-literals.ts'

// Wizard: source → target and mapping → load. The server runs the import (core/import.ts) and reports its progress.

export type DataImport = ReturnType<typeof useDataImport>

export function useDataImport() {
  const { t } = useI18n()
  const { connections, drivers, driverOf, installDriver, connectionOf, connectionItems } = useConnections()
  const { state, keyOf, loadTables, loadColumns, defaultSchema } = useSchema()
  const { schemaItems, tableItems, loadLevels } = useSchemaLevels()
  const { addTab } = useTabs()
  const { run } = useExecution()

  const open = computed(() => !!importRequest.value)

  const step = ref(0)
  const error = ref<string>()
  const busy = ref(false)

  // Step 1: source
  const sourceKind = ref<'file' | 'connection'>('file')
  const filePath = ref('')
  const connKind = ref<'table' | 'query'>('table')
  const sourceConnectionId = ref<string>()
  const sourceDatabase = ref<string>()
  const sourceSchema = ref<string>()
  const sourceTable = ref<string>()
  const sourceQuery = ref('')

  // Step 2: target and mapping
  const preview = ref<{ columns: ResultColumn[]; rows: CellValue[][] }>()
  const targetConnectionId = ref<string>()
  const targetDatabase = ref<string>()
  const mode = ref<'existing' | 'new'>('existing')
  const targetSchema = ref<string>()
  const targetTable = ref<string>()
  // Existing table: the target column of each source column ('' = skipped).
  const mapping = ref<string[]>([])
  const newSchema = ref<string>()
  const newName = ref('')
  const newColumns = ref<{ include: boolean; name: string; type: string; edited: boolean; key: boolean }[]>([])

  // Step 3: load
  const strategy = ref<ImportStrategy>('append')
  const keys = ref<string[]>([])
  const onError = ref<'stop' | 'skip'>('stop')
  const batchSize = ref(500)
  const confirming = ref(false)
  const importId = ref<string>()
  const progress = ref<ImportProgress>()
  const summary = ref<ImportSummary>()

  const connectionName = (id?: string) => connectionOf(id)?.name ?? ''
  const sourceTarget = computed(() =>
    sourceConnectionId.value ? { connectionId: sourceConnectionId.value, database: sourceDatabase.value } : undefined,
  )
  const targetConnection = computed(() => connectionOf(targetConnectionId.value))
  const target = computed(() =>
    targetConnectionId.value ? { connectionId: targetConnectionId.value, database: targetDatabase.value } : undefined,
  )
  const targetDialect = computed(() => sqlDialect(targetConnection.value?.dialect ?? 'postgres'))
  const sourceDialect = computed(() => {
    const dialect = connectionOf(sourceConnectionId.value)?.dialect
    return sourceKind.value === 'connection' && dialect ? sqlDialect(dialect) : 'duckdb'
  })

  const targetItems = computed(() =>
    connections.value
      .filter((c) => !isLakehouse(c.dialect) && !c.readOnly && driverOf(c.id)?.installed)
      .map((c) => ({ label: c.name, value: c.id })),
  )
  const targetColumns = computed(() =>
    target.value && targetSchema.value && targetTable.value
      ? (state(target.value).columns[keyOf(targetSchema.value, targetTable.value)] ?? [])
      : [],
  )

  // DuckDB reads the files; its driver is downloaded on first use.
  const duckdb = computed(() => drivers.value.find((d) => d.dialect === 'duckdb'))
  const installing = ref(false)
  const format = computed(() => (filePath.value.trim() ? fileFormat(filePath.value.trim()) : undefined))
  async function install() {
    installing.value = true
    error.value = undefined
    try {
      await installDriver('duckdb')
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      installing.value = false
    }
  }

  async function browse() {
    try {
      const path = await fileDialog('open', t('dialog.open'))
      if (path) filePath.value = path
    } catch (e) {
      error.value = errorMessage(e)
    }
  }

  const source = computed((): ImportSource | undefined => {
    if (sourceKind.value === 'file') return format.value ? { kind: 'file', path: filePath.value.trim() } : undefined
    const connectionId = sourceConnectionId.value
    if (!connectionId) return undefined
    const database = sourceDatabase.value
    if (connKind.value === 'query') {
      return sourceQuery.value.trim() ? { kind: 'query', connectionId, database, sql: sourceQuery.value } : undefined
    }
    const [schema, table] = [sourceSchema.value, sourceTable.value]
    return schema && table ? { kind: 'table', connectionId, database, schema, table } : undefined
  })
  const sourceReady = computed(() => !!source.value && (sourceKind.value === 'connection' || !!duckdb.value?.installed))

  watch(
    importRequest,
    (req) => {
      if (!req) return
      step.value = 0
      error.value = undefined
      preview.value = undefined
      summary.value = undefined
      progress.value = undefined
      strategy.value = 'append'
      keys.value = []
      const s = req.source
      sourceKind.value = s?.kind === 'file' || !s ? 'file' : 'connection'
      filePath.value = s?.kind === 'file' ? s.path : ''
      connKind.value = s?.kind === 'query' ? 'query' : 'table'
      sourceConnectionId.value =
        s && s.kind !== 'file' ? s.connectionId : (req.target?.connectionId ?? connections.value[0]?.id)
      sourceDatabase.value = s && s.kind !== 'file' ? s.database : undefined
      sourceSchema.value = s?.kind === 'table' ? s.schema : undefined
      sourceTable.value = s?.kind === 'table' ? s.table : undefined
      sourceQuery.value = s?.kind === 'query' ? s.sql : ''
      const wanted = req.target?.connectionId
      targetConnectionId.value = targetItems.value.some((i) => i.value === wanted)
        ? wanted
        : targetItems.value[0]?.value
      targetDatabase.value = targetConnectionId.value === wanted ? req.target?.database : undefined
      mode.value = req.target?.table ? 'existing' : s ? 'new' : 'existing'
      targetSchema.value = req.target?.schema
      targetTable.value = req.target?.table
    },
    { immediate: true },
  )

  watch([sourceTarget, sourceSchema], ([tg, schema]) => loadLevels(tg, schema), { immediate: true })
  watch(
    [target, targetSchema],
    async ([tg, schema]) => {
      await loadLevels(tg, schema)
      if (tg && !newSchema.value) newSchema.value = defaultSchema(tg)
    },
    { immediate: true },
  )

  watch([target, targetSchema, targetTable], async ([tg, schema, table]) => {
    if (tg && schema && table) await loadColumns(tg, schema, table)
  })

  function matchColumns() {
    mapping.value = matchColumnNames(
      (preview.value?.columns ?? []).map((c) => c.name),
      targetColumns.value.map((c) => c.name),
    )
  }
  watch([targetColumns, preview], matchColumns)

  function retype() {
    const source = preview.value?.columns ?? []
    newColumns.value.forEach((c, i) => {
      if (!c.edited) c.type = targetType(source[i]!.type, sourceDialect.value, targetDialect.value, c.key)
    })
  }
  watch([targetDialect, () => newColumns.value.map((c) => c.key).join()], retype)

  async function toTarget() {
    busy.value = true
    error.value = undefined
    try {
      const { columns, rows } = await api<{ columns: ResultColumn[]; rows: CellValue[][] }>('/api/imports/preview', {
        method: 'POST',
        body: { source: source.value },
      })
      preview.value = { columns, rows }
      newColumns.value = columns.map((c) => ({ include: true, name: c.name, type: '', edited: false, key: false }))
      retype()
      newName.value = defaultTableName(source.value!)
      newSchema.value ??= target.value && defaultSchema(target.value)
      step.value = 1
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      busy.value = false
    }
  }

  const isNew = computed(() => mode.value === 'new')
  const tableName = computed(() => (isNew.value ? newName.value.trim() : (targetTable.value ?? '')))
  const schemaName = computed(() => (isNew.value ? newSchema.value : targetSchema.value))

  const mapped = computed(() =>
    isNew.value
      ? (preview.value?.columns ?? []).flatMap((_, i) => {
          const c = newColumns.value[i]!
          return c.include && c.name.trim() ? [{ source: i, name: c.name.trim(), type: c.type }] : []
        })
      : mapping.value.flatMap((name, i) =>
          name ? [{ source: i, name, type: targetColumns.value.find((c) => c.name === name)?.type ?? '' }] : [],
        ),
  )
  const createSql = computed(() =>
    isNew.value && schemaName.value
      ? createTableSql(
          targetDialect.value,
          schemaName.value,
          tableName.value,
          mapped.value.map((c) => ({ name: c.name, type: c.type, key: newColumns.value[c.source]!.key })),
        )
      : undefined,
  )

  const problem = computed(() => {
    if (!mapped.value.length) return t('dataImport.noColumns')
    const duplicate = mapped.value.find((c, i) => mapped.value.findIndex((o) => o.name === c.name) !== i)
    if (duplicate) return t('dataImport.duplicateColumn', { name: duplicate.name })
    return isNew.value && !tableName.value ? t('dataImport.nameRequired') : undefined
  })
  const targetReady = computed(
    () => !!targetConnectionId.value && !!schemaName.value && !!tableName.value && !problem.value,
  )

  const allowed = computed(() => strategies(targetDialect.value, isNew.value))
  watch(allowed, (list) => {
    if (!list.includes(strategy.value)) strategy.value = 'append'
  })
  // The primary key of the target table is the default for the upsert keys.
  watch([mapped, targetColumns], () => {
    const primary = new Set(targetColumns.value.filter((c) => c.primaryKey).map((c) => c.name))
    keys.value = isNew.value ? [] : mapped.value.filter((c) => primary.has(c.name)).map((c) => c.name)
  })
  const maxBatch = computed(() => (targetDialect.value === 'mssql' ? 1000 : 10000))
  const canStart = computed(() => strategy.value !== 'upsert' || keys.value.length > 0)
  const toggleKey = (name: string) =>
    (keys.value = keys.value.includes(name) ? keys.value.filter((k) => k !== name) : [...keys.value, name])

  const qualified = computed(() => qualifiedName(targetDialect.value, [schemaName.value ?? '', tableName.value]))
  const confirmSql = computed(() =>
    [
      createSql.value,
      strategy.value === 'truncate' && truncateSql(targetDialect.value, [schemaName.value!, tableName.value]),
    ]
      .filter(Boolean)
      .join(';\n'),
  )

  function start() {
    if (targetConnection.value?.confirmWrites || strategy.value === 'truncate') confirming.value = true
    else load()
  }

  async function load() {
    confirming.value = false
    const id = crypto.randomUUID()
    importId.value = id
    progress.value = { read: 0, inserted: 0, updated: 0, failed: 0 }
    error.value = undefined
    const poll = setInterval(async () => {
      try {
        const p = await api<ImportProgress>(`/api/imports/${id}`)
        if (importId.value === id) progress.value = p
      } catch {
        // Not started yet or already finished.
      }
    }, 500)
    try {
      summary.value = await api<ImportSummary>(`/api/imports/${id}/start`, {
        method: 'POST',
        body: {
          source: source.value,
          target: {
            connectionId: targetConnectionId.value,
            database: targetDatabase.value,
            schema: schemaName.value,
            table: tableName.value,
            create: createSql.value,
          },
          columns: mapped.value,
          strategy: strategy.value,
          keys: strategy.value === 'upsert' ? keys.value : [],
          batchSize: Math.min(batchSize.value || 500, maxBatch.value),
          onError: onError.value,
        },
      })
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      clearInterval(poll)
      importId.value = undefined
      if (target.value && schemaName.value) loadTables(target.value, schemaName.value, true)
    }
  }

  const running = computed(() => !!importId.value)
  const cancel = () => api(`/api/imports/${importId.value}/cancel`, { method: 'POST' }).catch(() => {})

  const alertColor = computed(() => {
    const s = summary.value
    return s?.error ? 'error' : s?.failed || s?.cancelled ? 'warning' : 'success'
  })

  function queryTarget() {
    const tab = addTab(targetConnectionId.value, targetDatabase.value)
    const sql = `select * from ${qualified.value};`
    tab.sql = sql
    tab.title = tableName.value
    run(tab, sql)
    close()
  }

  const close = () => (importRequest.value = undefined)

  return {
    open,
    step,
    error,
    busy,
    sourceKind,
    filePath,
    connKind,
    sourceConnectionId,
    sourceDatabase,
    sourceSchema,
    sourceTable,
    sourceQuery,
    preview,
    targetConnectionId,
    targetDatabase,
    mode,
    targetSchema,
    targetTable,
    mapping,
    newSchema,
    newName,
    newColumns,
    strategy,
    keys,
    onError,
    batchSize,
    confirming,
    progress,
    summary,
    connectionName,
    sourceTarget,
    target,
    targetDialect,
    connectionItems,
    targetItems,
    schemaItems,
    tableItems,
    targetColumns,
    duckdb,
    installing,
    format,
    install,
    browse,
    sourceReady,
    toTarget,
    isNew,
    mapped,
    createSql,
    problem,
    targetReady,
    allowed,
    maxBatch,
    canStart,
    toggleKey,
    qualified,
    confirmSql,
    start,
    load,
    running,
    cancel,
    alertColor,
    queryTarget,
    close,
  }
}
