<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { ConnectionSummary } from '#core'
import type { QueryTab, ReturnedTab } from '~/composables/tabs'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { de, en } from '@nuxt/ui/locale'

const { connections, activeConnectionId, activeDatabase, activeConnection, load, openDatabaseFile } = useConnections()
const { canToggle, togglingConnection, confirmingDisconnect, toggleConnection } = useConnectionToggle()
const {
  tabs,
  activeTabId,
  activeTab,
  closing,
  closingTabs,
  restoreTabs,
  addTab,
  duplicateTab,
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
} = useTabs()
const { t, locale } = useI18n()
const toast = useToast()

const loadError = ref<string>()
const modalOpen = ref(false)
const editing = ref<ConnectionSummary>()

const colorOf = (connectionId?: string) => connections.value.find((c) => c.id === connectionId)?.color

let listening = false

async function init() {
  loadError.value = undefined
  try {
    await load()
    if (!tabs.value.length) {
      await restoreTabs()
      // The sidebar opens on the connection and database of the restored active tab.
      const restored = activeTab.value
      if (restored?.connectionId && connections.value.some((c) => c.id === restored.connectionId)) {
        activeConnectionId.value = restored.connectionId
        // After the watcher that resets the database on a connection change.
        await nextTick()
        activeDatabase.value = restored.database
      }
    }
    if (!tabs.value.length) addTab(activeConnectionId.value)
    // Queries from MCP clients and files from the system open in the main window.
    if (!listening) {
      listening = true
      if (windowLabel === 'main') subscribe('/api/events', onServerEvent)
      if (isDesktop && windowLabel === 'main') {
        await listen('open-files', openSystemFiles)
        await listen<ReturnedTab[]>('tabs-returned', (e) => takeTabs(e.payload))
      }
      if (isDesktop && windowLabel !== 'main') await getCurrentWindow().onCloseRequested(returnTabs)
    }
    if (isDesktop && windowLabel === 'main') openSystemFiles()
  } catch (e) {
    loadError.value = errorMessage(e)
  }
}

watch(sessionToken, init, { immediate: true })
if (windowLabel === 'main') checkForUpdate()

const { version } = useRuntimeConfig().public

// Queries prepared by an MCP client (tool open-query) open in a new tab, without running.
function onServerEvent(type: string, data: string) {
  if (type !== 'open-query') return
  const { connectionId, sql, title } = JSON.parse(data) as { connectionId: string; sql: string; title?: string }
  openInNewTab(connectionId, sql, title)
}

