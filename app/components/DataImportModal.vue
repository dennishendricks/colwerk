<script setup lang="ts">
import type { CellValue, ImportSource, ImportSummary, ResultColumn, ImportProgress } from '#core'
import { fileFormat } from '~~/core/file-formats.ts'
import { createTableSql, strategies, targetType, truncateSql, type ImportStrategy } from '~~/core/import-sql.ts'
import { qualifiedName } from '~~/core/sql-literals.ts'

// Wizard: source → target and mapping → load. The server runs the import (core/import.ts) and reports its progress.

const { t } = useI18n()
const { connections, drivers, driverOf, installDriver } = useConnections()
const { state, keyOf, loadSchemas, loadTables, loadColumns, defaultSchema } = useSchema()
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

const connectionName = (id?: string) => connections.value.find((c) => c.id === id)?.name ?? ''
const sourceTarget = computed(() =>
  sourceConnectionId.value ? { connectionId: sourceConnectionId.value, database: sourceDatabase.value } : undefined,
)
const targetConnection = computed(() => connections.value.find((c) => c.id === targetConnectionId.value))
const target = computed(() =>
  targetConnectionId.value ? { connectionId: targetConnectionId.value, database: targetDatabase.value } : undefined,
)
const targetDialect = computed(() => sqlDialect(targetConnection.value?.dialect ?? 'postgres'))
const sourceDialect = computed(() => {
  const dialect = connections.value.find((c) => c.id === sourceConnectionId.value)?.dialect
  return sourceKind.value === 'connection' && dialect ? sqlDialect(dialect) : 'duckdb'
})

const connectionItems = computed(() => connections.value.map((c) => ({ label: c.name, value: c.id })))
const targetItems = computed(() =>
  connections.value
    .filter((c) => !isLakehouse(c.dialect) && !c.readOnly && driverOf(c.id)?.installed)
    .map((c) => ({ label: c.name, value: c.id })),
)
const schemaItems = (tg?: { connectionId: string; database?: string }) =>
  tg ? (state(tg).schemas ?? []).map((s) => ({ label: s.name, value: s.name })) : []
const tableItems = (tg: { connectionId: string; database?: string } | undefined, schema?: string) =>
  tg && schema ? (state(tg).tables[schema] ?? []).map((x) => ({ label: x.name, value: x.name })) : []
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

const sanitized = (name: string) => name.toLowerCase().replace(/[^a-z0-9_]+/g, '_')
const defaultTableName = (s: ImportSource) =>
  s.kind === 'file'
    ? sanitized(
        s.path
          .split(/[\\/]/)
          .pop()!
          .replace(/(?:\.(?:gz|zst))?\.[^.]+$/, '') || 'import',
      )
    : s.kind === 'table'
      ? s.table
      : 'import'

/** Loads what the pickers of `tg` need: its schemas, and once chosen the tables of `schema`. */
async function loadLevels(tg?: { connectionId: string; database?: string }, schema?: string) {
  if (!tg) return
  if (!state(tg).schemas) await loadSchemas(tg)
  if (schema && !state(tg).tables[schema]) await loadTables(tg, schema)
}

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
    targetConnectionId.value = targetItems.value.some((i) => i.value === wanted) ? wanted : targetItems.value[0]?.value
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

