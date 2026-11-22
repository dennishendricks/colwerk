<script setup lang="ts">
// MCP login of the connection dialog: the database login the MCP tools use instead of the connection's own
import type { ConnectionInput } from '#core'

defineProps<{ stored: boolean }>()
const form = defineModel<Partial<ConnectionInput>>('form', { required: true })
const clearPassword = defineModel<boolean>('clear', { default: false })
const { t } = useI18n()
</script>

<template>
  <UFormField class="col-span-2" :help="t('connection.mcpLoginHelp')">
    <USwitch v-model="form.mcpLogin" :label="t('connection.mcpLogin')" />
  </UFormField>
  <template v-if="form.mcpLogin">
    <UFormField v-if="form.auth !== 'token'" :label="t('connection.mcpUser')">
      <UInput
        v-model="form.mcpUser"
        class="w-full"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        :spellcheck="false"
      />
    </UFormField>
    <StoredPasswordField
      v-model:value="form.mcpPassword"
      v-model:clear="clearPassword"
      :label="form.auth === 'token' ? t('connection.mcpToken') : t('connection.mcpPassword')"
      :wide="form.auth === 'token'"
      :stored="stored"
      :clear-label="t('connection.clearMcpPassword')"
    />
  </template>
</template>
