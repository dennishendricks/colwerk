<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import type { ColumnInfo, Dialect, RoutineInfo, TableInfo } from '#core'

const props = defineProps<{ connectionId: string, database?: string }>()

const { driverOf } = useWorkspace()
const { state, keyOf, loadSchemas, loadTables, loadColumns, loadIndexes, loadRoutines, loadDdl } = useSchema()
const { tabs, activeTabId, addTab, run } = useTabs()
const toast = useToast()

const schemaTarget = computed(() => ({ connectionId: props.connectionId, database: props.database }))
const s = computed(() => state(schemaTarget.value))
const driver = computed(() => driverOf(props.connectionId))
const expanded = reactive(new Set<string>())

// Without a schema level (MySQL/MariaDB) and a single database, the tables are shown directly.
const flatSchema = computed(() => {
  const schemas = s.value.schemas ?? []
  return !driver.value?.capabilities.supportsSchemas && schemas.length === 1 ? schemas[0]!.name : undefined
})

watch(schemaTarget, (t) => {
  if (!state(t).schemas) loadSchemas(t)
}, { immediate: true })

watch(flatSchema, (schema) => {
  if (schema) loadSchema(schema)
}, { immediate: true })

function toggle(key: string, load: () => void) {
  if (expanded.has(key)) return expanded.delete(key)
  expanded.add(key)
  load()
}

function loadSchema(schema: string) {
  if (!s.value.tables[schema]) loadTables(schemaTarget.value, schema)
  if (!s.value.routines[schema]) loadRoutines(schemaTarget.value, schema)
}

function toggleSchema(schema: string) {
  toggle(keyOf(schema), () => loadSchema(schema))
}

function toggleTable(schema: string, table: string) {
  toggle(keyOf(schema, table), () => {
    if (!s.value.columns[keyOf(schema, table)]) loadColumns(schemaTarget.value, schema, table)
    if (!s.value.indexes[keyOf(schema, table)]) loadIndexes(schemaTarget.value, schema, table)
  })
}

/** Index and routine groups: their content is loaded with the parent. */
function toggleGroup(key: string) {
  toggle(key, () => {})
}

function refreshTable(schema: string, table: string) {
  loadColumns(schemaTarget.value, schema, table, true)
  loadIndexes(schemaTarget.value, schema, table, true)
}

function quoteIdent(dialect: Dialect, name: string) {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  if (dialect === 'mssql') return `[${name.replaceAll(']', ']]')}]`
  return `"${name.replaceAll('"', '""')}"`
}

const q = (name: string) => quoteIdent(driver.value!.dialect, name)

async function columnsOf(schema: string, table: string) {
  const key = keyOf(schema, table)
  if (!s.value.columns[key]) await loadColumns(schemaTarget.value, schema, table)
  return s.value.columns[key]
}

async function format(sql: string) {
  const { formatSql } = await import('~/utils/sql-format')
  return formatSql(sql, driver.value!.dialect)
}

/** Opens `sql` in a new tab of this connection and runs it if `execute` is set. */
function openTab(title: string, sql: string, execute = false) {
  const tab = addTab(props.connectionId, props.database)
  tab.sql = sql
  tab.title = title
  if (execute) run(tab, sql)
}

/**
 * Appends a SELECT of all columns to the active tab (or a new one) and runs it with the tab's row limit.
 * `newTab`: always in a new tab instead.
 */
async function selectTable(schema: string, table: string, newTab = false) {
  const cols = await columnsOf(schema, table)
  if (!cols || !driver.value) return
  const sql = await format(`select ${cols.map(c => q(c.name)).join(', ')} from ${q(schema)}.${q(table)};`)
  if (newTab) return openTab(table, sql, true)
  let tab = tabs.value.find(t => t.id === activeTabId.value)
  if (!tab || tab.connectionId !== props.connectionId || tab.database !== props.database || tab.running || tab.exporting) tab = addTab(props.connectionId, props.database)
  const prev = tab.sql
  tab.sql = !prev.trim() ? sql : `${prev}${prev.trimEnd().endsWith(';') ? '' : ';'}\n\n${sql}`
  run(tab, sql, tab.sql.length - sql.length)
}