/** Exact name, else case-insensitive, else skipped. */
function matchColumns() {
  const names = targetColumns.value.map((c) => c.name)
  mapping.value = (preview.value?.columns ?? []).map(
    (c) => names.find((n) => n === c.name) ?? names.find((n) => n.toLowerCase() === c.name.toLowerCase()) ?? '',
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
const strategyItems = computed(() =>
  (['append', 'truncate', 'upsert'] as const).map((value) => ({
    value,
    label: t(`dataImport.${value}`),
    description: allowed.value.includes(value)
      ? t(`dataImport.${value}Hint`)
      : t(isNew.value ? 'dataImport.newTableAppendOnly' : 'dataImport.upsertUnavailable'),
    disabled: !allowed.value.includes(value),
  })),
)
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

const stepItems = computed(() => [
  { title: t('dataImport.stepSource') },
  { title: t('dataImport.stepTarget') },
  { title: t('dataImport.stepLoad') },
])
const modeItems = computed(() => [
  { label: t('dataImport.existingTable'), value: 'existing' },
  { label: t('dataImport.newTable'), value: 'new' },
])
// Reka's select items cannot have an empty value.
const SKIP = '\0skip'
const columnItems = computed(() => [
  { label: t('dataImport.skip'), value: SKIP },
  ...targetColumns.value.map((c) => ({ label: c.name, value: c.name })),
])
</script>

<template>
  <UModal
    :open="open"
    :title="t('dataImport.title')"
    :ui="{ content: 'max-w-4xl' }"
    :dismissible="!running"
    :close="!running"
    @update:open="(v) => !v && close()"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <UStepper v-model="step" :items="stepItems" disabled class="w-full" />

        <!-- Step 1: source -->
        <template v-if="step === 0">
          <URadioGroup
            v-model="sourceKind"
            orientation="horizontal"
            :items="[
              { label: t('dataImport.fromFile'), value: 'file' },
              { label: t('dataImport.fromConnection'), value: 'connection' },
            ]"
          />
          <template v-if="sourceKind === 'file'">
            <div class="flex gap-2">
              <UInput
                v-model="filePath"
                :placeholder="t('dataImport.file')"
                :aria-label="t('dataImport.file')"
                class="flex-1"
              />
              <UButton
                icon="i-lucide-folder-open"
                color="neutral"
                variant="subtle"
                :label="t('dialog.open')"
                @click="browse"
              />
            </div>
            <p v-if="filePath.trim() && !format" class="text-sm text-error">{{ t('dataImport.unsupportedFile') }}</p>
            <UBadge v-else-if="format" :label="format" color="neutral" variant="subtle" class="self-start" />
            <UAlert
              v-if="duckdb && !duckdb.installed"
              color="info"
              variant="subtle"
              :description="t('dataImport.needsDuckdb')"
            >
              <template #actions>
                <UProgress
                  v-if="installing"
                  :model-value="duckdb.installProgress === undefined ? null : Math.round(duckdb.installProgress * 100)"
                  class="w-40 self-center"
                />
                <UButton
                  icon="i-lucide-download"
                  :label="t('connection.installDriver')"
                  :loading="installing"
                  @click="install"
                />
              </template>
            </UAlert>
          </template>
          <template v-else>
            <USelect
              v-model="sourceConnectionId"
              :items="connectionItems"
              :placeholder="t('common.selectConnection')"
              :aria-label="t('query.connection')"
              icon="i-lucide-database"
              class="w-full"
              @update:model-value="
                ((sourceSchema = undefined), (sourceTable = undefined), (sourceDatabase = undefined))
              "
            />
            <URadioGroup
              v-model="connKind"
              orientation="horizontal"
              :items="[
                { label: t('dataImport.table'), value: 'table' },
                { label: t('dataImport.query'), value: 'query' },
              ]"
            />
            <div v-if="connKind === 'table'" class="grid grid-cols-2 gap-2">
              <USelect
                v-model="sourceSchema"
                :items="schemaItems(sourceTarget)"
                :placeholder="t('dataImport.schema')"
                :aria-label="t('dataImport.schema')"
                @update:model-value="sourceTable = undefined"
              />
              <USelect
                v-model="sourceTable"
                :items="tableItems(sourceTarget, sourceSchema)"
                :placeholder="t('dataImport.table')"
                :aria-label="t('dataImport.table')"
              />
            </div>
            <UFormField v-else :help="t('dataImport.queryHint')">
              <UTextarea
                v-model="sourceQuery"
                :rows="6"
                :aria-label="t('dataImport.query')"
                class="w-full"
                :ui="{ base: 'font-mono text-xs' }"
              />
            </UFormField>
          </template>
        </template>

        <!-- Step 2: target and mapping -->
        <template v-else-if="step === 1 && preview">
          <div>
            <h3 class="mb-1 text-sm font-medium">{{ t('dataImport.preview') }}</h3>
            <div class="h-44 overflow-hidden rounded border border-default">
              <ResultGrid :result="{ columns: preview.columns, rows: preview.rows, truncated: false }" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <UFormField :label="t('dataImport.targetConnection')">
              <USelect
                v-model="targetConnectionId"
                :items="targetItems"
                icon="i-lucide-database"
                class="w-full"
                @update:model-value="
                  ((targetDatabase = undefined),
                  (targetSchema = undefined),
                  (targetTable = undefined),
                  (newSchema = undefined))
                "
              />
            </UFormField>
            <URadioGroup v-model="mode" orientation="horizontal" :items="modeItems" class="self-end" />
          </div>

          <template v-if="!isNew">
            <div class="grid grid-cols-2 gap-2">
              <USelect
                v-model="targetSchema"
                :items="schemaItems(target)"
                :placeholder="t('dataImport.schema')"
                :aria-label="t('dataImport.schema')"
                @update:model-value="targetTable = undefined"
              />
              <USelect
                v-model="targetTable"
                :items="tableItems(target, targetSchema)"
                :placeholder="t('dataImport.table')"
                :aria-label="t('dataImport.table')"
              />
            </div>
            <table v-if="targetTable" class="w-full text-sm">
              <thead class="text-left text-xs text-muted">
                <tr>
                  <th class="py-1">{{ t('dataImport.sourceColumn') }}</th>
                  <th>{{ t('dataImport.targetColumn') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, i) in preview.columns" :key="i">
                  <td class="py-0.5 pr-2">
                    {{ c.name }} <span class="text-xs text-dimmed">{{ c.type }}</span>
                  </td>
                  <td>
                    <USelect
                      :model-value="mapping[i] || SKIP"
                      :items="columnItems"
                      size="sm"
                      class="w-full"
                      :aria-label="c.name"
                      @update:model-value="(v) => (mapping[i] = v === SKIP ? '' : v)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
          <template v-else>
            <div class="grid grid-cols-2 gap-2">
              <UFormField :label="t('dataImport.schema')">
                <USelect v-model="newSchema" :items="schemaItems(target)" class="w-full" />
              </UFormField>
              <UFormField :label="t('dataImport.tableName')">
                <UInput v-model="newName" class="w-full" />
              </UFormField>
            </div>
            <table class="w-full text-sm">
              <thead class="text-left text-xs text-muted">
                <tr>
                  <th class="py-1">{{ t('dataImport.include') }}</th>
                  <th>{{ t('dataImport.targetColumn') }}</th>
                  <th>{{ t('dataImport.type') }}</th>
                  <th>{{ t('dataImport.key') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, i) in newColumns" :key="i">
                  <td class="py-0.5"><UCheckbox v-model="c.include" :aria-label="t('dataImport.include')" /></td>
                  <td class="pr-2"><UInput v-model="c.name" size="sm" :aria-label="t('dataImport.targetColumn')" /></td>
                  <td class="pr-2">
                    <UInput
                      v-model="c.type"
                      size="sm"
                      :aria-label="t('dataImport.type')"
                      @update:model-value="c.edited = true"
                    />
                  </td>
                  <td><UCheckbox v-model="c.key" :aria-label="t('dataImport.key')" /></td>
                </tr>
              </tbody>
            </table>
            <div>
              <h3 class="mb-1 text-sm font-medium">{{ t('dataImport.ddl') }}</h3>
              <pre class="overflow-x-auto rounded bg-elevated p-2 font-mono text-xs">{{ createSql }}</pre>
            </div>
          </template>
          <p v-if="problem" class="text-sm text-error">{{ problem }}</p>
        </template>

        <!-- Step 3: load -->
        <template v-else-if="step === 2">
          <template v-if="!running && !summary">
            <URadioGroup v-model="strategy" :items="strategyItems" />
            <UFormField v-if="strategy === 'upsert'" :label="t('dataImport.keys')">
              <div class="flex flex-wrap gap-x-4 gap-y-1">
                <UCheckbox
                  v-for="c in mapped"
                  :key="c.name"
                  :model-value="keys.includes(c.name)"
                  :label="c.name"
                  @update:model-value="toggleKey(c.name)"
                />
              </div>
              <p v-if="targetDialect === 'mysql'" class="mt-1 text-xs text-muted">
                {{ t('dataImport.upsertMysqlHint') }}
              </p>
            </UFormField>
            <UFormField :label="t('dataImport.onError')">
              <URadioGroup
                v-model="onError"
                :items="[
                  { label: t('dataImport.onErrorStop'), value: 'stop' },
                  { label: t('dataImport.onErrorSkip'), value: 'skip' },
                ]"
              />
            </UFormField>
            <UFormField :label="t('dataImport.batchSize')">
              <UInputNumber
                v-model="batchSize"
                :min="1"
                :max="maxBatch"
                :step="100"
                :step-snapping="false"
                class="w-40"
              />
            </UFormField>
            <p v-if="targetDialect === 'clickhouse'" class="text-sm text-muted">{{ t('dataImport.clickhouseNote') }}</p>
          </template>
          <template v-if="running">
            <UProgress />
            <p v-if="progress" class="text-sm tabular-nums">{{ t('dataImport.progress', { ...progress }) }}</p>
          </template>
          <UAlert
            v-if="summary"
            :color="alertColor"
            variant="subtle"
            :title="t('dataImport.summary', { ...summary, duration: formatDuration(summary.durationMs) })"
          >
            <template v-if="summary.cancelled || summary.error || summary.errors.length" #description>
              <p v-if="summary.cancelled">{{ t('dataImport.cancelled') }}</p>
              <p v-if="summary.error">{{ summary.error }}</p>
              <ul v-if="summary.errors.length" class="list-disc pl-5">
                <li v-for="(e, i) in summary.errors" :key="i">{{ e }}</li>
              </ul>
            </template>
          </UAlert>
        </template>

        <UAlert v-if="error" color="error" variant="subtle" :description="error" />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-between gap-2">
        <UButton
          v-if="step > 0 && !summary"
          :label="t('dataImport.back')"
          color="neutral"
          variant="ghost"
          :disabled="running"
          @click="step--"
        />
        <span v-else />
        <div class="flex gap-2">
          <template v-if="summary">
            <UButton
              :label="t('dataImport.queryTarget')"
              color="neutral"
              variant="subtle"
              :disabled="!!summary.error && !summary.inserted && !summary.updated"
              @click="queryTarget"
            />
            <UButton :label="t('common.close')" @click="close" />
          </template>
          <UButton v-else-if="running" :label="t('common.cancel')" color="neutral" variant="subtle" @click="cancel" />
          <UButton
            v-else-if="step === 0"
            :label="t('dataImport.next')"
            :disabled="!sourceReady"
            :loading="busy"
            @click="toTarget"
          />
          <UButton v-else-if="step === 1" :label="t('dataImport.next')" :disabled="!targetReady" @click="step = 2" />
          <UButton v-else :label="t('dataImport.start')" :disabled="!canStart" @click="start" />
        </div>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="confirming" :title="t('dataImport.confirmTitle')">
    <template #body>
      <p class="text-sm">
        {{ t('dataImport.confirmDescription', { table: qualified, connection: connectionName(targetConnectionId) }) }}
      </p>
      <pre v-if="confirmSql" class="mt-2 overflow-x-auto rounded bg-elevated p-2 font-mono text-xs">{{
        confirmSql
      }}</pre>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="confirming = false" />
        <UButton :label="t('dataImport.start')" @click="load" />
      </div>
    </template>
  </UModal>
</template>
