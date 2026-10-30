<script setup lang="ts">
import type { ConnectionInput, ConnectionSummary } from '#core'

const props = defineProps<{ connection?: ConnectionSummary }>()
const open = defineModel<boolean>('open', { required: true })

const { drivers, connections, saveConnection, removeConnection, testConnection, installDriver } = useWorkspace()
const toast = useToast()
const { t } = useI18n()

const form = reactive<Partial<ConnectionInput>>({})
const busy = ref<'test' | 'save' | 'delete' | 'install'>()
const clearPassword = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  const c = props.connection
  clearPassword.value = false
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
    ssl: c?.ssl ?? false,
    sslCa: c?.sslCa ?? '',
    sslInsecure: c?.sslInsecure ?? false,
    file: c?.file ?? '',
    readOnly: c?.readOnly ?? false,
    color: c?.color,
    confirmWrites: c?.confirmWrites ?? false,
  })
}, { immediate: true })

const driver = computed(() => drivers.value.find(d => d.dialect === form.dialect))
const dialectItems = computed(() => drivers.value.map(d => ({ label: d.label, value: d.dialect })))
const folders = computed(() => [...new Set(connections.value.flatMap(c => c.folder ? [c.folder] : []))].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })))

// An empty password field keeps the stored password (sent as `undefined`), `''` removes it.
function payload(): Partial<ConnectionInput> {
  const password = clearPassword.value ? '' : form.password || (props.connection?.hasPassword ? undefined : '')
  return { ...form, password }
}

// Native dialog on the server's machine: the page itself cannot learn the path of a picked file.
const picking = ref(false)
async function pickFile() {
  picking.value = true
  try {
    const { path } = await api<{ path: string | null }>('/api/dialog', { method: 'POST', body: { kind: 'open' } })
    if (path) form.file = path
  } catch (e) {
    toast.add({ title: t('common.error'), description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
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
    toast.add({ title: t('common.error'), description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    busy.value = undefined
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="connection ? t('connection.edit') : t('connection.new')">
    <template #body>
      <!-- Names, hosts and paths are not prose: no autocorrect, capitalization or spell check (Safari/WebView). -->
      <form class="grid grid-cols-2 gap-3" @submit.prevent="driver?.installed && act('save', () => saveConnection(payload()), t('common.saved'))">
        <UFormField :label="t('connection.name')" required>
          <UInput v-model="form.name" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" autofocus />
        </UFormField>
        <UFormField :label="t('connection.folder')" :help="t('connection.folderHelp')">
          <UInput v-model="form.folder" class="w-full" list="dbm-folders" autocomplete="off" autocorrect="off" autocapitalize="off" :spellcheck="false" />
          <datalist id="dbm-folders">
            <option v-for="f in folders" :key="f" :value="f" />
          </datalist>
        </UFormField>
        <UFormField :label="t('connection.dialect')" class="col-span-2">
          <USelect v-model="form.dialect" :items="dialectItems" class="w-full" />
        </UFormField>

        <template v-if="driver?.capabilities.supportsNetwork">
          <UFormField :label="t('connection.host')">
            <UInput v-model="form.host" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" />
          </UFormField>
          <UFormField :label="t('connection.port')">
            <UInput v-model.number="form.port" type="number" :placeholder="String(driver.defaultPort ?? '')" class="w-full" />
          </UFormField>
          <UFormField :label="t('connection.database')" class="col-span-2">
            <UInput v-model="form.database" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" />
          </UFormField>
          <UFormField :label="t('connection.user')">
            <UInput v-model="form.user" class="w-full" autocomplete="off" autocorrect="off" autocapitalize="off" :spellcheck="false" />
          </UFormField>
          <UFormField :label="t('connection.password')">
            <UInput
              v-model="form.password"
              type="password"
              class="w-full"
              autocomplete="new-password"
              :disabled="clearPassword"
              :placeholder="clearPassword ? t('connection.passwordRemoved') : connection?.hasPassword ? t('connection.passwordUnchanged') : ''"
            />
          </UFormField>
          <UFormField v-if="connection?.hasPassword" class="col-span-2">
            <USwitch v-model="clearPassword" :label="t('connection.clearPassword')" />
          </UFormField>
          <UFormField class="col-span-2">
            <USwitch v-model="form.ssl" :label="t('connection.useTls')" />
          </UFormField>
          <template v-if="form.ssl">
            <UFormField :label="t('connection.caCert')" :help="t('connection.caCertHelp')" class="col-span-2">
              <UInput v-model="form.sslCa" class="w-full" :placeholder="t('connection.caCertPlaceholder')" autocorrect="off" autocapitalize="off" :spellcheck="false" :disabled="form.sslInsecure" />
            </UFormField>
            <UFormField class="col-span-2" :help="form.sslInsecure ? t('connection.insecureHelp') : undefined">
              <USwitch v-model="form.sslInsecure" color="warning" :label="t('connection.insecure')" />
            </UFormField>
          </template>
        </template>

        <template v-else>
          <UFormField :label="t('connection.file')" class="col-span-2" :help="t('connection.fileHelp')">
            <div class="flex gap-2">
              <UInput v-model="form.file" class="flex-1" placeholder=":memory:" autocorrect="off" autocapitalize="off" :spellcheck="false" />
              <UButton color="neutral" variant="outline" icon="i-lucide-folder-open" :label="t('connection.browse')" :loading="picking" @click="pickFile" />
            </div>
          </UFormField>
          <UFormField class="col-span-2">
            <USwitch v-model="form.readOnly" :label="t('connection.readOnly')" />
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
              :class="[c.bg, form.color === key ? 'ring-2 ring-(--ui-text)' : 'hover:ring-2 hover:ring-(--ui-border-accented)']"
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
