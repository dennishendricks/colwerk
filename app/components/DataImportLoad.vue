<script setup lang="ts">
// Step 3 of the data import wizard: load options, then the progress and the summary of the import
import type { DataImport } from '~/composables/data-import'

const props = defineProps<{ wizard: DataImport }>()

const { t } = useI18n()
const {
  running,
  summary,
  strategy,
  allowed,
  isNew,
  mapped,
  keys,
  toggleKey,
  targetDialect,
  onError,
  batchSize,
  maxBatch,
  progress,
  alertColor,
} = props.wizard

const strategyItems = computed(() =>
  (['append', 'truncate', 'upsert'] as const).map((value) => ({
    value,
    label: t(`dataImport.${value}`),
    description: allowed.value.includes(value)
      ? t(`dataImport.${value}Hint`)
      : t(isNew.value ? 'dataImport.newTableAppendOnly' : 'dataImport.upsertUnavailable'),
    disabled: !allowed.value.includes(value),
  })),
)
</script>

<template>
  <template v-if="!running && !summary">
    <URadioGroup v-model="strategy" :items="strategyItems" />
    <UFormField v-if="strategy === 'upsert'" :label="t('dataImport.keys')">
      <div class="flex flex-wrap gap-x-4 gap-y-1">
        <UCheckbox
          v-for="c in mapped"
          :key="c.name"
          :model-value="keys.includes(c.name)"
          :label="c.name"
          @update:model-value="toggleKey(c.name)"
        />
      </div>
      <p v-if="targetDialect === 'mysql'" class="mt-1 text-xs text-muted">
        {{ t('dataImport.upsertMysqlHint') }}
      </p>
    </UFormField>
    <UFormField :label="t('dataImport.onError')">
      <URadioGroup
        v-model="onError"
        :items="[
          { label: t('dataImport.onErrorStop'), value: 'stop' },
          { label: t('dataImport.onErrorSkip'), value: 'skip' },
        ]"
      />
    </UFormField>
    <UFormField :label="t('dataImport.batchSize')">
      <UInputNumber v-model="batchSize" :min="1" :max="maxBatch" :step="100" :step-snapping="false" class="w-40" />
    </UFormField>
    <p v-if="targetDialect === 'clickhouse'" class="text-sm text-muted">{{ t('dataImport.clickhouseNote') }}</p>
  </template>
  <template v-if="running">
    <UProgress />
    <p v-if="progress" class="text-sm tabular-nums">{{ t('dataImport.progress', { ...progress }) }}</p>
  </template>
  <UAlert
    v-if="summary"
    :color="alertColor"
    variant="subtle"
    :title="t('dataImport.summary', { ...summary, duration: formatDuration(summary.durationMs) })"
  >
    <template v-if="summary.cancelled || summary.error || summary.errors.length" #description>
      <p v-if="summary.cancelled">{{ t('dataImport.cancelled') }}</p>
      <p v-if="summary.error">{{ summary.error }}</p>
      <ul v-if="summary.errors.length" class="list-disc pl-5">
        <li v-for="(e, i) in summary.errors" :key="i">{{ e }}</li>
      </ul>
    </template>
  </UAlert>
</template>
