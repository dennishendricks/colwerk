<script setup lang="ts">
import type { ServerSession, SessionAction } from '#core'
import { blockers, blockingChains, type BlockingNode } from '~/utils/blocking'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ connectionId: string }>()

const { connections, driverOf } = useConnections()
const { t, locale } = useI18n()
const toast = useToast()

const base = computed(() => `/api/connections/${encodeURIComponent(props.connectionId)}/sessions`)
const actions = computed(() => driverOf(props.connectionId)?.capabilities.sessionActions ?? [])
const connectionName = computed(() => connections.value.find((c) => c.id === props.connectionId)?.name ?? '')

const sessions = ref<ServerSession[]>([])
const error = ref<string>()
const updated = ref<number>()
const interval = ref(0)
const showIdle = ref(false)
const filter = ref('')
const expanded = ref<string>()
const confirming = ref<{ session: ServerSession; action: SessionAction }>()

const intervals = computed(() => [
  { label: t('sessions.off'), value: 0 },
  ...[2, 5, 10, 30].map((n) => ({ label: t('sessions.every', { n }), value: n })),
])

// Refreshes never overlap, and the next one is only scheduled once the last has finished (never while hidden).
let refreshing: Promise<void> | undefined
let timer: ReturnType<typeof setTimeout> | undefined

async function load() {
  try {
    sessions.value = await api<ServerSession[]>(base.value)
    updated.value = Date.now()
    error.value = undefined
  } catch (e) {
    // The last data stays.
    error.value = errorMessage(e)
  }
}

function schedule() {
  clearTimeout(timer)
  if (open.value && interval.value && !document.hidden) timer = setTimeout(refresh, interval.value * 1000)
}

function refresh() {
  refreshing ??= load().finally(() => {
    refreshing = undefined
    schedule()
  })
  return refreshing
}

function onVisibility() {
  if (!document.hidden && open.value && interval.value) refresh()
}
onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  clearTimeout(timer)
})

watch(interval, schedule)
watch(
  open,
  (v) => {
    if (v) return void refresh()
    clearTimeout(timer)
    sessions.value = []
    updated.value = error.value = expanded.value = undefined
    api(base.value, { method: 'DELETE' }).catch(() => {})
  },
  { immediate: true },
)

const blocking = computed(() => blockers(sessions.value))
const blocked = computed(() => new Set(sessions.value.filter((s) => s.blockedBy.length).map((s) => s.id)))
const shown = computed(() => {
  const term = filter.value.trim().toLowerCase()
  return sessions.value.filter(
    (s) =>
      (showIdle.value || s.active || blocking.value.has(s.id)) &&
      [s.user, s.database, s.application, s.query].some((v) => v?.toLowerCase().includes(term)),
  )
})

const chains = computed(() => {
  const lines: { session: ServerSession; depth: number }[] = []
  const walk = (nodes: BlockingNode[], depth: number) => {
    for (const { session, blocked } of nodes) {
      lines.push({ session, depth })
      walk(blocked, depth + 1)
    }
  }
  walk(blockingChains(sessions.value), 0)
  return lines
})

const firstLine = (query: string | null) => query?.split('\n', 1)[0] ?? ''
const duration = (s: ServerSession) => (s.seconds === null ? '' : formatDuration(s.seconds * 1000))
const canCancel = (s: ServerSession) => actions.value.includes('cancel') && s.active && !!s.query

