<script setup lang="ts">
import type { DiffStatus, ObjectDiff, SchemaCompareResult } from '#core'
import type { CompareSideValue } from './CompareSide.vue'

const emit = defineEmits<{ close: [] }>()

const { connections } = useConnections()
const { t } = useI18n()

const source = ref<CompareSideValue>({})
const target = ref<CompareSideValue>({})
const busy = ref(false)
const error = ref<string>()
const result = ref<SchemaCompareResult>()
const filter = ref<'differences' | DiffStatus | 'all'>('differences')
const expanded = reactive(new Set<string>())

const dialectOf = (side: CompareSideValue) => connections.value.find((c) => c.id === side.connectionId)?.dialect
const supported = computed(
  () => !source.value.connectionId || (schemaCompareDialects as readonly string[]).includes(dialectOf(source.value)!),
)
const ready = computed(
  () =>
    supported.value &&
    !!(source.value.connectionId && source.value.schema && target.value.connectionId && target.value.schema),
)

// Both sides must be of the same engine.
watch(
  () => dialectOf(source.value),
  (dialect) => {
    if (dialectOf(target.value) !== dialect) target.value = {}
  },
)

const refOf = ({ connectionId, database, schema }: CompareSideValue) => ({ connectionId, database, schema })

async function run() {
  busy.value = true
  error.value = undefined
  result.value = undefined
  expanded.clear()
  try {
    result.value = await api<SchemaCompareResult>('/api/compare/schema', {
      method: 'POST',
      body: { source: refOf(source.value), target: refOf(target.value) },
    })
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

const statuses = ['added', 'removed', 'changed', 'same'] as const
const counts = computed(() =>
  Object.fromEntries(statuses.map((s) => [s, result.value?.objects.filter((o) => o.status === s).length ?? 0])),
)
const filters = computed(() => [
  { value: 'differences', label: t('compare.differences'), n: result.value!.objects.length - counts.value.same! },
  ...statuses.map((s) => ({ value: s, label: t(`compare.${s}`), n: counts.value[s]! })),
  { value: 'all', label: t('compare.all'), n: result.value!.objects.length },
])
const shown = computed(
  () =>
    result.value?.objects.filter((o) =>
      filter.value === 'all' ? true : filter.value === 'differences' ? o.status !== 'same' : o.status === filter.value,
    ) ?? [],
)

const badgeColor = { added: 'success', removed: 'error', changed: 'warning', same: 'neutral' } as const
const keyOf = (o: ObjectDiff) => `${o.kind}:${o.name}`
const toggle = (o: ObjectDiff) => !expanded.delete(keyOf(o)) && expanded.add(keyOf(o))

/** The lines of one side; lines the other side does not have are marked. */
function lines(o: ObjectDiff, side: 'source' | 'target') {
  const other = new Set((o[side === 'source' ? 'target' : 'source'] ?? '').split('\n').map((l) => l.trim()))
  return (o[side] ?? '').split('\n').map((text) => ({ text, missing: !other.has(text.trim()) }))
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid gap-4 sm:grid-cols-2">
      <CompareSide v-model="source" :label="t('compare.source')" />
      <CompareSide v-model="target" :label="t('compare.target')" :dialect="dialectOf(source)" />
    </div>
    <UAlert
      v-if="!supported"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :description="t('compare.schemaUnsupported')"
    />
    <UButton
      icon="i-lucide-git-compare"
      :label="busy ? t('compare.running') : t('compare.run')"
      :loading="busy"
      :disabled="!ready"
      @click="run"
    />
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />

    <template v-if="result">
      <div class="flex flex-wrap gap-1">
        <UButton
          v-for="f in filters"
          :key="f.value"
          size="xs"
          color="neutral"
          :variant="filter === f.value ? 'solid' : 'outline'"
          :label="`${f.label} (${f.n})`"
          :aria-pressed="filter === f.value"
          @click="filter = f.value as typeof filter"
        />
      </div>
      <p v-if="!shown.length" class="py-4 text-center text-sm text-muted">{{ t('compare.noDifferences') }}</p>
      <ul class="space-y-1">
        <li v-for="o in shown" :key="keyOf(o)" class="rounded border border-default">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-elevated/60"
            :aria-expanded="expanded.has(keyOf(o))"
            @click="toggle(o)"
          >
            <UIcon
              :name="expanded.has(keyOf(o)) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-4 shrink-0 text-muted"
            />
            <span class="text-xs text-muted">{{ t(`compare.kind.${o.kind}`) }}</span>
            <span class="truncate font-medium">{{ o.name }}</span>
            <UBadge
              :label="t(`compare.${o.status}`)"
              :color="badgeColor[o.status]"
              variant="subtle"
              size="sm"
              class="ml-auto"
            />
          </button>
          <div v-if="expanded.has(keyOf(o))" class="space-y-2 border-t border-default p-2">
            <ul v-if="o.parts.length" class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <li v-for="p in o.parts" :key="`${p.part}:${p.name}`" class="flex items-center gap-1">
                <UBadge :label="t(`compare.${p.status}`)" :color="badgeColor[p.status]" variant="subtle" size="sm" />
                <span class="text-muted">{{ t(`compare.part.${p.part}`) }}</span>
                <span class="font-mono">{{ p.name }}</span>
              </li>
            </ul>
            <div class="grid gap-2 lg:grid-cols-2">
              <div v-for="side in ['source', 'target'] as const" :key="side" class="min-w-0">
                <h4 class="mb-1 text-xs text-muted">{{ t(`compare.${side}`) }}</h4>
                <div class="overflow-auto rounded border border-default font-mono text-xs">
                  <div
                    v-for="(line, i) in lines(o, side)"
                    :key="i"
                    class="min-h-4 px-2 whitespace-pre"
                    :class="line.missing && (side === 'source' ? 'bg-success/10' : 'bg-error/10')"
                  >
                    {{ line.text }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </li>
      </ul>
      <UAlert
        v-if="result.skipped.length"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        :description="t('compare.skipped', { names: result.skipped.join(', ') })"
      />
      <CompareScript
        v-if="result.objects.some((o) => o.status !== 'same')"
        :label="t('compare.script')"
        :script="result.script"
        :target="target"
        :title="t('compare.deployTitle', { schema: target.schema })"
        @opened="emit('close')"
      />
    </template>
  </div>
</template>
