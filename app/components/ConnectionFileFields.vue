<script setup lang="ts">
// Source of the connection dialog for dialects without a server: file sources, a Delta folder or a database file
import type { ConnectionInput } from '#core'

defineProps<{
  authItems: { label: string; value: string }[]
  showPassword: boolean
  passwordLabel: string
  storedPassword: boolean
}>()
const form = defineModel<Partial<ConnectionInput>>('form', { required: true })
const sources = defineModel<string>('sources', { default: '' })
const clearPassword = defineModel<boolean>('clearPassword', { default: false })
const toast = useToast()
const { t } = useI18n()

// Native dialog: the page itself cannot learn the path of a picked file.
const picking = ref(false)
async function pickFile() {
  picking.value = true
  try {
    const delta = form.value.dialect === 'delta'
    const path = await fileDialog(delta ? 'folder' : 'open', t(delta ? 'dialog.openFolder' : 'dialog.open'))
    if (path) form.value.file = path
  } catch (e) {
    toast.add({
      title: t('common.error'),
      description: errorMessage(e),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    picking.value = false
  }
}
</script>

<template>
  <template v-if="form.dialect === 'files'">
    <UFormField :label="t('connection.sources')" :help="t('connection.sourcesHelp')" class="col-span-2">
      <UTextarea
        v-model="sources"
        :rows="4"
        class="w-full font-mono"
        autocorrect="off"
        autocapitalize="off"
        :spellcheck="false"
      />
    </UFormField>
    <UFormField :label="t('connection.auth')" class="col-span-2">
      <USelect v-model="form.auth" :items="authItems" class="w-full" />
    </UFormField>
    <UFormField
      v-if="form.auth === 's3' || form.auth === 'gcs'"
      :label="t(form.auth === 's3' ? 'connection.accessKeyId' : 'connection.hmacKeyId')"
    >
      <UInput
        v-model="form.user"
        class="w-full"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        :spellcheck="false"
      />
    </UFormField>
    <StoredPasswordField
      v-if="showPassword"
      v-model:value="form.password"
      v-model:clear="clearPassword"
      :label="passwordLabel"
      :help="form.auth === 'token' ? t('connection.bearerTokenHelp') : undefined"
      :wide="form.auth === 'token'"
      :stored="storedPassword"
      :clear-label="t('connection.clearPassword')"
    />
    <template v-if="form.auth === 's3'">
      <UFormField :label="t('connection.region')">
        <UInput
          v-model="form.region"
          class="w-full"
          placeholder="us-east-1"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
        />
      </UFormField>
      <UFormField :label="t('connection.endpoint')" :help="t('connection.endpointHelp')">
        <UInput v-model="form.host" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" />
      </UFormField>
    </template>
  </template>
  <UFormField
    v-else-if="form.dialect === 'delta'"
    :label="t('connection.deltaFolder')"
    :help="t('connection.deltaFolderHelp')"
    required
    class="col-span-2"
  >
    <div class="flex gap-2">
      <UInput v-model="form.file" class="flex-1" autocorrect="off" autocapitalize="off" :spellcheck="false" />
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-folder-open"
        :label="t('connection.browse')"
        :loading="picking"
        @click="pickFile"
      />
    </div>
  </UFormField>
  <UFormField v-else :label="t('connection.file')" class="col-span-2" :help="t('connection.fileHelp')">
    <div class="flex gap-2">
      <UInput
        v-model="form.file"
        class="flex-1"
        placeholder=":memory:"
        autocorrect="off"
        autocapitalize="off"
        :spellcheck="false"
      />
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-folder-open"
        :label="t('connection.browse')"
        :loading="picking"
        @click="pickFile"
      />
    </div>
  </UFormField>
  <UFormField
    v-if="form.dialect === 'duckdb' && form.file && form.file !== ':memory:'"
    class="col-span-2"
    :help="t('connection.v1StorageHelp')"
  >
    <USwitch v-model="form.v1Storage" :label="t('connection.v1Storage')" />
  </UFormField>
  <UFormField v-if="form.dialect === 'duckdb'" class="col-span-2" :help="t('connection.mcpExternalAccessHelp')">
    <USwitch v-model="form.mcpExternalAccess" color="warning" :label="t('connection.mcpExternalAccess')" />
  </UFormField>
</template>
