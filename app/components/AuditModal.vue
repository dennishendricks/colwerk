<script setup lang="ts">
import { type AuditEntry, auditRetentions } from '../../core/audit.ts'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ select: [entry: AuditEntry] }>()

const { connections } = useConnections()
const { t, locale } = useI18n()
const entries = ref<AuditEntry[]>([])
const retentionDays = ref(30)
const error = ref<string>()
const connectionFilter = ref('all')
const period = ref<'hour' | 'day' | 'week' | 'all'>('all')

const PERIOD_MS = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 }
const MAX_SHOWN = 500

async function load() {
  error.value = undefined
  try {
    const log = await api<{ retentionDays: number; entries: AuditEntry[] }>('/api/mcp/audit')
    entries.value = log.entries
    retentionDays.value = log.retentionDays
  } catch (e) {
    error.value = errorMessage(e)
  }
}

watch(open, (v) => v && load(), { immediate: true })

const connectionItems = computed(() => [
  { label: t('audit.allConnections'), value: 'all' },
  ...connections.value.map((c) => ({ label: c.name, value: c.id })),
])
const periodItems = (['hour', 'day', 'week', 'all'] as const).map((p) => ({
  label: t(`audit.periods.${p}`),
  value: p,
}))
const retentionItems = auditRetentions.map((n): { label: string; value: number } => ({
  label: t('audit.retentionDays', { n }, n),
  value: n,
}))

const matching = computed(() => {
  const since = period.value === 'all' ? 0 : Date.now() - PERIOD_MS[period.value]
  return entries.value.filter(
    (e) => (connectionFilter.value === 'all' || e.connectionId === connectionFilter.value) && Date.parse(e.at) >= since,
  )
})
const shown = computed(() => matching.value.slice(0, MAX_SHOWN))

const connectionName = (e: AuditEntry) =>
  connections.value.find((c) => c.id === e.connectionId)?.name ?? e.connectionName ?? t('audit.deletedConnection')
// Disabled when the connection has been deleted since.
const canOpen = (e: AuditEntry) => !!e.sql && connections.value.some((c) => c.id === e.connectionId)

function details(e: AuditEntry): string {
  const parts = [new Date(e.at).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'medium' })]
  parts.push(formatDuration(e.durationMs))
  if (e.rowCount !== undefined) parts.push(t('common.rows', { n: e.rowCount.toLocaleString(locale.value) }, e.rowCount))
  return parts.join(' · ')
}

function select(e: AuditEntry) {
  emit('select', e)
  open.value = false
}

async function setRetention(n: number) {
  try {
    await api('/api/mcp/audit', { method: 'POST', body: { retentionDays: n } })
    await load()
  } catch (e) {
    error.value = errorMessage(e)
  }
}

async function clear() {
  try {
    await api('/api/mcp/audit', { method: 'DELETE' })
    entries.value = []
  } catch (e) {
    error.value = errorMessage(e)
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('audit.title')"
    :description="t('audit.description')"
    :ui="{ content: 'max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <USelect
            v-model="connectionFilter"
            :items="connectionItems"
            :aria-label="t('audit.connection')"
            class="flex-1"
          />
          <USelect v-model="period" :items="periodItems" :aria-label="t('audit.period')" class="w-44" />
        </div>
        <UAlert v-if="error" color="error" variant="subtle" :description="error" />
        <p v-else-if="!shown.length" class="py-6 text-center text-sm text-muted">
          {{ t('audit.empty') }}
        </p>
        <ul class="space-y-1">
          <li v-for="e in shown" :key="e.id">
            <button
              type="button"
              class="w-full rounded p-2 text-left hover:bg-elevated disabled:cursor-default disabled:hover:bg-transparent"
              :disabled="!canOpen(e)"
              @click="select(e)"
            >
              <div class="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <UIcon
                  v-if="e.status === 'error'"
                  name="i-lucide-circle-alert"
                  class="size-3.5 shrink-0 text-error"
                  :aria-label="t('audit.failed')"
                />
                <UIcon
                  v-else-if="e.status === 'timeout'"
                  name="i-lucide-timer-off"
                  class="size-3.5 shrink-0 text-warning"
                  :aria-label="t('audit.timedOut')"
                />
                <span class="font-mono">{{ e.tool }}</span>
                <span>{{ e.client === 'unknown' ? t('audit.unknownClient') : e.client }}</span>
                <span v-if="e.connectionId" class="font-medium text-default">{{ connectionName(e) }}</span>
                <span>{{ details(e) }}</span>
              </div>
              <pre v-if="e.sql" class="mt-1 line-clamp-3 font-mono text-xs break-all whitespace-pre-wrap">{{
                e.sql
              }}</pre>
              <p v-if="e.error" class="truncate text-xs text-error" :title="e.error">{{ e.error }}</p>
            </button>
          </li>
        </ul>
        <p v-if="matching.length > MAX_SHOWN" class="text-center text-xs text-muted">
          {{ t('audit.limited', { n: MAX_SHOWN }) }}
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <USelect
          :model-value="retentionDays"
          :items="retentionItems"
          :aria-label="t('audit.retention')"
          class="w-36"
          @update:model-value="setRetention"
        />
        <UButton
          :label="t('audit.clear')"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          :disabled="!entries.length"
          @click="clear"
        />
      </div>
    </template>
  </UModal>
</template>
