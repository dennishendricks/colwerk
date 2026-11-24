<script setup lang="ts">
// Confirmations before a query tab runs its SQL: writes without WHERE, writes in general, and full scans in the plan
import type { PlanWarning } from '~/utils/pre-execution'
import type { PendingRun } from '~/composables/query-run'

defineProps<{
  connection?: string
  running: boolean
  dryRun?: { rows?: number | null; error?: string }
  canDryRun: boolean
  dryRunTitle: (n: number | null) => string
}>()
const emit = defineEmits<{ confirmUnfiltered: []; confirmRun: []; dryRun: []; runWarned: []; showPlan: [] }>()
const unfiltered = defineModel<PendingRun & { statements: string[] }>('unfiltered')
const pending = defineModel<PendingRun>('pending')
const planWarning = defineModel<PendingRun & { warnings: PlanWarning[] }>('planWarning')

const { t, locale } = useI18n()
</script>

<template>
  <UModal
    :open="unfiltered !== undefined"
    :title="t('query.unfilteredTitle')"
    :description="t('query.unfilteredDescription', { connection })"
    :close="false"
    @update:open="(v) => !v && (unfiltered = undefined)"
  >
    <template #body>
      <pre class="max-h-64 overflow-auto rounded bg-elevated p-3 font-mono text-xs">{{
        unfiltered?.statements.join(';\n\n')
      }}</pre>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="unfiltered = undefined" />
        <UButton :label="t('query.unfilteredRun')" color="error" @click="emit('confirmUnfiltered')" />
      </div>
    </template>
  </UModal>

  <UModal
    :open="pending !== undefined"
    :title="t('query.confirmWriteTitle')"
    :description="t('query.confirmWriteDescription', { connection })"
    :close="false"
    @update:open="(v) => !v && (pending = undefined)"
  >
    <template #body>
      <pre class="max-h-64 overflow-auto rounded bg-elevated p-3 font-mono text-xs">{{ pending?.sql }}</pre>
      <p v-if="dryRun" class="mt-2 text-sm" :class="dryRun.error ? 'text-error' : ''">
        <template v-if="dryRun.error">{{ dryRun.error }}</template>
        <template v-else>
          {{ dryRunTitle(dryRun.rows ?? null) }}
          <span class="text-muted">{{ t('query.dryRunHint') }}</span>
        </template>
      </p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="pending = undefined" />
        <UButton
          v-if="canDryRun"
          data-tour="dry-run"
          :label="t('query.dryRun')"
          icon="i-lucide-flask-conical"
          color="neutral"
          variant="outline"
          :loading="running"
          @click="emit('dryRun')"
        />
        <UButton :label="t('common.run')" color="error" :disabled="running" @click="emit('confirmRun')" />
      </div>
    </template>
  </UModal>

  <UModal
    :open="planWarning !== undefined"
    :title="t('query.planWarningTitle')"
    :description="t('query.planWarningDescription', { connection })"
    :close="false"
    @update:open="(v) => !v && (planWarning = undefined)"
  >
    <template #body>
      <ul class="text-sm">
        <li v-for="w in planWarning?.warnings" :key="w.table">
          {{ t('query.planWarningScan', { table: w.table, rows: w.rows.toLocaleString(locale) }) }}
        </li>
      </ul>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="planWarning = undefined" />
        <UButton :label="t('query.showPlan')" color="neutral" variant="outline" @click="emit('showPlan')" />
        <UButton :label="t('query.planWarningRun')" color="warning" @click="emit('runWarned')" />
      </div>
    </template>
  </UModal>
</template>
