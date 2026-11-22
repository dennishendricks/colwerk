<script setup lang="ts">
// Modal with the full value of one grid cell and a button to copy it.
import type { CellValue, ResultColumn } from '#core'

defineProps<{ detail?: { column: ResultColumn; value: CellValue } }>()
const emit = defineEmits<{ copy: [value: CellValue] }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
</script>

<template>
  <UModal
    v-model:open="open"
    :title="detail?.column.name"
    :description="detail?.column.type"
    :ui="{ content: 'max-w-3xl' }"
  >
    <template #body>
      <span v-if="detail?.value === null" class="font-mono text-xs italic text-dimmed">NULL</span>
      <pre v-else-if="detail" class="font-mono text-xs whitespace-pre-wrap wrap-anywhere">{{
        detailText(detail.value)
      }}</pre>
    </template>
    <template #footer>
      <UButton
        :label="t('common.copy')"
        icon="i-lucide-copy"
        color="neutral"
        variant="outline"
        @click="emit('copy', detail!.value)"
      />
    </template>
  </UModal>
</template>
