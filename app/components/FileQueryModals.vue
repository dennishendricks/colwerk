<script setup lang="ts">
import { fileFormat, isRemote } from '~~/core/file-formats.ts'
import { duckdbPrompt, urlPromptOpen, useDataFiles } from '~/composables/data-files'

const { drivers, installDriver } = useConnections()
const { queryUrl } = useDataFiles()
const toast = useToast()
const { t } = useI18n()

const installing = ref(false)
const driver = computed(() => drivers.value.find((d) => d.dialect === 'files'))

function cancelDownload() {
  duckdbPrompt.value?.done(false)
  duckdbPrompt.value = undefined
}

async function download() {
  const prompt = duckdbPrompt.value
  installing.value = true
  try {
    await installDriver('files')
    prompt?.done(true)
  } catch (e) {
    toast.add({ title: t('common.error'), description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
    prompt?.done(false)
  } finally {
    installing.value = false
    duckdbPrompt.value = undefined
  }
}

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
  <UModal
    :open="!!duckdbPrompt"
    :title="t('files.driverTitle')"
    :description="t('files.driverDescription')"
    :close="false"
    @update:open="(v) => !v && !installing && cancelDownload()"
  >
    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <UProgress
          v-if="installing"
          :model-value="driver?.installProgress === undefined ? null : Math.round(driver.installProgress * 100)"
          class="w-40"
        />
        <UButton
          :label="t('common.cancel')"
          color="neutral"
          variant="ghost"
          :disabled="installing"
          @click="cancelDownload"
        />
        <UButton icon="i-lucide-download" :label="t('files.download')" :loading="installing" @click="download" />
      </div>
    </template>
  </UModal>

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
