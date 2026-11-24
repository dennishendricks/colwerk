<script setup lang="ts">
import { fileFormat, isRemote } from '~~/core/file-formats.ts'
import { urlPromptOpen, useDataFiles } from '~/composables/data-files'

const { queryUrl } = useDataFiles()
const { t } = useI18n()

const url = ref('')
const urlValid = computed(() => isRemote(url.value.trim()) && !!fileFormat(url.value.trim()))

function submitUrl() {
  if (!urlValid.value) return
  urlPromptOpen.value = false
  queryUrl(url.value)
  url.value = ''
}
</script>

<template>
  <UModal v-model:open="urlPromptOpen" :title="t('files.urlTitle')" :description="t('files.urlDescription')">
    <template #body>
      <form id="query-url" class="flex flex-col gap-3" @submit.prevent="submitUrl">
        <UFormField :label="t('files.urlLabel')" :error="url.trim() && !urlValid ? t('files.urlInvalid') : undefined">
          <UInput
            v-model="url"
            placeholder="s3://bucket/data.parquet"
            autofocus
            class="w-full"
            autocorrect="off"
            autocapitalize="off"
            :spellcheck="false"
          />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="urlPromptOpen = false" />
        <UButton :label="t('files.query')" type="submit" form="query-url" :disabled="!urlValid" />
      </div>
    </template>
  </UModal>
</template>
