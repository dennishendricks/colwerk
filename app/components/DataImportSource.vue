<script setup lang="ts">
// Step 1 of the data import wizard: a file or a table or query of a connection as source
import type { DataImport } from '~/composables/data-import'

const props = defineProps<{ wizard: DataImport }>()

const { t } = useI18n()
const {
  sourceKind,
  filePath,
  format,
  browse,
  duckdb,
  installing,
  install,
  sourceConnectionId,
  connectionItems,
  sourceSchema,
  sourceTable,
  sourceDatabase,
  connKind,
  schemaItems,
  tableItems,
  sourceTarget,
  sourceQuery,
} = props.wizard
</script>

<template>
  <URadioGroup
    v-model="sourceKind"
    orientation="horizontal"
    :items="[
      { label: t('dataImport.fromFile'), value: 'file' },
      { label: t('dataImport.fromConnection'), value: 'connection' },
    ]"
  />
  <template v-if="sourceKind === 'file'">
    <div class="flex gap-2">
      <UInput
        v-model="filePath"
        :placeholder="t('dataImport.file')"
        :aria-label="t('dataImport.file')"
        class="flex-1"
      />
      <UButton icon="i-lucide-folder-open" color="neutral" variant="subtle" :label="t('dialog.open')" @click="browse" />
    </div>
    <p v-if="filePath.trim() && !format" class="text-sm text-error">{{ t('dataImport.unsupportedFile') }}</p>
    <UBadge v-else-if="format" :label="format" color="neutral" variant="subtle" class="self-start" />
    <UAlert v-if="duckdb && !duckdb.installed" color="info" variant="subtle" :description="t('dataImport.needsDuckdb')">
      <template #actions>
        <UProgress
          v-if="installing"
          :model-value="duckdb.installProgress === undefined ? null : Math.round(duckdb.installProgress * 100)"
          class="w-40 self-center"
        />
        <UButton
          icon="i-lucide-download"
          :label="t('connection.installDriver')"
          :loading="installing"
          @click="install"
        />
      </template>
    </UAlert>
  </template>
  <template v-else>
    <USelect
      v-model="sourceConnectionId"
      :items="connectionItems"
      :placeholder="t('common.selectConnection')"
      :aria-label="t('query.connection')"
      icon="i-lucide-database"
      class="w-full"
      @update:model-value="((sourceSchema = undefined), (sourceTable = undefined), (sourceDatabase = undefined))"
    />
    <URadioGroup
      v-model="connKind"
      orientation="horizontal"
      :items="[
        { label: t('dataImport.table'), value: 'table' },
        { label: t('dataImport.query'), value: 'query' },
      ]"
    />
    <div v-if="connKind === 'table'" class="grid grid-cols-2 gap-2">
      <USelect
        v-model="sourceSchema"
        :items="schemaItems(sourceTarget)"
        :placeholder="t('dataImport.schema')"
        :aria-label="t('dataImport.schema')"
        @update:model-value="sourceTable = undefined"
      />
      <USelect
        v-model="sourceTable"
        :items="tableItems(sourceTarget, sourceSchema)"
        :placeholder="t('dataImport.table')"
        :aria-label="t('dataImport.table')"
      />
    </div>
    <UFormField v-else :help="t('dataImport.queryHint')">
      <UTextarea
        v-model="sourceQuery"
        :rows="6"
        :aria-label="t('dataImport.query')"
        class="w-full"
        :ui="{ base: 'font-mono text-xs' }"
      />
    </UFormField>
  </template>
</template>
