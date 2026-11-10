<script setup lang="ts">
import type { ConnectionAuth, ConnectionInput, ConnectionSummary, DateFormat } from '#core'

const props = defineProps<{ connection?: ConnectionSummary }>()
const open = defineModel<boolean>('open', { required: true })

const { drivers, connections, saveConnection, removeConnection, testConnection, installDriver } = useConnections()
const toast = useToast()
const { t } = useI18n()

const form = reactive<Partial<ConnectionInput>>({})
const busy = ref<'test' | 'save' | 'delete' | 'install'>()
const clearPassword = ref(false)
const clearSshSecret = ref(false)
const showAdvanced = ref(false)

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    const c = props.connection
    clearPassword.value = false
    clearSshSecret.value = false
    Object.assign(form, {
      id: c?.id,
      name: c?.name ?? '',
      folder: c?.folder ?? '',
      dialect: c?.dialect ?? 'postgres',
      host: c?.host ?? '127.0.0.1',
      port: c?.port,
      database: c?.database ?? '',
      user: c?.user ?? '',
      password: '',
      auth: c?.auth,
      domain: c?.domain ?? '',
      tenantId: c?.tenantId ?? '',
      clientId: c?.clientId ?? '',
      socket: c?.socket ?? '',
      searchPath: c?.searchPath ?? '',
      instanceName: c?.instanceName ?? '',
      readOnlyIntent: c?.readOnlyIntent ?? false,
      multiSubnetFailover: c?.multiSubnetFailover ?? false,
      connectRetries: c?.connectRetries,
      language: c?.language ?? '',
      dateFormat: c?.dateFormat,
      ssl: c?.ssl ?? false,
      sslCa: c?.sslCa ?? '',
      sslInsecure: c?.sslInsecure ?? false,
      sslStrict: c?.sslStrict ?? false,
      sslServerName: c?.sslServerName ?? '',
      file: c?.file ?? '',
      readOnly: c?.readOnly ?? false,
      v1Storage: c?.v1Storage ?? false,
      region: c?.region ?? '',
      oauthServerUri: c?.oauthServerUri ?? '',
      oauthScope: c?.oauthScope ?? '',
      ssh: c?.ssh ?? false,
      sshHost: c?.sshHost ?? '',
      sshPort: c?.sshPort,
      sshUser: c?.sshUser ?? '',
      sshAuth: c?.sshAuth ?? 'password',
      sshKeyFile: c?.sshKeyFile ?? '',
      sshSecret: '',
      sshHostKey: c?.sshHostKey,
      color: c?.color,
      confirmWrites: c?.confirmWrites ?? false,
    })
    // Opens with the further options shown when the connection uses one of them.
    showAdvanced.value = !!(
      c &&
      (c.tenantId ||
        c.clientId ||
        c.socket ||
        c.searchPath ||
        c.instanceName ||
        c.readOnlyIntent ||
        c.multiSubnetFailover ||
        c.connectRetries !== undefined ||
        c.language ||
        c.dateFormat ||
        c.sslCa ||
        c.sslInsecure ||
        c.sslStrict ||
        c.sslServerName ||
        c.region ||
        c.oauthServerUri ||
        c.oauthScope ||
        c.ssh)
    )
  },
  { immediate: true },
)

const driver = computed(() => drivers.value.find((d) => d.dialect === form.dialect))
const dialectItems = computed(() =>
  drivers.value.map((d) => ({ label: d.label, value: d.dialect })).sort((a, b) => a.label.localeCompare(b.label)),
)
const authItems = computed(() =>
  (driver.value?.auths ?? []).map((a) => ({ label: t(`connection.auths.${a}`), value: a })),
)
// Another dialect may not offer the selected login.
watch(
  driver,
  (d) => {
    if (d && !d.auths.includes(form.auth as ConnectionAuth)) form.auth = d.auths[0]
  },
  { immediate: true },
)
const isEntra = computed(() => form.auth?.startsWith('entra-') ?? false)
// Lakehouses: the address is the catalog URL (Iceberg, Unity) or the workspace (OneLake), the database its
// warehouse, catalog or lakehouse; they log in with a token or an Entra login, without user name.
const lakehouse = computed(() => !!form.dialect && isLakehouse(form.dialect))
const hostField = computed(
  () =>
    ({
      iceberg: { label: 'catalogUrl', help: 'catalogUrlHelp', placeholder: 'https://catalog.example.com/api/catalog' },
      unity: {
        label: 'workspaceUrl',
        help: undefined,
        placeholder: 'https://adb-1234567890123456.7.azuredatabricks.net',
      },
      onelake: { label: 'workspace', help: 'workspaceHelp', placeholder: '' },
    })[form.dialect as string] ?? { label: 'host', help: undefined, placeholder: '' },
)
const databaseField = computed(
  () =>
    ({
      iceberg: { label: 'warehouse', help: 'warehouseHelp' },
      unity: { label: 'catalog', help: 'catalogHelp' },
      onelake: { label: 'lakehouse', help: 'lakehouseHelp' },
    })[form.dialect as string] ?? { label: 'database', help: undefined },
)
// A host prefilled for a server is no catalog URL or workspace.
watch(lakehouse, (isLake) => {
  if (isLake && form.host === '127.0.0.1') form.host = ''
  else if (!isLake && !form.host) form.host = '127.0.0.1'
})
// SQL Server takes the user from the Entra token; PostgreSQL and MySQL need the database user that belongs to it.
const showUser = computed(
  () => !lakehouse.value && (!isEntra.value || form.dialect !== 'mssql' || form.auth === 'entra-interactive'),
)
const showPassword = computed(() =>
  (['password', 'windows', 'entra-service-principal', 'token', 'oauth-client'] as (string | undefined)[]).includes(
    form.auth,
  ),
)
const passwordLabel = computed(() =>
  form.auth === 'entra-service-principal' || form.auth === 'oauth-client'
    ? t('connection.clientSecret')
    : form.auth === 'token'
      ? t('connection.token')
      : t('connection.password'),
)
// Lakehouses have further options only for some logins.
const hasAdvanced = computed(
  () =>
    !lakehouse.value ||
    form.auth === 'oauth-client' ||
    form.auth === 'entra-default' ||
    form.auth === 'entra-interactive' ||
    form.dialect === 'unity',
)

