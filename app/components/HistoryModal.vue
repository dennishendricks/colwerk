<script setup lang="ts">
import type { HistoryEntry } from '#core'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ connectionId?: string }>()
const emit = defineEmits<{ select: [entry: HistoryEntry] }>()

const { connections } = useWorkspace()
const entries = ref<HistoryEntry[]>([])
const error = ref<string>()
const search = ref('')
const currentOnly = ref(true)

watch(open, async (v) => {
  if (!v) return
  error.value = undefined
  try {
    entries.value = await api<HistoryEntry[]>('/api/history')
  } catch (e) {
    error.value = errorMessage(e)
  }
}, { immediate: true })

const shown = computed(() => {
  const term = search.value.trim().toLowerCase()
  return entries.value.filter(e => (!currentOnly.value || e.connectionId === props.connectionId) && e.sql.toLowerCase().includes(term))
})

const connectionName = (id: string) => connections.value.find(c => c.id === id)?.name

function details(e: HistoryEntry): string {
  const parts = [new Date(e.executedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' })]
  if (e.durationMs !== undefined) parts.push(e.durationMs < 1000 ? `${Math.round(e.durationMs)} ms` : `${(e.durationMs / 1000).toFixed(2)} s`)
  if (e.rowCount !== undefined) parts.push(`${e.rowCount.toLocaleString('de-DE')} Zeile(n)`)
  else if (e.affectedRows !== undefined) parts.push(`${e.affectedRows.toLocaleString('de-DE')} Zeile(n) betroffen`)
  return parts.join(' · ')
}

function select(e: HistoryEntry) {
  emit('select', e)
  open.value = false
}

async function clear() {
  try {
    await api('/api/history', { method: 'DELETE' })
    entries.value = []
  } catch (e) {
    error.value = errorMessage(e)
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Verlauf" description="Die letzten 50 ausgeführten Abfragen. Ein Klick öffnet die Abfrage in einem neuen Tab." :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <UInput v-model="search" icon="i-lucide-search" placeholder="SQL durchsuchen" class="flex-1" autocorrect="off" autocapitalize="off" :spellcheck="false" autofocus />
          <USwitch v-model="currentOnly" label="Nur aktuelle Verbindung" />
        </div>
        <UAlert v-if="error" color="error" variant="subtle" :description="error" />
        <p v-else-if="!shown.length" class="py-6 text-center text-sm text-muted">
          Keine Abfragen gefunden.
        </p>
        <ul class="space-y-1">
          <li v-for="e in shown" :key="e.id">
            <!-- Disabled when the connection has been deleted since. -->
            <button
              type="button"
              class="w-full rounded p-2 text-left hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!connectionName(e.connectionId)"
              @click="select(e)"
            >
              <div class="flex items-center gap-2 text-xs text-muted">
                <UIcon v-if="e.error" name="i-lucide-circle-alert" class="size-3.5 shrink-0 text-error" />
                <span class="font-medium text-default">{{ connectionName(e.connectionId) ?? 'Gelöschte Verbindung' }}</span>
                <span>{{ details(e) }}</span>
              </div>
              <pre class="mt-1 line-clamp-3 font-mono text-xs break-all whitespace-pre-wrap">{{ e.sql }}</pre>
              <p v-if="e.error" class="truncate text-xs text-error" :title="e.error">{{ e.error }}</p>
            </button>
          </li>
        </ul>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end">
        <UButton label="Verlauf leeren" icon="i-lucide-trash-2" color="neutral" variant="ghost" :disabled="!entries.length" @click="clear" />
      </div>
    </template>
  </UModal>
</template>
