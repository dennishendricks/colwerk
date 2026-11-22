<script setup lang="ts">
// SSH tunnel settings of the connection dialog, for the dialects that can connect through one
import type { ConnectionInput } from '#core'

defineProps<{ stored: boolean }>()
const form = defineModel<Partial<ConnectionInput>>('form', { required: true })
const clearSecret = defineModel<boolean>('clear', { default: false })
const { t } = useI18n()

const sshSupported = computed(() => ['postgres', 'mysql', 'mssql', 'clickhouse'].includes(form.value.dialect ?? ''))
const sshAuthItems = (['password', 'key', 'agent'] as const).map((a) => ({
  label: t(`connection.sshAuths.${a}`),
  value: a,
}))
// A host key belongs to one SSH server.
const forgetHostKey = () => (form.value.sshHostKey = undefined)
</script>

<template>
  <template v-if="sshSupported">
    <UFormField class="col-span-2" :help="t('connection.sshTunnelHelp')">
      <USwitch v-model="form.ssh" :label="t('connection.sshTunnel')" />
    </UFormField>
    <template v-if="form.ssh">
      <UFormField :label="t('connection.sshHost')" required>
        <UInput
          v-model="form.sshHost"
          class="w-full"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
          @update:model-value="forgetHostKey"
        />
      </UFormField>
      <UFormField :label="t('connection.sshPort')">
        <UInput
          v-model.number="form.sshPort"
          type="number"
          placeholder="22"
          class="w-full"
          @update:model-value="forgetHostKey"
        />
      </UFormField>
      <UFormField :label="t('connection.sshUser')" required>
        <UInput
          v-model="form.sshUser"
          class="w-full"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
        />
      </UFormField>
      <UFormField :label="t('connection.sshAuth')">
        <USelect v-model="form.sshAuth" :items="sshAuthItems" class="w-full" />
      </UFormField>
      <UFormField v-if="form.sshAuth === 'key'" :label="t('connection.sshKeyFile')" required class="col-span-2">
        <UInput
          v-model="form.sshKeyFile"
          class="w-full"
          placeholder="~/.ssh/id_ed25519"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
        />
      </UFormField>
      <SecretInput
        v-if="form.sshAuth !== 'agent'"
        v-model:value="form.sshSecret"
        v-model:reference="form.sshSecretRef"
        v-model:clear="clearSecret"
        :label="form.sshAuth === 'key' ? t('connection.sshPassphrase') : t('connection.password')"
        :stored="stored"
        :clear-label="t('connection.clearSshSecret')"
      />
      <p v-if="form.sshAuth === 'agent'" class="col-span-2 text-sm text-(--ui-text-muted)">
        {{ t('connection.sshAgentHelp') }}
      </p>
      <UFormField
        v-if="form.sshHostKey"
        :label="t('connection.sshHostKey')"
        :help="t('connection.sshHostKeyHelp')"
        class="col-span-2"
      >
        <div class="flex items-center gap-2">
          <code class="min-w-0 flex-1 break-all text-xs">{{ form.sshHostKey }}</code>
          <UButton
            color="neutral"
            variant="outline"
            size="xs"
            :label="t('connection.forgetHostKey')"
            @click="forgetHostKey"
          />
        </div>
      </UFormField>
    </template>
  </template>
</template>