// `default` stands for no SET DATEFORMAT (the session language decides); select items cannot have an empty value.
const dateFormatItems = computed(() => [
  { label: t('connection.dateFormatDefault'), value: 'default' },
  ...(['dmy', 'mdy', 'ymd', 'ydm', 'myd', 'dym'] satisfies DateFormat[]).map((f) => ({ label: f, value: f })),
])
const dateFormat = computed({
  get: () => form.dateFormat ?? 'default',
  set: (v: string) => (form.dateFormat = v === 'default' ? undefined : (v as DateFormat)),
})

const sshSupported = computed(() => ['postgres', 'mysql', 'mssql', 'clickhouse'].includes(form.dialect ?? ''))
const sshAuthItems = (['password', 'key', 'agent'] as const).map((a) => ({
  label: t(`connection.sshAuths.${a}`),
  value: a,
}))
// A host key belongs to one SSH server.
const forgetHostKey = () => (form.sshHostKey = undefined)

const folders = computed(() =>
  [...new Set(connections.value.flatMap((c) => (c.folder ? [c.folder] : [])))].sort((a, b) =>
    a.localeCompare(b, 'de', { sensitivity: 'base' }),
  ),
)

// An empty password field keeps the stored password (sent as `undefined`), `''` removes it (also when the login needs none).
function payload(): Partial<ConnectionInput> {
  const password =
    clearPassword.value || !showPassword.value ? '' : form.password || (props.connection?.hasPassword ? undefined : '')
  // Like the password: empty keeps the stored SSH secret, `''` removes it.
  const sshSecret =
    clearSshSecret.value || !form.ssh || form.sshAuth === 'agent'
      ? ''
      : form.sshSecret || (props.connection?.hasSshSecret ? undefined : '')
  // The fields that exclude a tunnel are hidden with it on.
  return { ...form, password, sshSecret, ...(form.ssh && { socket: '', instanceName: '' }) }
}

