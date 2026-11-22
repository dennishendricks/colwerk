<script setup lang="ts">
// Popover with the text filter of one grid column, anchored at the column's header button.
import type { GridColumn } from '~/utils/grid-cells'

const filtering = defineModel<{ column: GridColumn; anchor: Element }>()
const { t } = useI18n()
</script>

<template>
  <UPopover
    :open="!!filtering"
    :reference="filtering?.anchor"
    :content="{ align: 'start' }"
    @update:open="(open) => open || (filtering = undefined)"
  >
    <template #content>
      <UInput
        v-if="filtering"
        :model-value="String(filtering.column.getFilterValue() ?? '')"
        :placeholder="t('grid.columnContains')"
        :aria-label="t('grid.columnContains')"
        icon="i-lucide-filter"
        size="xs"
        class="m-2 w-56"
        @update:model-value="(value) => filtering?.column.setFilterValue(value)"
        @keydown.enter="filtering = undefined"
      />
    </template>
  </UPopover>
</template>
