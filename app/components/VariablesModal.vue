<script setup lang="ts">
// Dialog for the values of a query's `${name}` variables, open while `variablePrompt` belongs to the tab
defineProps<{ tabId: string }>()

const { t } = useI18n()

function confirmVariables() {
  variablePrompt.value?.done({ ...variablePrompt.value.values })
  variablePrompt.value = undefined
}

function cancelVariables() {
  variablePrompt.value?.done()
  variablePrompt.value = undefined
}
</script>

<template>
  <UModal
    :open="variablePrompt?.tabId === tabId"
    :title="t('query.variablesTitle')"
    :description="t('query.variablesHint')"
    :close="false"
    @update:open="(v) => !v && cancelVariables()"
  >
    <template #body>
      <form id="query-variables" class="flex flex-col gap-3" @submit.prevent="confirmVariables">
        <UFormField v-for="(_, name) in variablePrompt?.values" :key="name" :label="name">
          <UInput v-model="variablePrompt!.values[name]" autofocus class="w-full" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="cancelVariables" />
        <UButton :label="t('common.run')" type="submit" form="query-variables" />
      </div>
    </template>
  </UModal>
</template>
