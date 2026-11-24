<script setup lang="ts">
import type { ConnectionSummary, SplitDialect } from '#core'

const props = defineProps<{ connection?: ConnectionSummary }>()
const open = defineModel<boolean>('open', { required: true })

const { drivers, connections, saveConnection, removeConnection, testConnection, installDriver } = useConnections()
const toast = useToast()
const { t } = useI18n()

const busy = ref<'test' | 'save' | 'delete' | 'install'>()
const {
  form,
  clearPassword,
  clearSshSecret,
  clearMcpPassword,
  showAdvanced,
  sourcesText,
  driver,
  authItems,
  isEntra,
  lakehouse,
  hostField,
  databaseField,
  showUser,
  showPassword,
  passwordLabel,
  mcpLoginAvailable,
  hasAdvanced,
  payload,
} = useConnectionForm(open, () => props.connection)

const dialectItems = computed(() =>
  drivers.value.map((d) => ({ label: d.label, value: d.dialect })).sort((a, b) => a.label.localeCompare(b.label)),
)

const folders = computed(() =>
  [...new Set(connections.value.flatMap((c) => (c.folder ? [c.folder] : [])))].sort((a, b) =>
    a.localeCompare(b, 'de', { sensitivity: 'base' }),
  ),
)

async function act(kind: 'test' | 'save' | 'delete' | 'install', fn: () => Promise<unknown>, success: string) {
  busy.value = kind
  try {
    await fn()
    toast.add({ title: success, color: 'success', icon: 'i-lucide-check' })
    if (kind === 'save' || kind === 'delete') open.value = false
  } catch (e) {
    toast.add({
      title: t('common.error'),
      description: errorMessage(e),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    busy.value = undefined
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="connection ? t('connection.edit') : t('connection.new')">
    <template #body>
      <!-- Names, hosts and paths are not prose: no autocorrect, capitalization or spell check (Safari/WebView). -->
      <form
        class="grid grid-cols-2 gap-3"
        @submit.prevent="driver?.installed && act('save', () => saveConnection(payload()), t('common.saved'))"
      >
        <UFormField :label="t('connection.name')" required>
          <UInput
            v-model="form.name"
            class="w-full"
            autocorrect="off"
            autocapitalize="off"
            :spellcheck="false"
            autofocus
          />
        </UFormField>
        <UFormField :label="t('connection.folder')" :help="t('connection.folderHelp')">
          <UInput
            v-model="form.folder"
            class="w-full"
            list="colwerk-folders"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            :spellcheck="false"
          />
          <datalist id="colwerk-folders">
            <option v-for="f in folders" :key="f" :value="f" />
          </datalist>
        </UFormField>
        <UFormField :label="t('connection.dialect')" class="col-span-2" data-tour="connection-engine">
          <USelect v-model="form.dialect" :items="dialectItems" class="w-full" />
        </UFormField>

        <template v-if="driver?.capabilities.supportsNetwork">
          <UFormField
            :label="t(`connection.${hostField.label}`)"
            :help="hostField.help && t(`connection.${hostField.help}`)"
            :required="lakehouse"
            :class="lakehouse ? 'col-span-2' : undefined"
          >
            <UInput
              v-model="form.host"
              class="w-full"
              :placeholder="hostField.placeholder"
              autocorrect="off"
              autocapitalize="off"
              :spellcheck="false"
            />
          </UFormField>
          <UFormField v-if="!lakehouse" :label="t('connection.port')">
            <!-- ClickHouse serves HTTPS on another port. -->
            <UInput
              v-model.number="form.port"
              type="number"
              :placeholder="form.dialect === 'clickhouse' && form.ssl ? '8443' : String(driver.defaultPort ?? '')"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="t(`connection.${databaseField.label}`)"
            :help="databaseField.help && t(`connection.${databaseField.help}`)"
            class="col-span-2"
          >
            <UInput v-model="form.database" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" />
          </UFormField>
          <UFormField v-if="authItems.length > 1" :label="t('connection.auth')" class="col-span-2">
            <USelect v-model="form.auth" :items="authItems" class="w-full" />
          </UFormField>
          <UFormField v-if="form.auth === 'windows'" :label="t('connection.domain')" class="col-span-2">
            <UInput v-model="form.domain" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" />
          </UFormField>
          <UFormField v-if="form.auth === 'oauth-client'" :label="t('connection.clientId')" required class="col-span-2">
            <UInput
              v-model="form.clientId"
              class="w-full"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              :spellcheck="false"
            />
          </UFormField>
          <template v-if="form.auth === 'entra-service-principal'">
            <UFormField :label="t('connection.tenantId')" required>
              <UInput
                v-model="form.tenantId"
                class="w-full"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                :spellcheck="false"
              />
            </UFormField>
            <UFormField :label="t('connection.clientId')" required>
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
            v-if="showUser"
            :label="
              form.dialect === 'mssql' && form.auth === 'entra-interactive'
                ? t('connection.account')
                : t('connection.user')
            "
            :help="
              isEntra
                ? form.dialect === 'mssql'
                  ? t('connection.accountHelp')
                  : t('connection.entraUserHelp')
                : undefined
            "
            class="col-span-2"
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
          <SecretInput
            v-if="showPassword"
            v-model:value="form.password"
            v-model:reference="form.passwordRef"
            v-model:clear="clearPassword"
            :label="passwordLabel"
            :stored="!!connection?.hasPassword"
            :clear-label="t('connection.clearPassword')"
          />
          <UFormField v-if="isEntra" class="col-span-2">
            <p class="text-sm text-(--ui-text-muted)">
              {{ t(`connection.entraHelp.${form.auth}`) }}
            </p>
          </UFormField>
          <!-- Lakehouses take https from their URL. -->
          <UFormField v-if="!lakehouse" class="col-span-2">
            <USwitch v-model="form.ssl" :label="t('connection.useTls')" />
          </UFormField>
        </template>

        <ConnectionFileFields
          v-else
          v-model:form="form"
          v-model:sources="sourcesText"
          v-model:clear-password="clearPassword"
          :auth-items="authItems"
          :show-password="showPassword"
          :password-label="passwordLabel"
          :stored-password="!!connection?.hasPassword"
        />

        <UCollapsible v-model:open="showAdvanced" class="col-span-2" data-tour="connection-options">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            class="-ml-2.5"
            :label="t('connection.advanced')"
            :trailing-icon="showAdvanced ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          />
          <template #content>
            <div class="grid grid-cols-2 gap-3 pt-3">
              <ConnectionAdvancedFields
                v-if="driver?.capabilities.supportsNetwork && hasAdvanced"
                v-model:form="form"
                v-model:clear-ssh-secret="clearSshSecret"
                v-model:clear-mcp-password="clearMcpPassword"
                :connection="connection"
                :mcp-login-available="mcpLoginAvailable"
              />
              <UFormField
                v-if="form.dialect === 'duckdb' && form.file && form.file !== ':memory:'"
                class="col-span-2"
                :help="t('connection.v1StorageHelp')"
              >
                <USwitch v-model="form.v1Storage" :label="t('connection.v1Storage')" />
              </UFormField>
              <UFormField
                v-if="form.dialect === 'duckdb'"
                class="col-span-2"
                :help="t('connection.mcpExternalAccessHelp')"
              >
                <USwitch v-model="form.mcpExternalAccess" color="warning" :label="t('connection.mcpExternalAccess')" />
              </UFormField>
              <UFormField :label="t('connection.color')" :help="t('connection.colorHelp')" class="col-span-2">
                <ConnectionColorPicker v-model="form.color" />
              </UFormField>
              <UFormField
                class="col-span-2"
                :help="t(`connection.readOnlyHelps.${lakehouse ? 'lakehouse' : form.dialect}`)"
              >
                <USwitch v-model="form.readOnly" :label="t('connection.readOnly')" />
              </UFormField>
              <UFormField class="col-span-2" :help="t('connection.confirmWritesHelp')">
                <USwitch v-model="form.confirmWrites" :label="t('connection.confirmWrites')" />
              </UFormField>
              <UFormField class="col-span-2" :help="t('connection.requireWhereHelp')">
                <USwitch
                  :model-value="form.requireWhere ?? !!form.confirmWrites"
                  :label="t('connection.requireWhere')"
                  @update:model-value="(v) => (form.requireWhere = v)"
                />
              </UFormField>
              <template v-if="planCheckDialects.includes(form.dialect as SplitDialect)">
                <UFormField class="col-span-2" :help="t('connection.checkPlanHelp')">
                  <USwitch
                    :model-value="form.checkPlan ?? !!form.confirmWrites"
                    :label="t('connection.checkPlan')"
                    @update:model-value="(v) => (form.checkPlan = v)"
                  />
                </UFormField>
                <UFormField
                  v-if="form.checkPlan ?? form.confirmWrites"
                  :label="t('connection.scanRowThreshold')"
                  :help="t('connection.scanRowThresholdHelp')"
                >
                  <UInput
                    v-model.number="form.scanRowThreshold"
                    type="number"
                    min="1"
                    placeholder="1000000"
                    class="w-full"
                  />
                </UFormField>
              </template>
            </div>
          </template>
        </UCollapsible>

        <button type="submit" class="hidden" />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full gap-2" data-tour="connection-actions">
        <UButton
          v-if="connection"
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          :label="t('connection.delete')"
          :loading="busy === 'delete'"
          @click="act('delete', () => removeConnection(connection!.id), t('connection.deleted'))"
        />
        <!-- A lakehouse needs its DuckDB extensions, downloaded on first use; testing and saving need them. -->
        <template v-if="driver && !driver.installed">
          <UProgress v-if="busy === 'install'" :model-value="null" class="ml-auto w-40 self-center" />
          <UButton
            :class="busy === 'install' ? undefined : 'ml-auto'"
            icon="i-lucide-download"
            :label="t('connection.installDriver')"
            :loading="busy === 'install'"
            @click="act('install', () => installDriver(driver!.dialect), t('connection.driverInstalled'))"
          />
        </template>
        <template v-else>
          <UButton
            class="ml-auto"
            color="neutral"
            variant="outline"
            icon="i-lucide-plug-zap"
            :label="t('connection.test')"
            :loading="busy === 'test'"
            @click="act('test', () => testConnection(payload()), t('connection.testSucceeded'))"
          />
          <UButton
            icon="i-lucide-save"
            :label="t('common.save')"
            :loading="busy === 'save'"
            @click="act('save', () => saveConnection(payload()), t('common.saved'))"
          />
        </template>
      </div>
    </template>
  </UModal>
</template>