// Files opened with Colwerk from the system (file associations): the shell keeps them until the page has loaded
// and takes them (src-tauri/src/main.rs). Query files open in a tab, database files as a connection.
async function openSystemFiles() {
  for (const path of await invoke<string[]>('take_opened_files')) {
    const dialect = /\.duckdb$/i.test(path) ? 'duckdb' : /\.sqlite3?$/i.test(path) ? 'sqlite' : undefined
    if (!dialect) {
      await openFile(activeConnectionId.value, activeDatabase.value, path)
      continue
    }
    try {
      await openDatabaseFile(path, dialect)
    } catch (e) {
      toast.add({
        title: t('app.openFailed'),
        description: errorMessage(e),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    }
  }
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
const toggleSidebar = () => (sidebar.value?.isCollapsed ? sidebar.value.expand() : sidebar.value?.collapse())

// Toggles between the system setting and its opposite; the opposite is stored as a fixed mode (localStorage),
// so it no longer differs from the system once the system setting changes.
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')
// The native title bar follows the chosen mode; without one (null) it follows the system, like the page.
watch(
  () => colorMode.preference,
  (mode) => isDesktop && getCurrentWindow().setTheme(mode === 'system' ? null : (mode as 'light' | 'dark')),
  { immediate: true },
)

const shortcutsOpen = ref(false)
const mcpOpen = ref(false)
const historyOpen = ref(false)
const aboutOpen = ref(false)

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

// Desktop app only: a native context menu. In the browser the browser's own menu stays.
function onTabContextmenu(e: MouseEvent, tab: QueryTab) {
  const index = tabs.value.findIndex((x) => x.id === tab.id)
  const closeTabs = (keep: QueryTab, from: number, to: number) =>
    requestCloseMany(
      tabs.value
        .slice(from, to)
        .filter((x) => x.id !== keep.id)
        .map((x) => x.id),
      keep,
    )
  return showContextMenu(e, [
    { label: t('app.moveToWindow'), enabled: canMove(tab), action: () => moveToNewWindow(tab) },
    ...(windowLabel === 'main'
      ? []
      : [{ label: t('app.moveToMainWindow'), enabled: canReturn(tab), action: () => moveToMainWindow(tab) }]),
    'separator',
    {
      label: t('app.closeOtherTabs'),
      enabled: tabs.value.length > 1,
      action: () => closeTabs(tab, 0, tabs.value.length),
    },
    { label: t('app.closeTabsLeft'), enabled: index > 0, action: () => closeTabs(tab, 0, index) },
    {
      label: t('app.closeTabsRight'),
      enabled: index < tabs.value.length - 1,
      action: () => closeTabs(tab, index + 1, tabs.value.length),
    },
  ])
}

const closeDescription = computed(() => {
  const transaction = closingTabs.value.some((x) => x.transaction)
  if (closingTabs.value.length > 1) {
    return t(transaction ? 'app.closeTabsTransaction' : 'app.closeTabsQuery', { n: closingTabs.value.length })
  }
  return t(transaction ? 'app.closeTabTransaction' : 'app.closeTabQuery')
})

function commitRename(tab: QueryTab) {
  // Removing the input after Enter or Escape can fire blur as well.
  if (renaming.value !== tab.id) return
  const title = draft.value.trim()
  if (title) tab.title = title
  renaming.value = undefined
}

// `?` has no usingInput, so it stays inactive while typing in the rename input.
defineShortcuts({
  meta_t: { usingInput: true, handler: () => addTab(activeConnectionId.value, activeDatabase.value) },
  meta_w: { usingInput: true, handler: () => requestClose(activeTab.value) },
  meta_shift_d: { usingInput: true, handler: () => duplicateTab(activeTab.value) },
  meta_o: { usingInput: true, handler: () => openFile(activeConnectionId.value, activeDatabase.value) },
  meta_s: { usingInput: true, handler: () => saveFile(activeTab.value) },
  meta_shift_s: { usingInput: true, handler: () => saveFile(activeTab.value, true) },
  meta_b: { usingInput: true, handler: toggleSidebar },
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`meta_${i + 1}`, { usingInput: true, handler: () => selectTab(i) }]),
  ),
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

useApplicationMenu({
  openMcp: () => (mcpOpen.value = true),
  openHistory: () => (historyOpen.value = true),
  openShortcuts: () => (shortcutsOpen.value = true),
  openAbout: () => (aboutOpen.value = true),
  openConnection: () => openModal(),
  toggleSidebar,
})
</script>

<template>
  <UApp :locale="locale === 'de' ? de : en">
    <div v-if="loadError" class="flex h-full items-center justify-center p-8">
      <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-lock"
        :title="t('app.noServer')"
        :description="t('app.noServerHint', { error: loadError })"
        class="max-w-lg"
      />
    </div>

    <!-- Sizes are remembered per browser (localStorage) via auto-save-id. -->
    <SplitterGroup v-else direction="horizontal" auto-save-id="colwerk-layout" class="h-full">
      <SplitterPanel
        ref="sidebar"
        as="aside"
        :default-size="20"
        :min-size="12"
        :max-size="45"
        collapsible
        class="flex flex-col bg-muted/40"
      >
        <div class="space-y-1 p-2">
          <div class="flex gap-1">
            <div class="min-w-0 flex-1">
              <ConnectionPicker @edit="openModal" />
            </div>
            <UButton
              v-if="activeConnection && canToggle"
              :icon="activeConnection.disconnected ? 'i-lucide-plug' : 'i-lucide-unplug'"
              color="neutral"
              variant="outline"
              :loading="togglingConnection"
              :title="activeConnection.disconnected ? t('app.connect') : t('app.disconnectHint')"
              @click="toggleConnection()"
            />
          </div>
          <DatabasePicker />
        </div>
        <div class="min-h-0 flex-1 overflow-auto pb-4">
          <p v-if="activeConnection?.disconnected" class="px-3 py-2 text-sm text-muted">
            {{ t('app.disconnected') }}
          </p>
          <SchemaTree
            v-else-if="activeConnectionId"
            :key="`${activeConnectionId}/${activeDatabase ?? ''}`"
            :connection-id="activeConnectionId"
            :database="activeDatabase"
          />
        </div>
        <div class="border-t border-default px-3 py-1 text-xs text-muted">
          <a :href="websiteUrl" class="hover:text-default" @click.prevent="openUrl(websiteUrl)">Colwerk</a>
          {{ version }}
          <!-- In the desktop app it is in the application menu. -->
          <template v-if="!isDesktop">
            ·
            <a :href="privacyUrl" class="hover:text-default" @click.prevent="openUrl(privacyUrl)">{{
              t('menu.privacy')
            }}</a>
          </template>
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
            :title="sidebar?.isCollapsed ? t('app.showSidebar') : t('app.hideSidebar')"
            @click="toggleSidebar"
          />
          <div
            v-for="tab in tabs"
            :key="tab.id"
            class="flex cursor-pointer items-center gap-1 rounded-t border border-b-0 px-3 py-1 text-sm"
            :class="
              tab.id === activeTabId ? 'border-default bg-default' : 'border-transparent text-muted hover:text-default'
            "
            @click="activeTabId = tab.id"
            @contextmenu="isDesktop && onTabContextmenu($event, tab)"
          >
            <UIcon v-if="tab.running" name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
            <UIcon
              v-else-if="tab.transaction"
              name="i-lucide-triangle-alert"
              :class="tab.transaction === 'failed' ? 'text-error' : 'text-warning'"
              class="size-3.5"
              :title="tab.transaction === 'failed' ? t('common.transactionFailed') : t('common.transactionOpen')"
            />
            <span
              v-if="colorOf(tab.connectionId)"
              class="size-2 shrink-0 rounded-full"
              :class="connectionColorClasses[colorOf(tab.connectionId)!].bg"
            />
            <input
              v-if="renaming === tab.id"
              ref="rename-input"
              v-model="draft"
              maxlength="60"
              class="bg-transparent outline-none"
              :style="{ width: `${renameWidth}px` }"
              @keydown.enter="commitRename(tab)"
              @keydown.escape="renaming = undefined"
              @blur="commitRename(tab)"
            />
            <span
              v-else
              class="max-w-60 truncate"
              :title="tab.path ?? tab.title"
              @dblclick="startRename(tab, $event)"
              >{{ tab.title }}</span
            >
            <UButton
              icon="i-lucide-x"
              size="xs"
              variant="link"
              color="neutral"
              class="p-0"
              :title="t('app.closeTab')"
              @click.stop="requestClose(tab)"
            />
          </div>
          <UButton
            icon="i-lucide-plus"
            size="xs"
            variant="ghost"
            color="neutral"
            :title="t('app.newTab')"
            @click="addTab(activeConnectionId, activeDatabase)"
          />
          <UButton
            icon="i-lucide-history"
            size="xs"
            variant="ghost"
            color="neutral"
            class="ml-auto"
            :title="t('app.history')"
            @click="historyOpen = true"
          />
          <!-- In the desktop app it is in the application menu. -->
          <UButton
            v-if="!isDesktop"
            icon="i-lucide-sparkles"
            size="xs"
            variant="ghost"
            color="neutral"
            :title="t('app.setupMcp')"
            @click="mcpOpen = true"
          />
          <UButton
            :icon="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
            size="xs"
            variant="ghost"
            color="neutral"
            :title="
              colorMode.preference !== 'system'
                ? t('app.systemDesign')
                : isDark
                  ? t('app.lightDesign')
                  : t('app.darkDesign')
            "
            @click="colorMode.preference = colorMode.preference !== 'system' ? 'system' : isDark ? 'light' : 'dark'"
          />
          <UButton
            icon="i-lucide-keyboard"
            size="xs"
            variant="ghost"
            color="neutral"
            :title="t('app.shortcuts')"
            @click="shortcutsOpen = true"
          />
          <!-- In the desktop app it is in the application menu. -->
          <UButton
            v-if="!isDesktop"
            icon="i-lucide-info"
            size="xs"
            variant="ghost"
            color="neutral"
            :title="t('app.about')"
            @click="aboutOpen = true"
          />
        </div>
        <div class="min-h-0 flex-1">
          <!-- v-show keeps each tab's editor state alive while switching. -->
          <QueryPanel
            v-for="tab in tabs"
            v-show="tab.id === activeTabId"
            :key="tab.id"
            :tab="tab"
            @new-connection="openModal()"
          />
          <div v-if="!activeTab" class="flex h-full items-center justify-center text-muted">
            <UButton
              icon="i-lucide-plus"
              :label="t('app.newTab')"
              variant="soft"
              @click="addTab(activeConnectionId, activeDatabase)"
            />
          </div>
        </div>
      </SplitterPanel>
    </SplitterGroup>

    <LazyConnectionModal v-model:open="modalOpen" :connection="editing" />
    <LazyShortcutsModal v-model:open="shortcutsOpen" />
    <LazyMcpModal v-model:open="mcpOpen" />
    <ReleaseNotesModal />
    <LazyAboutModal v-model:open="aboutOpen" />
    <LazyHistoryModal
      v-model:open="historyOpen"
      :connection-id="activeTab?.connectionId ?? activeConnectionId"
      @select="(e) => openInNewTab(e.connectionId, e.sql)"
    />
    <UModal
      :open="!!closing.length"
      :title="closing.length > 1 ? t('app.closeTabsTitle', { n: closing.length }) : t('app.closeTabTitle')"
      :description="closeDescription"
      :close="false"
      @update:open="(v) => !v && (closing = [])"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="closing = []" />
          <UButton :label="t('common.close')" color="error" @click="confirmClose" />
        </div>
      </template>
    </UModal>
    <UModal
      v-model:open="confirmingDisconnect"
      :title="t('app.disconnectTitle')"
      :description="t('app.disconnectDescription')"
      :close="false"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="confirmingDisconnect = false" />
          <UButton :label="t('app.disconnectConfirm')" color="error" @click="toggleConnection(true)" />
        </div>
      </template>
    </UModal>
  </UApp>
</template>
