<script setup lang="ts">
// Footer of a query tab's result: export format and scope, INSERT target, save, copy and the read-only reason
import type { ExportFormat } from '#core'
import type { EditBlock } from '~/utils/table-edit'
import type { QueryTab } from '~/composables/tabs'

defineProps<{
  tab: QueryTab
  truncated?: boolean
  scopeItems: { label: string; value: string; disabled?: boolean }[]
  copyItems: { label: string; onSelect: () => void }[]
  readOnly?: { block: EditBlock; columns?: string[] }
}>()
const emit = defineEmits<{ download: [] }>()
const format = defineModel<ExportFormat>('format', { required: true })
const scope = defineModel<'shown' | 'full'>('scope', { required: true })
const table = defineModel<string>('table', { required: true })
const batch = defineModel<number>('batch', { required: true })

const { t } = useI18n()

const formatItems = [
  { label: 'CSV', value: 'csv' },
  { label: 'Parquet', value: 'parquet' },
  { label: 'Excel (XLSX)', value: 'xlsx' },
  { label: 'JSON', value: 'json' },
  { label: 'NDJSON', value: 'ndjson' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'SQL INSERT', value: 'insert' },
]
</script>

<template>
  <div class="flex items-center gap-2 border-t border-default px-3 py-1.5 text-xs text-muted" data-tour="export">
    <span>{{ t('query.export') }}</span>
    <USelect v-model="format" :items="formatItems" :aria-label="t('query.exportFormat')" size="xs" class="w-36" />
    <USelect
      v-if="truncated"
      v-model="scope"
      :items="scopeItems"
      :aria-label="t('query.exportScope')"
      size="xs"
      class="w-72"
    />
    <template v-if="format === 'insert'">
      <UInput
        v-model="table"
        :aria-label="t('query.insertTable')"
        :placeholder="t('query.insertTable')"
        size="xs"
        class="w-44"
      />
      <UInputNumber
        v-model="batch"
        :min="1"
        :max="10000"
        :aria-label="t('query.batchSize')"
        :title="t('query.batchSize')"
        size="xs"
        class="w-28"
      />
    </template>
    <UButton
      icon="i-lucide-download"
      size="xs"
      variant="soft"
      :label="t('query.saveAs')"
      :loading="!!tab.exporting"
      :disabled="tab.running"
      @click="emit('download')"
    />
    <UDropdownMenu :items="copyItems">
      <UButton icon="i-lucide-clipboard-copy" size="xs" variant="ghost" color="neutral" :label="t('query.copyAs')" />
    </UDropdownMenu>
    <span
      v-if="readOnly"
      class="ml-auto flex items-center gap-1"
      :title="t(`grid.readOnlyReasons.${readOnly.block}`, { columns: readOnly.columns?.join(', ') ?? '' })"
    >
      <UIcon name="i-lucide-lock" />{{ t('grid.readOnly') }}
    </span>
  </div>
</template>
