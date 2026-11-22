<script setup lang="ts">
// Engine options under "More options" in the connection dialog: login details, socket, SQL Server settings, SSH tunnel, TLS and MCP login
import type { ConnectionInput, ConnectionSummary, DateFormat } from '#core'

defineProps<{ connection?: ConnectionSummary; mcpLoginAvailable: boolean }>()
const form = defineModel<Partial<ConnectionInput>>('form', { required: true })
const clearSshSecret = defineModel<boolean>('clearSshSecret', { default: false })
const clearMcpPassword = defineModel<boolean>('clearMcpPassword', { default: false })
const { t } = useI18n()

// `default` stands for no SET DATEFORMAT (the session language decides); select items cannot have an empty value.
const dateFormatItems = computed(() => [
  { label: t('connection.dateFormatDefault'), value: 'default' },
  ...(['dmy', 'mdy', 'ymd', 'ydm', 'myd', 'dym'] satisfies DateFormat[]).map((f) => ({ label: f, value: f })),
])
const dateFormat = computed({
  get: () => form.value.dateFormat ?? 'default',
  set: (v: string) => (form.value.dateFormat = v === 'default' ? undefined : (v as DateFormat)),
})
</script>

<template>
  <div class="col-span-2 grid grid-cols-2 gap-3">
    <template v-if="form.auth === 'oauth-client'">
      <UFormField :label="t('connection.oauthServerUri')" :help="t('connection.oauthServerUriHelp')" class="col-span-2">
        <UInput
          v-model="form.oauthServerUri"
          class="w-full"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
        />
      </UFormField>
      <UFormField :label="t('connection.oauthScope')" :help="t('connection.oauthScopeHelp')" class="col-span-2">
        <UInput v-model="form.oauthScope" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" />
      </UFormField>
    </template>
    <UFormField
      v-if="form.dialect === 'unity'"
      :label="t('connection.region')"
      :help="t('connection.regionHelp')"
      class="col-span-2"
    >
      <UInput
        v-model="form.region"
        class="w-full"
        placeholder="eu-central-1"
        autocorrect="off"
        autocapitalize="off"
        :spellcheck="false"
      />
    </UFormField>
    <template v-if="form.auth === 'entra-interactive' || form.auth === 'entra-default'">
      <UFormField :label="t('connection.tenantId')" :help="t('connection.tenantIdHelp')">
        <UInput
          v-model="form.tenantId"
          class="w-full"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
        />
      </UFormField>
      <UFormField
        v-if="form.auth === 'entra-interactive'"
        :label="t('connection.clientId')"
        :help="t('connection.clientIdHelp')"
      >
        <UInput
          v-model="form.clientId"
          class="w-full"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
        />
      </UFormField>
    </template>
    <UFormField
      v-if="(form.dialect === 'postgres' || form.dialect === 'mysql') && !form.ssh"
      :label="t('connection.socket')"
      :help="t(`connection.socketHelp.${form.dialect}`)"
      class="col-span-2"
    >
      <UInput v-model="form.socket" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" />
    </UFormField>
    <UFormField
      v-if="form.dialect === 'postgres'"
      :label="t('connection.searchPath')"
      :help="t('connection.searchPathHelp')"
      class="col-span-2"
    >
      <UInput
        v-model="form.searchPath"
        class="w-full"
        placeholder='"$user", public'
        autocorrect="off"
        autocapitalize="off"
        :spellcheck="false"
      />
    </UFormField>
    <template v-if="form.dialect === 'mssql'">
      <UFormField v-if="!form.ssh" :label="t('connection.instanceName')" :help="t('connection.instanceNameHelp')">
        <UInput
          v-model="form.instanceName"
          class="w-full"
          placeholder="SQLEXPRESS"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
        />
      </UFormField>
      <UFormField :label="t('connection.connectRetries')" :help="t('connection.connectRetriesHelp')">
        <UInput v-model.number="form.connectRetries" type="number" min="0" placeholder="3" class="w-full" />
      </UFormField>
      <UFormField :label="t('connection.language')" :help="t('connection.languageHelp')">
        <UInput
          v-model="form.language"
          class="w-full"
          placeholder="us_english"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
        />
      </UFormField>
      <UFormField :label="t('connection.dateFormat')" :help="t('connection.dateFormatHelp')">
        <USelect v-model="dateFormat" :items="dateFormatItems" class="w-full" />
      </UFormField>
      <UFormField class="col-span-2" :help="t('connection.readOnlyIntentHelp')">
        <USwitch v-model="form.readOnlyIntent" :label="t('connection.readOnlyIntent')" />
      </UFormField>
      <UFormField class="col-span-2" :help="t('connection.multiSubnetFailoverHelp')">
        <USwitch v-model="form.multiSubnetFailover" :label="t('connection.multiSubnetFailover')" />
      </UFormField>
    </template>
    <ConnectionSshFields v-model:form="form" v-model:clear="clearSshSecret" :stored="!!connection?.hasSshSecret" />
    <template v-if="form.ssl">
      <UFormField :label="t('connection.caCert')" :help="t('connection.caCertHelp')" class="col-span-2">
        <UInput
          v-model="form.sslCa"
          class="w-full"
          :placeholder="t('connection.caCertPlaceholder')"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
          :disabled="form.sslInsecure"
        />
      </UFormField>
      <template v-if="form.dialect === 'mssql'">
        <UFormField :label="t('connection.sslServerName')" :help="t('connection.sslServerNameHelp')" class="col-span-2">
          <UInput
            v-model="form.sslServerName"
            class="w-full"
            autocorrect="off"
            autocapitalize="off"
            :spellcheck="false"
          />
        </UFormField>
        <UFormField class="col-span-2" :help="t('connection.sslStrictHelp')">
          <USwitch v-model="form.sslStrict" :label="t('connection.sslStrict')" />
        </UFormField>
      </template>
      <UFormField class="col-span-2" :help="form.sslInsecure ? t('connection.insecureHelp') : undefined">
        <USwitch v-model="form.sslInsecure" color="warning" :label="t('connection.insecure')" />
      </UFormField>
    </template>
    <ConnectionMcpLogin
      v-if="mcpLoginAvailable"
      v-model:form="form"
      v-model:clear="clearMcpPassword"
      :stored="!!connection?.hasMcpPassword"
    />
  </div>
</template>
