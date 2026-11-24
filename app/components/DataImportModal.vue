<script setup lang="ts">
// Wizard: source → target and mapping → load. State and actions live in useDataImport (composables/data-import.ts),
// one instance per modal, passed to the step components.

const { t } = useI18n()
const wizard = useDataImport()
const {
  open,
  step,
  error,
  busy,
  preview,
  summary,
  running,
  sourceReady,
  targetReady,
  canStart,
  confirming,
  confirmSql,
  qualified,
  targetConnectionId,
  connectionName,
  toTarget,
  start,
  load,
  cancel,
  queryTarget,
  close,
} = wizard

const stepItems = computed(() => [
  { title: t('dataImport.stepSource') },
  { title: t('dataImport.stepTarget') },
  { title: t('dataImport.stepLoad') },
])
</script>

<template>
  <UModal
    :open="open"
    :title="t('dataImport.title')"
    :ui="{ content: 'max-w-4xl' }"
    :dismissible="!running"
    :close="!running"
    @update:open="(v) => !v && close()"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <UStepper v-model="step" :items="stepItems" disabled class="w-full" data-tour="import-steps" />

        <DataImportSource v-if="step === 0" :wizard="wizard" />
        <DataImportTarget v-else-if="step === 1 && preview" :wizard="wizard" />
        <DataImportLoad v-else-if="step === 2" :wizard="wizard" />

        <UAlert v-if="error" color="error" variant="subtle" :description="error" />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-between gap-2">
        <UButton
          v-if="step > 0 && !summary"
          :label="t('dataImport.back')"
          color="neutral"
          variant="ghost"
          :disabled="running"
          @click="step--"
        />
        <span v-else />
        <div class="flex gap-2">
          <template v-if="summary">
            <UButton
              :label="t('dataImport.queryTarget')"
              color="neutral"
              variant="subtle"
              :disabled="!!summary.error && !summary.inserted && !summary.updated"
              @click="queryTarget"
            />
            <UButton :label="t('common.close')" @click="close" />
          </template>
          <UButton v-else-if="running" :label="t('common.cancel')" color="neutral" variant="subtle" @click="cancel" />
          <UButton
            v-else-if="step === 0"
            :label="t('dataImport.next')"
            :disabled="!sourceReady"
            :loading="busy"
            @click="toTarget"
          />
          <UButton v-else-if="step === 1" :label="t('dataImport.next')" :disabled="!targetReady" @click="step = 2" />
          <UButton v-else :label="t('dataImport.start')" :disabled="!canStart" @click="start" />
        </div>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="confirming" :title="t('dataImport.confirmTitle')">
    <template #body>
      <p class="text-sm">
        {{ t('dataImport.confirmDescription', { table: qualified, connection: connectionName(targetConnectionId) }) }}
      </p>
      <pre v-if="confirmSql" class="mt-2 overflow-x-auto rounded bg-elevated p-2 font-mono text-xs">{{
        confirmSql
      }}</pre>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="confirming = false" />
        <UButton :label="t('dataImport.start')" @click="load" />
      </div>
    </template>
  </UModal>
</template>
