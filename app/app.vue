<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import type { ConnectionSummary } from '#core'
import type { QueryTab } from '~/composables/workspace'

const { activeConnectionId, load } = useWorkspace()
const { tabs, activeTabId, restoreTabs, addTab, closeTab } = useTabs()

const loadError = ref<string>()
const modalOpen = ref(false)
const editing = ref<ConnectionSummary>()

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value))

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

const shortcutsOpen = ref(false)
const mcpOpen = ref(false)
// Tab that waits for confirmation because it still contains a query.
const closing = ref<string>()

function requestClose(tab?: QueryTab) {
  if (!tab) return
  if (tab.sql.trim()) closing.value = tab.id
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
  const copy = addTab(tab.connectionId)
  Object.assign(copy, { title: `${tab.title} (Kopie)`, sql: tab.sql, rowLimit: tab.rowLimit, timeout: tab.timeout })
}

// Wraps around at both ends.
function cycleTab(step: number) {
  const index = tabs.value.findIndex(t => t.id === activeTabId.value)
  const tab = tabs.value[(index + step + tabs.value.length) % tabs.value.length]
  if (tab) activeTabId.value = tab.id
}

// `?` has no usingInput, so it stays inactive while typing in the rename input.
defineShortcuts({
  meta_t: { usingInput: true, handler: () => addTab(activeConnectionId.value) },
  meta_w: { usingInput: true, handler: () => requestClose(activeTab.value) },
  meta_shift_d: { usingInput: true, handler: () => duplicateTab(activeTab.value) },
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`meta_${i + 1}`, {
    usingInput: true,
    handler: () => {
      const tab = tabs.value[i]
      if (tab) activeTabId.value = tab.id
    },
  }])),
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
      <SplitterPanel as="aside" :default-size="20" :min-size="12" :max-size="45" class="flex flex-col bg-muted/40">
        <div class="p-2">
          <ConnectionPicker @edit="openModal" />
        </div>
        <div class="min-h-0 flex-1 overflow-auto pb-4">
          <SchemaTree v-if="activeConnectionId" :key="activeConnectionId" :connection-id="activeConnectionId" />
        </div>
        <div class="border-t border-default px-3 py-1 text-xs text-muted">
          Colwerk {{ version }}
        </div>
      </SplitterPanel>
      <SplitterResizeHandle class="w-px bg-(--ui-border) data-[state=drag]:bg-primary data-[state=hover]:bg-primary" />

      <SplitterPanel as="main" class="flex min-w-0 flex-col">
        <div class="flex items-center gap-1 overflow-x-auto border-b border-default px-2 pt-1">
          <div
            v-for="t in tabs"
            :key="t.id"
            class="flex cursor-pointer items-center gap-1 rounded-t border border-b-0 px-3 py-1 text-sm"
            :class="t.id === activeTabId ? 'border-default bg-default' : 'border-transparent text-muted hover:text-default'"
            @click="activeTabId = t.id"
          >
            <UIcon v-if="t.running" name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
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
            <span v-else class="max-w-60 truncate" :title="t.title" @dblclick="startRename(t, $event)">{{ t.title }}</span>
            <UButton icon="i-lucide-x" size="xs" variant="link" color="neutral" class="p-0" title="Tab schließen" @click.stop="requestClose(t)" />
          </div>
          <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral" title="Neuer Tab" @click="addTab(activeConnectionId)" />
          <UButton icon="i-lucide-plug" size="xs" variant="ghost" color="neutral" class="ml-auto" title="MCP einrichten" @click="mcpOpen = true" />
          <UButton icon="i-lucide-keyboard" size="xs" variant="ghost" color="neutral" title="Tastenkürzel (?)" @click="shortcutsOpen = true" />
        </div>
        <div class="min-h-0 flex-1">
          <!-- v-show keeps each tab's editor state alive while switching. -->
          <QueryPanel v-for="t in tabs" v-show="t.id === activeTabId" :key="t.id" :tab="t" />
          <div v-if="!activeTab" class="flex h-full items-center justify-center text-muted">
            <UButton icon="i-lucide-plus" label="Neuer Tab" variant="soft" @click="addTab(activeConnectionId)" />
          </div>
        </div>
      </SplitterPanel>
    </SplitterGroup>

    <LazyConnectionModal v-model:open="modalOpen" :connection="editing" />
    <LazyShortcutsModal v-model:open="shortcutsOpen" />
    <LazyMcpModal v-model:open="mcpOpen" />
    <UModal
      :open="!!closing"
      title="Tab schließen?"
      description="Der Tab enthält eine Abfrage, die beim Schließen verloren geht."
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
  </UApp>
</template>