async function countRows(schema: string, table: string) {
  openTab(table, await format(`select count(*) from ${q(schema)}.${q(table)};`), true)
}

type Statement = 'select' | 'insert' | 'update' | 'delete'

/** Opens a statement template for the table in a new tab, without running it. */
async function generateSql(schema: string, table: string, statement: Statement) {
  const cols = await columnsOf(schema, table)
  if (!cols || !driver.value) return
  const { dialect } = driver.value
  const name = `${q(schema)}.${q(table)}`
  const list = cols.map(c => q(c.name)).join(', ')
  // The dialect's positional parameters, as placeholders to fill in.
  let n = 0
  const param = () => {
    n++
    return dialect === 'mysql' ? '?' : dialect === 'mssql' ? `@p${n}` : `$${n}`
  }
  const pk = cols.filter(c => c.primaryKey)
  // Without a primary key the row is identified by all columns; a table of only key columns updates them.
  const set = () => (pk.length < cols.length ? cols.filter(c => !c.primaryKey) : cols).map(c => `${q(c.name)} = ${param()}`).join(', ')
  const where = () => (pk.length ? pk : cols).map(c => `${q(c.name)} = ${param()}`).join(' and ')
  const sql = {
    select: () => dialect === 'mssql' ? `select top 100 ${list} from ${name};` : `select ${list} from ${name} limit 100;`,
    insert: () => `insert into ${name} (${list}) values (${cols.map(param).join(', ')});`,
    update: () => `update ${name} set ${set()} where ${where()};`,
    delete: () => `delete from ${name} where ${where()};`,
  }[statement]()
  openTab(table, await format(sql))
}

