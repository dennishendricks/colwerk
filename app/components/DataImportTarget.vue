<script setup lang="ts">
// Step 2 of the data import wizard: preview, target table (existing or new) and column mapping
import type { DataImport } from '~/composables/data-import'

const props = defineProps<{ wizard: DataImport }>()

const { t } = useI18n()
const {
  preview,
  targetConnectionId,
  targetItems,
  targetDatabase,
  targetSchema,
  targetTable,
  newSchema,
  mode,
  isNew,
  schemaItems,
  tableItems,
  target,
  mapping,
  targetColumns,
  newName,
  newColumns,
  createSql,
  problem,
} = props.wizard

const modeItems = computed(() => [
  { label: t('dataImport.existingTable'), value: 'existing' },
  { label: t('dataImport.newTable'), value: 'new' },
])
// Reka's select items cannot have an empty value.
const SKIP = '\0skip'
const columnItems = computed(() => [
  { label: t('dataImport.skip'), value: SKIP },
  ...targetColumns.value.map((c) => ({ label: c.name, value: c.name })),
])
</script>

<template>
  <div>
    <h3 class="mb-1 text-sm font-medium">{{ t('dataImport.preview') }}</h3>
    <div class="h-44 overflow-hidden rounded border border-default">
      <ResultGrid :result="{ columns: preview!.columns, rows: preview!.rows, truncated: false }" />
    </div>
  </div>
  <div class="grid grid-cols-2 gap-2">
    <UFormField :label="t('dataImport.targetConnection')">
      <USelect
        v-model="targetConnectionId"
        :items="targetItems"
        icon="i-lucide-database"
        class="w-full"
        @update:model-value="
          ((targetDatabase = undefined), (targetSchema = undefined), (targetTable = undefined), (newSchema = undefined))
        "
      />
    </UFormField>
    <URadioGroup v-model="mode" orientation="horizontal" :items="modeItems" class="self-end" />
  </div>

  <template v-if="!isNew">
    <div class="grid grid-cols-2 gap-2">
      <USelect
        v-model="targetSchema"
        :items="schemaItems(target)"
        :placeholder="t('dataImport.schema')"
        :aria-label="t('dataImport.schema')"
        @update:model-value="targetTable = undefined"
      />
      <USelect
        v-model="targetTable"
        :items="tableItems(target, targetSchema)"
        :placeholder="t('dataImport.table')"
        :aria-label="t('dataImport.table')"
      />
    </div>
    <table v-if="targetTable" class="w-full text-sm">
      <thead class="text-left text-xs text-muted">
        <tr>
          <th class="py-1">{{ t('dataImport.sourceColumn') }}</th>
          <th>{{ t('dataImport.targetColumn') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(c, i) in preview!.columns" :key="i">
          <td class="py-0.5 pr-2">
            {{ c.name }} <span class="text-xs text-dimmed">{{ c.type }}</span>
          </td>
          <td>
            <USelect
              :model-value="mapping[i] || SKIP"
              :items="columnItems"
              size="sm"
              class="w-full"
              :aria-label="c.name"
              @update:model-value="(v) => (mapping[i] = v === SKIP ? '' : v)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </template>
  <template v-else>
    <div class="grid grid-cols-2 gap-2">
      <UFormField :label="t('dataImport.schema')">
        <USelect v-model="newSchema" :items="schemaItems(target)" class="w-full" />
      </UFormField>
      <UFormField :label="t('dataImport.tableName')">
        <UInput v-model="newName" class="w-full" />
      </UFormField>
    </div>
    <table class="w-full text-sm">
      <thead class="text-left text-xs text-muted">
        <tr>
          <th class="py-1">{{ t('dataImport.include') }}</th>
          <th>{{ t('dataImport.targetColumn') }}</th>
          <th>{{ t('dataImport.type') }}</th>
          <th>{{ t('dataImport.key') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(c, i) in newColumns" :key="i">
          <td class="py-0.5"><UCheckbox v-model="c.include" :aria-label="t('dataImport.include')" /></td>
          <td class="pr-2"><UInput v-model="c.name" size="sm" :aria-label="t('dataImport.targetColumn')" /></td>
          <td class="pr-2">
            <UInput
              v-model="c.type"
              size="sm"
              :aria-label="t('dataImport.type')"
              @update:model-value="c.edited = true"
            />
          </td>
          <td><UCheckbox v-model="c.key" :aria-label="t('dataImport.key')" /></td>
        </tr>
      </tbody>
    </table>
    <div>
      <h3 class="mb-1 text-sm font-medium">{{ t('dataImport.ddl') }}</h3>
      <pre class="overflow-x-auto rounded bg-elevated p-2 font-mono text-xs">{{ createSql }}</pre>
    </div>
  </template>
  <p v-if="problem" class="text-sm text-error">{{ problem }}</p>
</template>
