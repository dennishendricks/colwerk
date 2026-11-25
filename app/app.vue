<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { ConnectionSummary } from '#core'
import type { ReturnedTab } from '~/composables/tabs'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { de, en } from '@nuxt/ui/locale'
import { dropActive } from '~/composables/data-files'

const { connections, activeConnectionId, activeDatabase, activeConnection, driverOf, load } = useConnections()
const { canToggle, togglingConnection, confirmingDisconnect, toggleConnection } = useConnectionToggle()
const {
  tabs,
  activeTabId,
  activeTab,
  restoreTabs,
  addTab,
  duplicateTab,
  returnTabs,
  takeTabs,
  requestClose,
  selectTab,
  openFile,
  saveFile,
} = useTabs()
const { t, locale } = useI18n()
const { openPaths } = useDataFiles()
const { running: runningTour, offerTours } = useTours()
if (windowLabel === 'main') offerTours()

const loadError = ref<string>()
const modalOpen = ref(false)
const editing = ref<ConnectionSummary>()

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
      // Files dropped onto the window (desktop app; the browser gives no paths).
      if (isDesktop) {
        await getCurrentWebview().onDragDropEvent(({ payload }) => {
          dropActive.value = payload.type === 'enter' || payload.type === 'over'
          if (payload.type === 'drop') openPaths(payload.paths)
        })
      }
    }
    if (isDesktop && windowLabel === 'main') openSystemFiles()
  } catch (e) {
    loadError.value = errorMessage(e)
  }
}

watch(sessionToken, init, { immediate: true })
if (windowLabel === 'main') checkForUpdate()

const { version } = useRuntimeConfig().public

// After an update (desktop app only), a toast links the changelog once. The version of the last start is kept in a
// cookie, like the language (app/utils/locale.ts); on the first start there is none, so nothing is shown.
const seenVersion = useCookie<string | undefined>('colwerk-version', { maxAge: 10 * 365 * 24 * 3600 })
if (isDesktop) {
  if (seenVersion.value && version.localeCompare(seenVersion.value, undefined, { numeric: true }) > 0) {
    useToast().add({
      title: t('releaseNotes.updated', { version }),
      icon: 'i-lucide-sparkles',
      duration: 0,
      actions: [{ label: t('releaseNotes.changelog'), onClick: () => openUrl(changelogUrl) }],
    })
  }
  seenVersion.value = version
}

// Queries prepared by an MCP client (tool open-query) open in a new tab, without running.
function onServerEvent(type: string, data: string) {
  if (type !== 'open-query') return
  const { connectionId, sql, title } = JSON.parse(data) as { connectionId: string; sql: string; title?: string }
  openInNewTab(connectionId, sql, title)
}

// Files opened with Colwerk from the system (file associations): the shell keeps them until the page has loaded
// and takes them (src-tauri/src/main.rs). Query and plan files (.sql, .sqlplan) open in a tab, database files as a
// connection, data files are queried (composables/data-files.ts).
async function openSystemFiles() {
  await openPaths(await invoke<string[]>('take_opened_files'))
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

const colorMode = useColorMode()
// The native title bar follows the chosen mode; without one (null) it follows the system, like the page.
watch(
  () => colorMode.preference,
  (mode) => isDesktop && getCurrentWindow().setTheme(mode === 'system' ? null : (mode as 'light' | 'dark')),
  { immediate: true },
)

const shortcutsOpen = ref(false)
const mcpOpen = ref(false)
const auditOpen = ref(false)
const historyOpen = ref(false)
const importOpen = ref(false)
const compareOpen = ref(false)
const aboutOpen = ref(false)
const settingsOpen = ref(false)
const quickOpen = ref(false)
const sessionsOpen = ref(false)
watch(activeConnectionId, () => (sessionsOpen.value = false))
// The audit log opens from the MCP dialog, which makes room for it.
function openAudit() {
  mcpOpen.value = false
  auditOpen.value = true
}
const schemaTree = useTemplateRef('schemaTree')
// Searches the schema tree's connection, so the selected table is queried on the same one.
const canQuickOpen = computed(() => !!activeConnectionId.value && !activeConnection.value?.disconnected)
const openQuickOpen = () => (quickOpen.value = canQuickOpen.value)

// `?` has no usingInput, so it stays inactive while typing in the rename input.
defineShortcuts({
  meta_t: { usingInput: true, handler: () => addTab(activeConnectionId.value, activeDatabase.value) },
  meta_w: { usingInput: true, handler: () => requestClose(activeTab.value) },
  meta_shift_d: { usingInput: true, handler: () => duplicateTab(activeTab.value) },
  meta_o: { usingInput: true, handler: () => openFile(activeConnectionId.value, activeDatabase.value) },
  meta_s: { usingInput: true, handler: () => saveFile(activeTab.value) },
  meta_shift_s: { usingInput: true, handler: () => saveFile(activeTab.value, true) },
  meta_b: { usingInput: true, handler: toggleSidebar },
  meta_p: { usingInput: true, handler: openQuickOpen },
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`meta_${i + 1}`, { usingInput: true, handler: () => selectTab(i) }]),
  ),
  '?': () => (shortcutsOpen.value = !shortcutsOpen.value),
})

const { size } = useWindowKeys()
useHead({ htmlAttrs: { lang: locale, style: computed(() => `--font-size: ${size.value}px`) } })