async function showDdl(schema: string, name: string, object: 'table' | 'view' | 'routine') {
  try {
    openTab(`${name} (DDL)`, await loadDdl(schemaTarget.value, schema, name, object))
  } catch (e) {
    toast.add({ title: 'DDL nicht verfügbar', description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

const copy = (text: string) => navigator.clipboard.writeText(text)

// One context menu for the whole tree; the row right-clicked sets its target.
const menuTarget = shallowRef<{ schema: string, table: TableInfo } | { schema: string, routine: RoutineInfo }>()

const menuItems = computed((): ContextMenuItem[][] => {
  const target = menuTarget.value
  if (!target) return []
  const { schema } = target
  if ('routine' in target) {
    const { name } = target.routine
    return [[
      { label: 'DDL anzeigen', icon: 'i-lucide-file-code', onSelect: () => showDdl(schema, name, 'routine') },
      { label: 'Name kopieren', icon: 'i-lucide-copy', onSelect: () => copy(name) },
    ]]
  }
  const { name, kind } = target.table
  const statements: Statement[] = kind === 'view' ? ['select'] : ['select', 'insert', 'update', 'delete']
  return [
    [
      { label: 'Abfragen', icon: 'i-lucide-play', onSelect: () => selectTable(schema, name) },
      { label: 'In neuem Tab abfragen', icon: 'i-lucide-square-plus', onSelect: () => selectTable(schema, name, true) },
      { label: 'Zeilen zählen', icon: 'i-lucide-hash', onSelect: () => countRows(schema, name) },
    ],
    [
      { label: 'SQL erzeugen', icon: 'i-lucide-code', children: statements.map(st => ({ label: st.toUpperCase(), onSelect: () => generateSql(schema, name, st) })) },
      { label: 'DDL anzeigen', icon: 'i-lucide-file-code', onSelect: () => showDdl(schema, name, kind) },
    ],
    [
      { label: 'Name kopieren', icon: 'i-lucide-copy', onSelect: () => copy(name) },
      { label: 'Qualifizierten Namen kopieren', icon: 'i-lucide-copy', onSelect: () => copy(`${schema}.${name}`) },
    ],
    [{ label: 'Neu laden', icon: 'i-lucide-refresh-cw', onSelect: () => refreshTable(schema, name) }],
  ]
})

// Right-clicks outside a table, view or routine open neither this menu nor the browser's.
function onContextmenu(e: MouseEvent) {
  if (!menuTarget.value) e.preventDefault()
}

function refresh() {
  expanded.clear()
  loadSchemas(schemaTarget.value, true)
}

// ⌘F with focus in the tree opens the search. It only covers what is loaded: the tables of opened
// schemas and the columns of opened tables. Nodes with hits below them show open while searching.
const search = ref<string>()
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement }>('searchInput')
const query = computed(() => search.value?.trim().toLowerCase() ?? '')
const hit = (name: string) => name.toLowerCase().includes(query.value)

const { macOS } = useKbd()
async function onKeydown(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 'f' || !(macOS.value ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey) return
  e.preventDefault()
  search.value ??= ''
  await nextTick()
  searchInput.value?.inputRef?.focus()
  searchInput.value?.inputRef?.select()
}

const columnHits = (schema: string, table: string) => s.value.columns[keyOf(schema, table)]?.filter(c => hit(c.name)) ?? []
const tableHits = (schema: string) => s.value.tables[schema]?.filter(t => hit(t.name) || columnHits(schema, t.name).length) ?? []
const routineHits = (schema: string) => s.value.routines[schema]?.filter(r => hit(r.name)) ?? []

// A hit on a node itself shows all of its children.
const shownColumns = (schema: string, table: string) => query.value && !hit(schema) && !hit(table) ? columnHits(schema, table) : s.value.columns[keyOf(schema, table)]
const shownTables = (schema: string) => query.value && !hit(schema) ? tableHits(schema) : s.value.tables[schema]
const shownRoutines = (schema: string) => query.value && !hit(schema) ? routineHits(schema) : s.value.routines[schema]

const schemaHasHits = (schema: string) => !!tableHits(schema).length || !!routineHits(schema).length
const shownSchemas = computed(() => query.value ? s.value.schemas?.filter(x => hit(x.name) || schemaHasHits(x.name)) : s.value.schemas)
const schemaOpen = (schema: string) => expanded.has(keyOf(schema)) || (!!query.value && schemaHasHits(schema))
const tableOpen = (schema: string, table: string) => expanded.has(keyOf(schema, table)) || (!!query.value && !!columnHits(schema, table).length)
const routinesOpen = (schema: string) => expanded.has(keyOf(schema, undefined, 'routines')) || (!!query.value && !!routineHits(schema).length)

const rowCount = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 })

function tableTitle(t: TableInfo) {
  return [
    t.comment,
    t.rowEstimate !== null && `ca. ${t.rowEstimate.toLocaleString('de-DE')} Zeilen (Statistik)`,
    t.partitioning && `Partitionierung: ${t.partitioning}`,
    t.clustering && `Clustering: ${t.clustering}`,
    'Doppelklick: alle Spalten abfragen',
  ].filter(Boolean).join('\n')
}

function fkTitle(c: ColumnInfo) {
  return c.references ? `${c.references.schema}.${c.references.table}.${c.references.column}` : ''
}
</script>

<template>
  <!-- Focusable so that a click into the tree moves the focus here and ⌘F reaches the handler. -->
  <div class="text-sm outline-none" tabindex="-1" @keydown="onKeydown">
    <div class="flex items-center justify-between px-3 py-1">
      <span class="text-xs font-medium uppercase text-muted">Schema</span>
      <UButton icon="i-lucide-refresh-cw" size="xs" variant="ghost" color="neutral" :loading="s.loading.schemas" title="Neu laden" @click="refresh" />
    </div>
    <UInput
      v-if="search !== undefined"
      ref="searchInput"
      v-model="search"
      placeholder="Geladene Objekte durchsuchen …"
      icon="i-lucide-search"
      size="xs"
      class="w-full px-2 pb-1"
      @keydown.escape="search = undefined"
    >
      <template #trailing>
        <UButton icon="i-lucide-x" color="neutral" variant="link" size="xs" class="-me-1" title="Suche schließen" @click="search = undefined" />
      </template>
    </UInput>
    <p v-if="s.errors.schemas" class="px-3 py-1 text-xs text-error">{{ s.errors.schemas }}</p>

    <UContextMenu :items="menuItems">
      <div @contextmenu.capture="menuTarget = undefined" @contextmenu="onContextmenu">
        <template v-for="schema in shownSchemas" :key="schema.name">
          <button
            v-if="!flatSchema"
            class="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-elevated"
            @click="toggleSchema(schema.name)"
          >
            <UIcon :name="schemaOpen(schema.name) ?'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 shrink-0 text-dimmed" />
            <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-muted" />
            <span class="truncate">{{ schema.name }}</span>
            <UIcon v-if="s.loading[keyOf(schema.name)]" name="i-lucide-loader-circle" class="size-3.5 animate-spin text-dimmed" />
          </button>

          <div v-if="flatSchema || schemaOpen(schema.name)" :class="flatSchema ? '' : 'pl-4'">
            <p v-if="s.errors[keyOf(schema.name)]" class="px-3 py-1 text-xs text-error">{{ s.errors[keyOf(schema.name)] }}</p>
            <template v-for="table in shownTables(schema.name)" :key="table.name">
              <button
                class="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-elevated"
                :title="tableTitle(table)"
                @click="toggleTable(schema.name, table.name)"
                @dblclick="selectTable(schema.name, table.name)"
                @contextmenu="menuTarget = { schema: schema.name, table }"
              >
                <UIcon :name="tableOpen(schema.name, table.name) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 shrink-0 text-dimmed" />
                <UIcon :name="table.kind === 'view' ? 'i-lucide-eye' : 'i-lucide-table-2'" class="size-4 shrink-0 text-muted" />
                <span class="truncate">{{ table.name }}</span>
                <UIcon v-if="s.loading[keyOf(schema.name, table.name)]" name="i-lucide-loader-circle" class="size-3.5 animate-spin text-dimmed" />
                <span class="ml-auto flex shrink-0 items-center gap-1 pl-1">
                  <UBadge v-if="table.partitioning" label="PART" size="sm" color="neutral" variant="subtle" />
                  <span v-if="table.rowEstimate !== null" class="text-xs tabular-nums text-dimmed">{{ rowCount.format(table.rowEstimate) }}</span>
                </span>
              </button>

              <div v-if="tableOpen(schema.name, table.name)" class="pl-9 pr-2">
                <p v-if="s.errors[keyOf(schema.name, table.name)]" class="py-1 text-xs text-error">{{ s.errors[keyOf(schema.name, table.name)] }}</p>
                <p v-if="table.comment" class="py-0.5 text-xs italic text-muted">{{ table.comment }}</p>
                <div
                  v-for="col in shownColumns(schema.name, table.name)"
                  :key="col.name"
                  class="flex items-center gap-1.5 py-0.5 text-xs"
                >
                  <UIcon name="i-lucide-columns-3" class="size-3.5 shrink-0 text-dimmed" />
                  <span class="max-w-[60%] shrink-0 truncate" :class="col.primaryKey ? 'font-semibold' : ''" :title="[col.name, col.comment].filter(Boolean).join('\n')">{{ col.name }}</span>
                  <UIcon v-if="col.comment" name="i-lucide-message-square-text" class="size-3 shrink-0 text-dimmed" :title="col.comment" />
                  <span class="min-w-0 truncate text-dimmed" :title="col.type">{{ col.type }}{{ col.nullable ? '' : ' not null' }}</span>
                  <span class="ml-auto flex shrink-0 gap-1">
                    <UBadge v-if="col.primaryKey" label="PK" size="sm" color="warning" variant="subtle" />
                    <UBadge v-if="col.references" size="sm" color="info" variant="subtle" :title="`Fremdschlüssel → ${fkTitle(col)}`">
                      FK → {{ col.references.table }}
                    </UBadge>
                    <UBadge v-if="col.indexes.length" label="IDX" size="sm" color="neutral" variant="subtle" :title="col.indexes.join(', ')" />
                  </span>
                </div>
                <p v-if="s.errors[keyOf(schema.name, table.name, 'indexes')]" class="py-1 text-xs text-error">{{ s.errors[keyOf(schema.name, table.name, 'indexes')] }}</p>
                <template v-if="s.indexes[keyOf(schema.name, table.name)]?.length">
                  <button class="flex w-full items-center gap-1.5 py-0.5 text-left text-xs text-muted hover:bg-elevated" @click="toggleGroup(keyOf(schema.name, table.name, 'indexes'))">
                    <UIcon :name="expanded.has(keyOf(schema.name, table.name, 'indexes')) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 shrink-0 text-dimmed" />
                    Indizes ({{ s.indexes[keyOf(schema.name, table.name)]!.length }})
                  </button>
                  <div v-if="expanded.has(keyOf(schema.name, table.name, 'indexes'))" class="pl-5">
                    <div
                      v-for="index in s.indexes[keyOf(schema.name, table.name)]"
                      :key="index.name"
                      class="flex items-center gap-1.5 py-0.5 text-xs"
                    >
                      <UIcon name="i-lucide-list-ordered" class="size-3.5 shrink-0 text-dimmed" />
                      <span class="max-w-[60%] shrink-0 truncate" :title="index.name">{{ index.name }}</span>
                      <span class="min-w-0 truncate text-dimmed" :title="index.columns.join(', ')">{{ index.columns.join(', ') }}</span>
                      <span class="ml-auto flex shrink-0 gap-1">
                        <UBadge v-if="index.primary" label="PK" size="sm" color="warning" variant="subtle" />
                        <UBadge v-else-if="index.unique" label="UNIQUE" size="sm" color="neutral" variant="subtle" />
                      </span>
                    </div>
                  </div>
                </template>
              </div>
            </template>

            <p v-if="s.errors[keyOf(schema.name, undefined, 'routines')]" class="px-3 py-1 text-xs text-error">{{ s.errors[keyOf(schema.name, undefined, 'routines')] }}</p>
            <template v-if="shownRoutines(schema.name)?.length">
              <button class="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-elevated" @click="toggleGroup(keyOf(schema.name, undefined, 'routines'))">
                <UIcon :name="routinesOpen(schema.name) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5 shrink-0 text-dimmed" />
                <UIcon name="i-lucide-square-function" class="size-4 shrink-0 text-muted" />
                <span class="truncate">Funktionen ({{ shownRoutines(schema.name)!.length }})</span>
              </button>
              <div v-if="routinesOpen(schema.name)" class="pl-4">
                <div
                  v-for="routine in shownRoutines(schema.name)"
                  :key="`${routine.kind}:${routine.name}`"
                  class="flex items-center gap-1 px-2 py-0.5 hover:bg-elevated"
                  :title="routine.kind === 'procedure' ? 'Prozedur' : 'Funktion'"
                  @contextmenu="menuTarget = { schema: schema.name, routine }"
                >
                  <span class="size-3.5 shrink-0" />
                  <UIcon :name="routine.kind === 'procedure' ? 'i-lucide-cog' : 'i-lucide-square-function'" class="size-4 shrink-0 text-muted" />
                  <span class="truncate">{{ routine.name }}</span>
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>
    </UContextMenu>
  </div>
</template>
