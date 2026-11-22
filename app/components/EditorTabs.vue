<script setup lang="ts">
// The editor tab bar: selection, inline rename, keyboard navigation and the desktop context menu of the tabs
import type { QueryTab } from '~/composables/tabs'

const { connectionOf } = useConnections()
const {
  tabs,
  activeTabId,
  closing,
  canMove,
  moveToNewWindow,
  canReturn,
  moveToMainWindow,
  requestClose,
  requestCloseMany,
  selectTab,
  cycleTab,
} = useTabs()
const { t } = useI18n()

const colorOf = (connectionId?: string) => connectionOf(connectionId)?.color

// Inline rename on double-click or F2/Enter; the input takes the width of the label it replaces.
const renaming = ref<string>()
const draft = ref('')
const renameWidth = ref(0)
const renameInput = useTemplateRef<HTMLInputElement[]>('rename-input')

async function startRename(tab: QueryTab, label: HTMLElement) {
  renaming.value = tab.id
  draft.value = tab.title
  renameWidth.value = label.offsetWidth
  await nextTick()
  renameInput.value?.[0]?.focus()
  renameInput.value?.[0]?.select()
}

async function focusActiveTab() {
  await nextTick()
  document.getElementById(`tab-${activeTabId.value}`)?.focus()
}

// Tabs pattern (WAI-ARIA): arrows, Home and End move between tabs, selection follows focus.
function onTabKeydown(e: KeyboardEvent, tab: QueryTab) {
  // Keys typed in the rename input bubble up here.
  if (e.target !== e.currentTarget) return
  const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
  if (step) cycleTab(step)
  else if (e.key === 'Home') selectTab(0)
  else if (e.key === 'End') selectTab(tabs.value.length - 1)
  else if (e.key === 'F2' || e.key === 'Enter') {
    const label = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-tab-title]')
    if (label) startRename(tab, label)
  } else if (e.key === 'Delete' || e.key === 'Backspace') requestClose(tab)
  else return
  e.preventDefault()
  // A confirmation dialog for closing takes the focus itself.
  if (renaming.value !== tab.id && !closing.value.length) focusActiveTab()
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

function commitRename(tab: QueryTab) {
  // Removing the input after Enter or Escape can fire blur as well.
  if (renaming.value !== tab.id) return
  const title = draft.value.trim()
  if (title) tab.title = title
  renaming.value = undefined
}
</script>

<template>
  <!-- New tabs slide in and the others move into place (main.css); a closed tab disappears at once. -->
  <TransitionGroup
    tag="div"
    name="motion-tab"
    role="tablist"
    :aria-label="t('app.tabs')"
    class="flex items-center gap-1"
  >
    <div
      v-for="tab in tabs"
      :id="`tab-${tab.id}`"
      :key="tab.id"
      role="tab"
      :aria-selected="tab.id === activeTabId"
      :aria-controls="`panel-${tab.id}`"
      :tabindex="tab.id === activeTabId ? 0 : -1"
      class="flex cursor-pointer items-center gap-1 rounded-t border border-b-0 px-3 py-1 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      :class="tab.id === activeTabId ? 'border-default bg-default' : 'border-transparent text-muted hover:text-default'"
      @click="activeTabId = tab.id"
      @keydown="onTabKeydown($event, tab)"
      @contextmenu="isDesktop && onTabContextmenu($event, tab)"
    >
      <UIcon v-if="tab.running" name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
      <UIcon
        v-else-if="tab.transaction"
        name="i-lucide-triangle-alert"
        :class="tab.transaction === 'failed' ? 'text-error' : 'text-warning'"
        class="motion-enter size-3.5"
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
        @keydown.enter="(commitRename(tab), focusActiveTab())"
        @keydown.escape="((renaming = undefined), focusActiveTab())"
        @blur="commitRename(tab)"
      />
      <span
        v-else
        data-tab-title
        class="max-w-60 truncate"
        :title="tab.path ?? tab.title"
        @dblclick="startRename(tab, $event.currentTarget as HTMLElement)"
        >{{ tab.title }}</span
      >
      <!-- Not a tab stop and hidden from screen readers: a tab must not contain controls. Delete or ⌘W close it. -->
      <UButton
        icon="i-lucide-x"
        size="xs"
        variant="link"
        color="neutral"
        class="p-0"
        tabindex="-1"
        aria-hidden="true"
        :title="t('app.closeTab')"
        @click.stop="requestClose(tab)"
      />
    </div>
  </TransitionGroup>
</template>