useApplicationMenu({
  openMcp: () => (mcpOpen.value = true),
  openMcpAudit: () => (auditOpen.value = true),
  openHistory: () => (historyOpen.value = true),
  openShortcuts: () => (shortcutsOpen.value = true),
  openAbout: () => (aboutOpen.value = true),
  openSettings: () => (settingsOpen.value = true),
  openConnection: () => openModal(),
  openImport: () => (importOpen.value = true),
  toggleSidebar,
  openQuickOpen,
})
// Not in the menu, for the guided tours (runMenuAction): opening the compare and closing what a tour opened.
defineMenuHandlers({
  compare: () => (compareOpen.value = true),
  'close-dialogs': () => {
    for (const open of [modalOpen, importOpen, shortcutsOpen, mcpOpen, auditOpen, historyOpen, compareOpen, quickOpen])
      open.value = false
  },
})
</script>

<template>
  <UApp :locale="locale === 'de' ? de : en" :toaster="{ expand: false }">
    <div
      v-if="dropActive"
      class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-2 border-dashed border-primary bg-default/80 text-lg"
    >
      {{ t('files.dropHint') }}
    </div>
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
        class="motion-panel flex flex-col bg-muted/40"
      >
        <div class="space-y-1 p-2" data-tour="connections">
          <div class="flex gap-1">
            <div class="min-w-0 flex-1">
              <ConnectionPicker @edit="openModal" @import="importOpen = true" />
            </div>
            <UButton
              v-if="activeConnection && canToggle"
              :icon="activeConnection.disconnected ? 'i-lucide-plug' : 'i-lucide-unplug'"
              color="neutral"
              variant="outline"
              :loading="togglingConnection"
              :title="activeConnection.disconnected ? t('app.connect') : t('app.disconnectHint')"
              :aria-label="activeConnection.disconnected ? t('app.connect') : t('app.disconnectHint')"
              @click="toggleConnection()"
            />
            <UButton
              v-if="
                activeConnection &&
                !activeConnection.disconnected &&
                driverOf(activeConnectionId)?.capabilities.sessionActions.length
              "
              icon="i-lucide-activity"
              color="neutral"
              variant="outline"
              :title="t('sessions.open')"
              :aria-label="t('sessions.open')"
              @click="sessionsOpen = true"
            />
          </div>
          <DatabasePicker />
        </div>
        <div class="min-h-0 flex-1 overflow-auto pb-4" data-tour="schema">
          <p v-if="activeConnection?.disconnected" class="px-3 py-2 text-sm text-muted">
            {{ t('app.disconnected') }}
          </p>
          <SchemaTree
            v-else-if="activeConnectionId"
            ref="schemaTree"
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
        <div class="flex items-center gap-1 overflow-x-auto border-b border-default px-2 pt-1" data-tour="tab-bar">
          <UButton
            :icon="sidebar?.isCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
            size="xs"
            variant="ghost"
            color="neutral"
            class="shrink-0"
            :title="sidebar?.isCollapsed ? t('app.showSidebar') : t('app.hideSidebar')"
            :aria-label="sidebar?.isCollapsed ? t('app.showSidebar') : t('app.hideSidebar')"
            @click="toggleSidebar"
          />
          <EditorTabs />
          <UButton
            icon="i-lucide-plus"
            size="xs"
            variant="ghost"
            color="neutral"
            :title="t('app.newTab')"
            :aria-label="t('app.newTab')"
            @click="addTab(activeConnectionId, activeDatabase)"
          />
          <TabBarActions
            @compare="compareOpen = true"
            @history="historyOpen = true"
            @mcp="mcpOpen = true"
            @shortcuts="shortcutsOpen = true"
            @about="aboutOpen = true"
            @settings="settingsOpen = true"
          />
        </div>
        <div class="min-h-0 flex-1">
          <!-- v-show keeps each tab's editor state alive while switching. -->
          <QueryPanel
            v-for="tab in tabs"
            v-show="tab.id === activeTabId"
            :id="`panel-${tab.id}`"
            :key="tab.id"
            role="tabpanel"
            :aria-labelledby="`tab-${tab.id}`"
            :tab="tab"
            @new-connection="openModal()"
            @import-connections="importOpen = true"
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
    <LazyConnectionImportModal v-model:open="importOpen" />
    <FileQueryModals />
    <LazyShortcutsModal v-model:open="shortcutsOpen" />
    <LazyMcpModal v-model:open="mcpOpen" @audit="openAudit" />
    <UnlockModal />
    <LazyAboutModal v-model:open="aboutOpen" />
    <LazySettingsModal v-model:open="settingsOpen" />
    <LazyQuickOpen
      v-if="activeConnectionId"
      v-model:open="quickOpen"
      :connection-id="activeConnectionId"
      :database="activeDatabase"
      @select="(schema, table) => schemaTree?.selectTable(schema, table)"
    />
    <LazySessionMonitorModal
      v-if="activeConnectionId"
      v-model:open="sessionsOpen"
      :connection-id="activeConnectionId"
    />
    <LazyCompareModal v-model:open="compareOpen" />
    <LazyHistoryModal
      v-model:open="historyOpen"
      :connection-id="activeTab?.connectionId ?? activeConnectionId"
      @select="(e) => openInNewTab(e.connectionId, e.sql)"
    />
    <LazyAuditModal v-model:open="auditOpen" @select="(e) => openInNewTab(e.connectionId!, e.sql!)" />
    <LazyDataImportModal />
    <CloseTabsModal />
    <LazyTourHost v-if="runningTour" :key="runningTour.id" :definition="runningTour" />
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
