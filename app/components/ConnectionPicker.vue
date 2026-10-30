<script setup lang="ts">
import type { ConnectionSummary } from '#core'

const emit = defineEmits<{ edit: [connection?: ConnectionSummary] }>()

const { connections, activeConnectionId, driverOf } = useWorkspace()
const { t } = useI18n()

const open = ref(false)
const collapsed = reactive(new Set<string>())

const byName = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base', numeric: true })

// Folders first, then connections without folder; both levels alphabetically.
const groups = computed(() => {
  const sorted = [...connections.value].sort((a, b) => byName(a.name, b.name))
  const folders = [...new Set(sorted.flatMap(c => c.folder ? [c.folder] : []))].sort(byName)
  return [
    ...folders.map(folder => ({ folder, items: sorted.filter(c => c.folder === folder) })),
    { folder: undefined, items: sorted.filter(c => !c.folder) },
  ]
})

const active = computed(() => connections.value.find(c => c.id === activeConnectionId.value))

function select(id: string) {
  activeConnectionId.value = id
  open.value = false
}

function edit(connection?: ConnectionSummary) {
  open.value = false
  emit('edit', connection)
}

function toggle(folder: string) {
  if (!collapsed.delete(folder)) collapsed.add(folder)
}

const dialectIcon = (id: string) => driverOf(id)?.capabilities.supportsNetwork ? 'i-lucide-server' : 'i-lucide-file'
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'start', side: 'bottom' }">
    <UButton
      color="neutral"
      variant="outline"
      class="w-full"
      trailing-icon="i-lucide-chevrons-up-down"
      :icon="active ? dialectIcon(active.id) : 'i-lucide-database'"
      :ui="{ trailingIcon: 'ml-auto' }"
    >
      <span class="truncate">
        <span v-if="active?.folder" class="text-muted">{{ active.folder }} / </span>{{ active?.name ?? t('common.selectConnection') }}
      </span>
      <span v-if="active?.color" class="size-2 shrink-0 rounded-full" :class="connectionColorClasses[active.color].bg" />
    </UButton>

    <template #content>
      <div class="flex max-h-[70vh] w-80 flex-col text-sm">
        <div class="flex items-center justify-between border-b border-default px-3 py-2">
          <span class="text-xs font-medium uppercase text-muted">{{ t('connection.connections') }}</span>
          <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral" :label="t('connection.newShort')" @click="edit()" />
        </div>
        <div class="min-h-0 overflow-auto p-1">
          <template v-for="g in groups" :key="g.folder ?? ''">
            <button
              v-if="g.folder"
              class="flex w-full items-center gap-1 rounded px-2 py-1 text-left hover:bg-elevated/60"
              @click="toggle(g.folder)"
            >
              <UIcon :name="collapsed.has(g.folder) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="size-3.5 shrink-0 text-muted" />
              <UIcon :name="collapsed.has(g.folder) ? 'i-lucide-folder' : 'i-lucide-folder-open'" class="size-4 shrink-0 text-muted" />
              <span class="truncate font-medium">{{ g.folder }}</span>
              <span class="ml-auto text-xs text-muted">{{ g.items.length }}</span>
            </button>
            <template v-if="!g.folder || !collapsed.has(g.folder)">
              <div
                v-for="c in g.items"
                :key="c.id"
                class="group flex cursor-pointer items-center gap-2 rounded py-1 pr-2"
                :class="[g.folder ? 'pl-8' : 'pl-2', c.id === activeConnectionId ? 'bg-elevated font-medium' : 'hover:bg-elevated/60']"
                @click="select(c.id)"
              >
                <UIcon :name="dialectIcon(c.id)" class="size-4 shrink-0 text-muted" />
                <span class="truncate">{{ c.name }}</span>
                <span v-if="c.color" class="size-2 shrink-0 rounded-full" :class="connectionColorClasses[c.color].bg" :title="t(`colors.${c.color}`)" />
                <UButton
                  icon="i-lucide-pencil"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  class="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  :title="t('connection.editShort')"
                  @click.stop="edit(c)"
                />
              </div>
            </template>
          </template>
          <p v-if="!connections.length" class="px-2 py-1 text-muted">{{ t('connection.none') }}</p>
        </div>
      </div>
    </template>
  </UPopover>
</template>