// Native dialog: the page itself cannot learn the path of a picked file.
const picking = ref(false)
async function pickFile() {
  picking.value = true
  try {
    const delta = form.dialect === 'delta'
    const path = await fileDialog(delta ? 'folder' : 'open', t(delta ? 'dialog.openFolder' : 'dialog.open'))
    if (path) form.file = path
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
        <UFormField :label="t('connection.dialect')" class="col-span-2">
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
            :class="showPassword ? undefined : 'col-span-2'"
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
          <UFormField v-if="showPassword" :label="passwordLabel" :class="showUser ? undefined : 'col-span-2'">
            <UInput
              v-model="form.password"
              type="password"
              class="w-full"
              autocomplete="new-password"
              :disabled="clearPassword"
              :placeholder="
                clearPassword
                  ? t('connection.passwordRemoved')
                  : connection?.hasPassword
                    ? t('connection.passwordUnchanged')
                    : ''
              "
            />
          </UFormField>
          <UFormField v-if="showPassword && connection?.hasPassword" class="col-span-2">
            <USwitch v-model="clearPassword" :label="t('connection.clearPassword')" />
          </UFormField>
          <UFormField v-if="isEntra" class="col-span-2">
            <p class="text-sm text-(--ui-text-muted)">
              {{ t(`connection.entraHelp.${form.auth}`) }}
            </p>
          </UFormField>
          <!-- Lakehouses take https from their URL. -->
          <UFormField v-if="!lakehouse" class="col-span-2">
            <USwitch v-model="form.ssl" :label="t('connection.useTls')" />
          </UFormField>

          <UCollapsible v-if="hasAdvanced" v-model:open="showAdvanced" class="col-span-2">
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
                <template v-if="form.auth === 'oauth-client'">
                  <UFormField
                    :label="t('connection.oauthServerUri')"
                    :help="t('connection.oauthServerUriHelp')"
                    class="col-span-2"
                  >
                    <UInput
                      v-model="form.oauthServerUri"
                      class="w-full"
                      autocorrect="off"
                      autocapitalize="off"
                      :spellcheck="false"
                    />
                  </UFormField>
                  <UFormField
                    :label="t('connection.oauthScope')"
                    :help="t('connection.oauthScopeHelp')"
                    class="col-span-2"
                  >
                    <UInput
                      v-model="form.oauthScope"
                      class="w-full"
                      autocorrect="off"
                      autocapitalize="off"
                      :spellcheck="false"
                    />
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
                  <UInput
                    v-model="form.socket"
                    class="w-full"
                    autocorrect="off"
                    autocapitalize="off"
                    :spellcheck="false"
                  />
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
                  <UFormField
                    v-if="!form.ssh"
                    :label="t('connection.instanceName')"
                    :help="t('connection.instanceNameHelp')"
                  >
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
                    <UFormField
                      v-if="form.sshAuth === 'key'"
                      :label="t('connection.sshKeyFile')"
                      required
                      class="col-span-2"
                    >
                      <UInput
                        v-model="form.sshKeyFile"
                        class="w-full"
                        placeholder="~/.ssh/id_ed25519"
                        autocorrect="off"
                        autocapitalize="off"
                        :spellcheck="false"
                      />
                    </UFormField>
                    <UFormField
                      v-if="form.sshAuth !== 'agent'"
                      :label="form.sshAuth === 'key' ? t('connection.sshPassphrase') : t('connection.password')"
                      class="col-span-2"
                    >
                      <UInput
                        v-model="form.sshSecret"
                        type="password"
                        class="w-full"
                        autocomplete="new-password"
                        :disabled="clearSshSecret"
                        :placeholder="
                          clearSshSecret
                            ? t('connection.passwordRemoved')
                            : connection?.hasSshSecret
                              ? t('connection.passwordUnchanged')
                              : ''
                        "
                      />
                    </UFormField>
                    <UFormField v-if="form.sshAuth !== 'agent' && connection?.hasSshSecret" class="col-span-2">
                      <USwitch v-model="clearSshSecret" :label="t('connection.clearSshSecret')" />
                    </UFormField>
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
                    <UFormField
                      :label="t('connection.sslServerName')"
                      :help="t('connection.sslServerNameHelp')"
                      class="col-span-2"
                    >
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
              </div>
            </template>
          </UCollapsible>
        </template>

        <template v-else>
          <UFormField
            v-if="form.dialect === 'delta'"
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
          <UFormField v-if="!lakehouse" class="col-span-2">
            <USwitch v-model="form.readOnly" :label="t('connection.readOnly')" />
          </UFormField>
          <UFormField
            v-if="form.dialect === 'duckdb' && form.file && form.file !== ':memory:'"
            class="col-span-2"
            :help="t('connection.v1StorageHelp')"
          >
            <USwitch v-model="form.v1Storage" :label="t('connection.v1Storage')" />
          </UFormField>
        </template>

        <UFormField :label="t('connection.color')" :help="t('connection.colorHelp')" class="col-span-2">
          <div class="flex items-center gap-2">
            <UButton
              size="xs"
              color="neutral"
              :variant="form.color ? 'ghost' : 'soft'"
              :label="t('connection.noColor')"
              :aria-pressed="!form.color"
              @click="form.color = undefined"
            />
            <button
              v-for="(c, key) in connectionColorClasses"
              :key="key"
              type="button"
              class="size-5 rounded-full ring-offset-2 ring-offset-(--ui-bg)"
              :class="[
                c.bg,
                form.color === key ? 'ring-2 ring-(--ui-text)' : 'hover:ring-2 hover:ring-(--ui-border-accented)',
              ]"
              :title="t(`colors.${key}`)"
              :aria-label="t(`colors.${key}`)"
              :aria-pressed="form.color === key"
              @click="form.color = key"
            />
          </div>
        </UFormField>
        <UFormField class="col-span-2" :help="t('connection.confirmWritesHelp')">
          <USwitch v-model="form.confirmWrites" :label="t('connection.confirmWrites')" />
        </UFormField>

        <button type="submit" class="hidden" />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full gap-2">
        <UButton
          v-if="connection"
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          :label="t('connection.delete')"
          :loading="busy === 'delete'"
          @click="act('delete', () => removeConnection(connection!.id), t('connection.deleted'))"
        />
        <!-- DuckDB's native library is downloaded on first use; testing and saving need it. -->
        <template v-if="driver && !driver.installed">
          <UProgress
            v-if="busy === 'install'"
            :model-value="driver.installProgress === undefined ? null : Math.round(driver.installProgress * 100)"
            class="ml-auto w-40 self-center"
          />
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
