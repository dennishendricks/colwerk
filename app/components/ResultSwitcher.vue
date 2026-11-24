<script setup lang="ts">
// Buttons of a query tab's status bar that switch between result sets and pinned results, pin and compare
/* eslint-disable vue/no-mutating-props -- `tab` is the shared reactive object from useTabs(), edited in place on purpose. */
import type { PinnedResult, QueryTab } from '~/composables/tabs'

defineProps<{
  tab: QueryTab
  items: { label: string; value: number }[]
  viewedPin?: PinnedResult
  pinView?: PinnedResult
  canPin: boolean
  canCompare: boolean
}>()
const emit = defineEmits<{ select: [index: number]; pin: []; close: [id: string] }>()

const { t } = useI18n()

// Time and first line of the statement.
function pinLabel(pin: PinnedResult) {
  const { statement } = pin.set
  const sql = statement ? pin.source.sql.slice(statement.from, statement.to) : pin.source.sql
  return `${formatClock(pin.executedAt)} · ${sql.trim().split('\n')[0]}`
}
</script>

<template>
  <span class="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto" data-tour="result-switcher">
    <UButton
      v-for="item in items"
      :key="item.value"
      :label="item.label"
      size="xs"
      color="neutral"
      :variant="item.value === tab.resultIndex && !viewedPin ? 'soft' : 'ghost'"
      :aria-pressed="item.value === tab.resultIndex && !viewedPin"
      @click="emit('select', item.value)"
    />
    <UFieldGroup v-for="pin in tab.pinned" :key="pin.id" size="xs" class="shrink-0">
      <UButton
        icon="i-lucide-pin"
        :label="pinLabel(pin)"
        :title="pinLabel(pin)"
        color="neutral"
        :variant="pin.id === tab.viewPin ? 'soft' : 'ghost'"
        :aria-pressed="pin.id === tab.viewPin"
        class="max-w-52"
        :ui="{ label: 'truncate' }"
        @click="tab.viewPin = pin.id"
      />
      <UButton
        icon="i-lucide-x"
        :title="t('query.closePin')"
        :aria-label="t('query.closePin')"
        color="neutral"
        :variant="pin.id === tab.viewPin ? 'soft' : 'ghost'"
        @click="emit('close', pin.id)"
      />
    </UFieldGroup>
    <UButton
      v-if="canPin"
      icon="i-lucide-pin"
      :label="t('query.pin')"
      size="xs"
      color="neutral"
      variant="outline"
      class="shrink-0"
      @click="emit('pin')"
    />
    <UButton
      v-if="pinView"
      icon="i-lucide-columns-2"
      :label="t('query.compare')"
      size="xs"
      color="neutral"
      :variant="tab.compare ? 'soft' : 'outline'"
      :aria-pressed="!!tab.compare"
      class="shrink-0"
      :disabled="!canCompare"
      @click="tab.compare = !tab.compare"
    />
  </span>
</template>