async function stop() {
  const { session, action } = confirming.value!
  confirming.value = undefined
  try {
    await refreshing
    await api(`${base.value}/${encodeURIComponent(session.id)}/stop`, { method: 'POST', body: { action } })
    toast.add({
      title: t(action === 'cancel' ? 'sessions.cancelled' : 'sessions.terminated'),
      color: 'success',
      icon: 'i-lucide-check',
    })
  } catch (e) {
    toast.add({
      title: t('sessions.actionFailed'),
      description: errorMessage(e),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  refresh()
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('sessions.title', { connection: connectionName })"
    :ui="{ content: 'max-w-6xl' }"
  >
    <template #body>
      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="!!refreshing"
            :title="t('sessions.refresh')"
            :aria-label="t('sessions.refresh')"
            @click="refresh"
          />
          <USelect v-model="interval" :items="intervals" :aria-label="t('sessions.autoRefresh')" class="w-32" />
          <USwitch v-model="showIdle" :label="t('sessions.showIdle')" />
          <UInput
            v-model="filter"
            icon="i-lucide-search"
            :placeholder="t('sessions.filter')"
            :aria-label="t('sessions.filter')"
            class="min-w-40 flex-1"
            autocorrect="off"
            autocapitalize="off"
            :spellcheck="false"
          />
          <span v-if="updated" class="text-xs text-muted">
            {{ t('sessions.updated', { time: formatClock(updated) }) }} ·
            {{ t('sessions.count', { n: shown.length.toLocaleString(locale) }, shown.length) }}
          </span>
        </div>
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />

        <section v-if="chains.length" class="space-y-1 rounded border border-default p-2 text-xs">
          <h3 class="font-medium">{{ t('sessions.blocking') }}</h3>
          <div
            v-for="{ session, depth } in chains"
            :key="session.id"
            class="flex items-center gap-2"
            :style="{ paddingLeft: `${depth * 1.25}rem` }"
          >
            <UIcon v-if="depth" name="i-lucide-corner-down-right" class="size-3.5 shrink-0 text-muted" />
            <span class="font-mono">{{ session.id }}</span>
            <span v-if="session.user">{{ session.user }}</span>
            <span class="text-muted">{{ [session.state, duration(session)].filter(Boolean).join(' · ') }}</span>
            <UBadge v-if="!depth" :label="t('sessions.headBlocker')" color="error" variant="subtle" size="sm" />
            <span class="truncate font-mono text-muted">{{ firstLine(session.query) }}</span>
          </div>
        </section>

        <p v-if="!shown.length && updated" class="py-6 text-center text-sm text-muted">{{ t('sessions.none') }}</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="text-muted">
              <tr>
                <th class="p-1.5 font-medium">{{ t('sessions.id') }}</th>
                <th class="p-1.5 font-medium">{{ t('sessions.user') }}</th>
                <th class="p-1.5 font-medium">{{ t('sessions.database') }}</th>
                <th class="p-1.5 font-medium">{{ t('sessions.client') }}</th>
                <th class="p-1.5 font-medium">{{ t('sessions.state') }}</th>
                <th class="p-1.5 font-medium">{{ t('sessions.duration') }}</th>
                <th class="p-1.5 font-medium">{{ t('sessions.wait') }}</th>
                <th class="p-1.5 font-medium">{{ t('sessions.blockedBy') }}</th>
                <th class="p-1.5 font-medium">{{ t('sessions.query') }}</th>
                <th class="p-1.5" />
              </tr>
            </thead>
            <tbody>
              <template v-for="s in shown" :key="s.id">
                <tr
                  class="cursor-pointer border-t border-default align-top hover:bg-elevated"
                  :class="{ 'bg-error/10': blocking.has(s.id) }"
                  @click="expanded = expanded === s.id ? undefined : s.id"
                >
                  <td class="p-1.5 font-mono">{{ s.id }}</td>
                  <td class="p-1.5">{{ s.user }}</td>
                  <td class="p-1.5">{{ s.database }}</td>
                  <td class="p-1.5">{{ [s.client, s.application].filter(Boolean).join(' · ') }}</td>
                  <td class="p-1.5">
                    {{ s.state }}
                    <UBadge
                      v-if="blocked.has(s.id)"
                      :label="t('sessions.blocked')"
                      color="warning"
                      variant="subtle"
                      size="sm"
                    />
                  </td>
                  <td class="p-1.5 whitespace-nowrap">{{ duration(s) }}</td>
                  <td class="p-1.5">{{ s.wait }}</td>
                  <td class="p-1.5 font-mono">{{ s.blockedBy.join(', ') }}</td>
                  <td class="max-w-80 truncate p-1.5 font-mono" :title="s.query ?? undefined">
                    {{ firstLine(s.query) }}
                  </td>
                  <td class="p-1.5 whitespace-nowrap">
                    <UButton
                      v-if="canCancel(s)"
                      icon="i-lucide-square"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :title="t('sessions.cancelQuery')"
                      :aria-label="t('sessions.cancelQuery')"
                      @click.stop="confirming = { session: s, action: 'cancel' }"
                    />
                    <UButton
                      v-if="actions.includes('terminate')"
                      icon="i-lucide-power"
                      size="xs"
                      color="error"
                      variant="ghost"
                      :title="t('sessions.terminate')"
                      :aria-label="t('sessions.terminate')"
                      @click.stop="confirming = { session: s, action: 'terminate' }"
                    />
                  </td>
                </tr>
                <tr v-if="expanded === s.id && s.query">
                  <td colspan="10" class="p-1.5">
                    <pre class="font-mono break-all whitespace-pre-wrap">{{ s.query }}</pre>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </UModal>

  <UModal
    :open="!!confirming"
    :title="t(confirming?.action === 'cancel' ? 'sessions.confirmCancel' : 'sessions.confirmTerminate')"
    :description="
      t(confirming?.action === 'cancel' ? 'sessions.confirmCancelHint' : 'sessions.confirmTerminateHint', {
        id: confirming?.session.id ?? '',
      })
    "
    :close="false"
    @update:open="(v) => !v && (confirming = undefined)"
  >
    <template #body>
      <pre class="font-mono text-xs break-all whitespace-pre-wrap">{{
        [confirming?.session.id, confirming?.session.user, confirming?.session.query].filter(Boolean).join('\n')
      }}</pre>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="confirming = undefined" />
        <UButton
          :label="t(confirming?.action === 'cancel' ? 'sessions.cancelQuery' : 'sessions.terminate')"
          color="error"
          @click="stop"
        />
      </div>
    </template>
  </UModal>
</template>
