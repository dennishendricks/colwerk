<script setup lang="ts">
import type { HistoryEntry } from '#core'

const props = defineProps<{ connectionId?: string; database?: string }>()
const emit = defineEmits<{ newConnection: []; select: [entry: HistoryEntry] }>()

const { connections } = useConnections()
const { openFile } = useTabs()
const { t } = useI18n()

const history = ref<HistoryEntry[]>([])
// Loaded each time the empty state appears, so it shows the queries run since.
onMounted(async () => {
  history.value = await api<HistoryEntry[]>('/api/history').catch(() => [])
})

// The current connection's queries; without one, those of any existing connection (entries of deleted ones can't run).
const recent = computed(() => {
  const seen = new Set<string>()
  return history.value
    .filter((e) =>
      props.connectionId
        ? e.connectionId === props.connectionId
        : connections.value.some((c) => c.id === e.connectionId),
    )
    .filter((e) => !seen.has(e.sql) && !!seen.add(e.sql))
    .slice(0, 5)
})
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-4 overflow-auto p-4">
    <p class="text-sm text-muted">{{ connectionId ? t('empty.hint') : t('empty.noConnection') }}</p>
    <div class="flex flex-wrap justify-center gap-2">
      <UButton
        icon="i-lucide-database"
        :label="t('empty.newConnection')"
        :variant="connectionId ? 'soft' : 'solid'"
        @click="emit('newConnection')"
      />
      <UButton
        icon="i-lucide-folder-open"
        :label="t('empty.openFile')"
        color="neutral"
        variant="soft"
        @click="openFile(connectionId, database)"
      />
    </div>
    <div v-if="recent.length" class="w-full max-w-xl">
      <p class="mb-1 text-xs font-medium uppercase text-muted">{{ t('empty.recent') }}</p>
      <ul>
        <li v-for="e in recent" :key="e.id">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-elevated"
            :title="e.sql"
            @click="emit('select', e)"
          >
            <UIcon name="i-lucide-history" class="size-3.5 shrink-0 text-dimmed" />
            <span class="truncate font-mono text-xs">{{ e.sql.replace(/\s+/g, ' ').trim() }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
