<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { ConnectionSummary } from '#core'
import type { QueryTab } from '~/composables/workspace'
import type { ApplicationMenuItem } from '~/utils/application-menu'

const { connections, activeConnectionId, activeDatabase, load, driverOf, setConnected } = useWorkspace()
const { tabs, activeTabId, restoreTabs, addTab, closeTab, openFile, saveFile } = useTabs()

const loadError = ref<string>()
const modalOpen = ref(false)
const editing = ref<ConnectionSummary>()

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value))
const activeConnection = computed(() => connections.value.find(c => c.id === activeConnectionId.value))
const locksDatabase = computed(() => !!driverOf(activeConnectionId.value)?.capabilities.locksDatabase)
const togglingConnection = ref(false)
// Disconnecting waits for confirmation while a tab of the connection has an open transaction.
const confirmingDisconnect = ref(false)

// Embedded databases are locked while Colwerk has them open; disconnecting frees them for other tools.
async function toggleConnection(confirmed = false) {
  const connection = activeConnection.value
  if (!connection) return
  if (!connection.disconnected && !confirmed && tabs.value.some(t => t.connectionId === connection.id && t.transaction)) {
    confirmingDisconnect.value = true
    return
  }
  confirmingDisconnect.value = false
  togglingConnection.value = true
  try {
    await setConnected(connection.id, !!connection.disconnected)
  } finally {
    togglingConnection.value = false
  }
}
const colorOf = (connectionId?: string) => connections.value.find(c => c.id === connectionId)?.color

let listening = false

async function init() {
  loadError.value = undefined
  try {
    await load()
    if (!tabs.value.length) await restoreTabs()
    if (!tabs.value.length) addTab(activeConnectionId.value)
    if (!listening) {
      listening = true
      subscribe('/api/events', onServerEvent)
    }
  } catch (e) {
    loadError.value = errorMessage(e)
  }
}

watch(sessionToken, init, { immediate: true })
checkForUpdate()

const { version } = useRuntimeConfig().public

// Queries prepared by an MCP client (tool open-query) open in a new tab, without running.
function onServerEvent(type: string, data: string) {
  if (type !== 'open-query') return
  const { connectionId, sql, title } = JSON.parse(data) as { connectionId: string, sql: string, title?: string }
  openInNewTab(connectionId, sql, title)
}

function openInNewTab(connectionId: string, sql: string, title?: string) {
  activeConnectionId.value = connectionId
  const tab = addTab(connectionId)
  tab.sql = sql
  if (title) tab.title = title
}

// A tab without connection picks up the connection selected (or created) in the sidebar.
watch(activeConnectionId, (id) => {
  if (activeTab.value && !activeTab.value.connectionId) activeTab.value.connectionId = id
})

function openModal(connection?: ConnectionSummary) {
  editing.value = connection
  modalOpen.value = true
}

// Collapsed state is persisted with the panel sizes (auto-save-id).
const sidebar = useTemplateRef<InstanceType<typeof SplitterPanel>>('sidebar')
const toggleSidebar = () => sidebar.value?.isCollapsed ? sidebar.value.expand() : sidebar.value?.collapse()

// Toggles between the system setting and its opposite; the opposite is stored as a fixed mode (localStorage),
// so it no longer differs from the system once the system setting changes.
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

const shortcutsOpen = ref(false)
const mcpOpen = ref(false)
const historyOpen = ref(false)
// Tab that waits for confirmation because it still contains a query or an open transaction.
const closing = ref<string>()
const closingTab = computed(() => tabs.value.find(t => t.id === closing.value))

function requestClose(tab?: QueryTab) {
  if (!tab) return
  if (tab.sql.trim() || tab.transaction) closing.value = tab.id
  else closeTab(tab.id)
}

function confirmClose() {
  if (closing.value) closeTab(closing.value)
  closing.value = undefined
}

// Inline rename on double-click; the input takes the width of the label it replaces.
const renaming = ref<string>()
const draft = ref('')
const renameWidth = ref(0)
const renameInput = useTemplateRef<HTMLInputElement[]>('rename-input')

async function startRename(tab: QueryTab, e: MouseEvent) {
  renaming.value = tab.id
  draft.value = tab.title
  renameWidth.value = (e.currentTarget as HTMLElement).offsetWidth
  await nextTick()
  renameInput.value?.[0]?.focus()
  renameInput.value?.[0]?.select()
}

function commitRename(tab: QueryTab) {
  // Removing the input after Enter or Escape can fire blur as well.
  if (renaming.value !== tab.id) return
  const title = draft.value.trim()
  if (title) tab.title = title
  renaming.value = undefined
}

function duplicateTab(tab?: QueryTab) {
  if (!tab) return
  const copy = addTab(tab.connectionId, tab.database)
  Object.assign(copy, { title: `${tab.title} (Kopie)`, sql: tab.sql, rowLimit: tab.rowLimit, timeout: tab.timeout })
}

const toast = useToast()

async function openQueryFile() {
  try {
    await openFile(activeConnectionId.value, activeDatabase.value)
  } catch (e) {
    toast.add({ title: 'Öffnen fehlgeschlagen', description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function save(tab?: QueryTab, saveAs = false) {
  if (!tab) return
  try {
    const path = await saveFile(tab, saveAs)
    if (path) toast.add({ title: 'Gespeichert', description: path, color: 'success', icon: 'i-lucide-check' })
  } catch (e) {
    toast.add({ title: 'Speichern fehlgeschlagen', description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function selectTab(index: number) {
  const tab = tabs.value[index]
  if (tab) activeTabId.value = tab.id
}

// Wraps around at both ends.
function cycleTab(step: number) {
  const index = tabs.value.findIndex(t => t.id === activeTabId.value)
  const tab = tabs.value[(index + step + tabs.value.length) % tabs.value.length]
  if (tab) activeTabId.value = tab.id
}

// `?` has no usingInput, so it stays inactive while typing in the rename input.
defineShortcuts({
  meta_t: { usingInput: true, handler: () => addTab(activeConnectionId.value, activeDatabase.value) },
  meta_w: { usingInput: true, handler: () => requestClose(activeTab.value) },
  meta_shift_d: { usingInput: true, handler: () => duplicateTab(activeTab.value) },
  meta_o: { usingInput: true, handler: openQueryFile },
  meta_s: { usingInput: true, handler: () => save(activeTab.value) },
  meta_shift_s: { usingInput: true, handler: () => save(activeTab.value, true) },
  meta_b: { usingInput: true, handler: toggleSidebar },
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`meta_${i + 1}`, { usingInput: true, handler: () => selectTab(i) }])),
  '?': () => (shortcutsOpen.value = !shortcutsOpen.value),
})

// ⇧⌘[ / ⇧⌘] by physical key, like macOS menus: with shift (and on other layouts) the characters differ,
// which defineShortcuts matches on.
const { macOS } = useKbd()
function onKeydown(e: KeyboardEvent) {
  const step = e.code === 'BracketLeft' ? -1 : e.code === 'BracketRight' ? 1 : 0
  if (!step || !e.shiftKey || !(macOS.value ? e.metaKey : e.ctrlKey)) return
  e.preventDefault()
  cycleTab(step)
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// Native application menu (desktop app). The page sees each key first: a shortcut it handles calls
// preventDefault, which keeps the menu item with the same accelerator from firing as well. Deno 2.9.8 only
// supports single-character accelerators, so ⌘↵ and ⇧⌘[ / ⇧⌘] are not shown in the menu.
watchEffect(() => {
  if (!hasApplicationMenu) return
  const tab = activeTab.value
  const busy = !!tab && (tab.running || !!tab.exporting)
  const shown = tab?.result?.resultSets[tab.resultIndex]
  const item = (label: string, id: string, enabled = true, accelerator?: string): ApplicationMenuItem => ({ item: { label, id, enabled, accelerator } })
  const submenu = (label: string, items: ApplicationMenuItem[]): ApplicationMenuItem => ({ submenu: { label, items } })
  const role = (role: string): ApplicationMenuItem => ({ role: { role } })
  setApplicationMenu([
    // macOS replaces the label of the first menu with the app name.
    submenu('Colwerk', [item('MCP einrichten …', 'mcp'), item('Nach Updates suchen …', 'update'), 'separator', role('quit')]),
    submenu('Ablage', [
      item('Neuer Tab', 'new-tab', true, 'CmdOrCtrl+T'),
      item('Tab duplizieren', 'duplicate-tab', !!tab, 'CmdOrCtrl+Shift+D'),
      'separator',
      item('Öffnen …', 'open', true, 'CmdOrCtrl+O'),
      item('Speichern', 'save', !!tab, 'CmdOrCtrl+S'),
      item('Speichern unter …', 'save-as', !!tab, 'CmdOrCtrl+Shift+S'),
      'separator',
      item('Neue Verbindung …', 'new-connection'),
      item(
        activeConnection.value?.disconnected ? 'Verbindung herstellen' : 'Verbindung trennen',
        'toggle-connection',
        !!activeConnection.value && locksDatabase.value && !togglingConnection.value,
      ),
      'separator',
      item('Ergebnis speichern unter …', 'export', !!tab && !tab.error && !!shown?.columns.length && !busy),
      'separator',
      item('Tab schließen', 'close-tab', !!tab, 'CmdOrCtrl+W'),
    ]),
    submenu('Bearbeiten', [
      role('undo'),
      role('redo'),
      'separator',
      role('cut'),
      role('copy'),
      role('paste'),
      role('selectAll'),
      'separator',
      item('SQL formatieren', 'format', !!tab?.sql.trim(), 'CmdOrCtrl+Shift+F'),
    ]),
    submenu('Abfrage', [
      item('Ausführen', 'run', !!tab?.connectionId && !tab.exporting),
      item('Ausführungsplan', 'explain', !!tab?.connectionId && !busy, 'CmdOrCtrl+E'),
      item('Abbrechen', 'cancel', busy && tab?.exporting !== 'cancelled' && !!driverOf(tab?.connectionId)?.capabilities.supportsCancel),
      'separator',
      // A failed transaction can only be rolled back.
      item('Commit', 'commit', tab?.transaction === 'open' && !busy),
      item('Rollback', 'rollback', !!tab?.transaction && !busy),
      'separator',
      item('Verlauf …', 'history'),
    ]),
    submenu('Darstellung', [
      item('Seitenleiste ein-/ausblenden', 'sidebar', true, 'CmdOrCtrl+B'),
      'separator',
      // No checkmarks in Deno's menus: the active design is disabled instead.
      item('Design wie System', 'design-system', colorMode.preference !== 'system'),
      item('Helles Design', 'design-light', colorMode.preference !== 'light'),
      item('Dunkles Design', 'design-dark', colorMode.preference !== 'dark'),
    ]),
    submenu('Fenster', [
      role('minimize'),
      'separator',
      item('Vorheriger Tab', 'previous-tab', tabs.value.length > 1),
      item('Nächster Tab', 'next-tab', tabs.value.length > 1),
      'separator',
      ...tabs.value.slice(0, 9).map((t, i) => item(t.title, `tab-${i + 1}`, t.id !== activeTabId.value, `CmdOrCtrl+${i + 1}`)),
    ]),
    submenu('Hilfe', [item('Tastenkürzel', 'shortcuts')]),
  ])
})

defineMenuHandlers({
  mcp: () => (mcpOpen.value = true),
  update: () => checkForUpdate(true),
  'new-tab': () => addTab(activeConnectionId.value, activeDatabase.value),
  'duplicate-tab': () => duplicateTab(activeTab.value),
  open: openQueryFile,
  save: () => save(activeTab.value),
  'save-as': () => save(activeTab.value, true),
  'new-connection': () => openModal(),
  'toggle-connection': () => toggleConnection(),
  'close-tab': () => requestClose(activeTab.value),
  history: () => (historyOpen.value = true),
  sidebar: toggleSidebar,
  'design-system': () => (colorMode.preference = 'system'),
  'design-light': () => (colorMode.preference = 'light'),
  'design-dark': () => (colorMode.preference = 'dark'),
  'previous-tab': () => cycleTab(-1),
  'next-tab': () => cycleTab(1),
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`tab-${i + 1}`, () => selectTab(i)])),
  shortcuts: () => (shortcutsOpen.value = true),
})
</script>

<template>
  <UApp>
    <div v-if="loadError" class="flex h-full items-center justify-center p-8">
      <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-lock"
        title="Keine Verbindung zum lokalen Server"
        :description="`${loadError} – Bitte die App über den Launcher bzw. die von „deno task dev“ ausgegebene URL öffnen.`"
        class="max-w-lg"
      />
    </div>

    <!-- Sizes are remembered per browser (localStorage) via auto-save-id. -->
    <SplitterGroup v-else direction="horizontal" auto-save-id="dbm-layout" class="h-full">
      <SplitterPanel ref="sidebar" as="aside" :default-size="20" :min-size="12" :max-size="45" collapsible class="flex flex-col bg-muted/40">
        <div class="space-y-1 p-2">
          <div class="flex gap-1">
            <div class="min-w-0 flex-1">
              <ConnectionPicker @edit="openModal" />
            </div>
            <UButton
              v-if="activeConnection && locksDatabase"
              :icon="activeConnection.disconnected ? 'i-lucide-plug' : 'i-lucide-unplug'"
              color="neutral"
              variant="outline"
              :loading="togglingConnection"
              :title="activeConnection.disconnected ? 'Verbindung herstellen' : 'Verbindung trennen (gibt die Datenbankdatei für andere Programme frei)'"
              @click="toggleConnection()"
            />
          </div>
          <DatabasePicker />
        </div>
        <div class="min-h-0 flex-1 overflow-auto pb-4">
          <p v-if="activeConnection?.disconnected" class="px-3 py-2 text-sm text-muted">
            Verbindung getrennt. Die Datenbankdatei ist für andere Programme freigegeben.
          </p>
          <SchemaTree
            v-else-if="activeConnectionId"
            :key="`${activeConnectionId}/${activeDatabase ?? ''}`"
            :connection-id="activeConnectionId"
            :database="activeDatabase"
          />
        </div>
        <div class="border-t border-default px-3 py-1 text-xs text-muted">
          Colwerk {{ version }}
        </div>
      </SplitterPanel>
      <SplitterResizeHandle class="w-px bg-(--ui-border) data-[state=drag]:bg-primary data-[state=hover]:bg-primary" />

      <SplitterPanel as="main" class="flex min-w-0 flex-col">
        <div class="flex items-center gap-1 overflow-x-auto border-b border-default px-2 pt-1">
          <UButton
            :icon="sidebar?.isCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
            size="xs"
            variant="ghost"
            color="neutral"
            class="shrink-0"
            :title="sidebar?.isCollapsed ? 'Seitenleiste einblenden (⌘B)' : 'Seitenleiste ausblenden (⌘B)'"
            @click="toggleSidebar"
          />
          <div
            v-for="t in tabs"
            :key="t.id"
            class="flex cursor-pointer items-center gap-1 rounded-t border border-b-0 px-3 py-1 text-sm"
            :class="t.id === activeTabId ? 'border-default bg-default' : 'border-transparent text-muted hover:text-default'"
            @click="activeTabId = t.id"
          >
            <UIcon v-if="t.running" name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
            <UIcon v-else-if="t.transaction" name="i-lucide-triangle-alert" :class="t.transaction === 'failed' ? 'text-error' : 'text-warning'" class="size-3.5" :title="t.transaction === 'failed' ? 'Transaktion fehlgeschlagen' : 'Transaktion offen'" />
            <span v-if="colorOf(t.connectionId)" class="size-2 shrink-0 rounded-full" :class="connectionColorClasses[colorOf(t.connectionId)!].bg" />
            <input
              v-if="renaming === t.id"
              ref="rename-input"
              v-model="draft"
              maxlength="60"
              class="bg-transparent outline-none"
              :style="{ width: `${renameWidth}px` }"
              @keydown.enter="commitRename(t)"
              @keydown.escape="renaming = undefined"
              @blur="commitRename(t)"
            >
            <span v-else class="max-w-60 truncate" :title="t.path ?? t.title" @dblclick="startRename(t, $event)">{{ t.title }}</span>
            <UButton icon="i-lucide-x" size="xs" variant="link" color="neutral" class="p-0" title="Tab schließen" @click.stop="requestClose(t)" />
          </div>
          <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral" title="Neuer Tab" @click="addTab(activeConnectionId, activeDatabase)" />
          <UButton icon="i-lucide-history" size="xs" variant="ghost" color="neutral" class="ml-auto" title="Verlauf" @click="historyOpen = true" />
          <!-- In the desktop app it is in the application menu. -->
          <UButton v-if="!hasApplicationMenu" icon="i-lucide-sparkles" size="xs" variant="ghost" color="neutral" title="MCP einrichten" @click="mcpOpen = true" />
          <UButton
            :icon="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
            size="xs"
            variant="ghost"
            color="neutral"
            :title="colorMode.preference !== 'system' ? 'System-Design' : isDark ? 'Helles Design' : 'Dunkles Design'"
            @click="colorMode.preference = colorMode.preference !== 'system' ? 'system' : isDark ? 'light' : 'dark'"
          />
          <UButton icon="i-lucide-keyboard" size="xs" variant="ghost" color="neutral" title="Tastenkürzel (?)" @click="shortcutsOpen = true" />
        </div>
        <div class="min-h-0 flex-1">
          <!-- v-show keeps each tab's editor state alive while switching. -->
          <QueryPanel v-for="t in tabs" v-show="t.id === activeTabId" :key="t.id" :tab="t" />
          <div v-if="!activeTab" class="flex h-full items-center justify-center text-muted">
            <UButton icon="i-lucide-plus" label="Neuer Tab" variant="soft" @click="addTab(activeConnectionId, activeDatabase)" />
          </div>
        </div>
      </SplitterPanel>
    </SplitterGroup>

    <LazyConnectionModal v-model:open="modalOpen" :connection="editing" />
    <LazyShortcutsModal v-model:open="shortcutsOpen" />
    <LazyMcpModal v-model:open="mcpOpen" />
    <LazyHistoryModal v-model:open="historyOpen" :connection-id="activeTab?.connectionId ?? activeConnectionId" @select="e => openInNewTab(e.connectionId, e.sql)" />
    <UModal
      :open="!!closing"
      title="Tab schließen?"
      :description="closingTab?.transaction
        ? 'Die offene Transaktion des Tabs wird beim Schließen zurückgerollt.'
        : 'Der Tab enthält eine Abfrage, die beim Schließen verloren geht.'"
      :close="false"
      @update:open="v => !v && (closing = undefined)"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Abbrechen" color="neutral" variant="ghost" @click="closing = undefined" />
          <UButton label="Schließen" color="error" @click="confirmClose" />
        </div>
      </template>
    </UModal>
    <UModal
      v-model:open="confirmingDisconnect"
      title="Verbindung trennen?"
      description="Offene Transaktionen in Tabs dieser Verbindung werden beim Trennen zurückgerollt."
      :close="false"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Abbrechen" color="neutral" variant="ghost" @click="confirmingDisconnect = false" />
          <UButton label="Trennen" color="error" @click="toggleConnection(true)" />
        </div>
      </template>
    </UModal>
  </UApp>
</template>
