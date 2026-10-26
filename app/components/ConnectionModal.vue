<script setup lang="ts">
import type { ConnectionInput, ConnectionSummary } from '#core'

const props = defineProps<{ connection?: ConnectionSummary }>()
const open = defineModel<boolean>('open', { required: true })

const { drivers, connections, saveConnection, removeConnection, testConnection, installDriver } = useWorkspace()
const toast = useToast()

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
    toast.add({ title: 'Fehler', description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
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
    toast.add({ title: 'Fehler', description: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    busy.value = undefined
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="connection ? 'Verbindung bearbeiten' : 'Neue Verbindung'">
    <template #body>
      <!-- Names, hosts and paths are not prose: no autocorrect, capitalization or spell check (Safari/WebView). -->
      <form class="grid grid-cols-2 gap-3" @submit.prevent="driver?.installed && act('save', () => saveConnection(payload()), 'Gespeichert')">
        <UFormField label="Name" required>
          <UInput v-model="form.name" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" autofocus />
        </UFormField>
        <UFormField label="Ordner" help="Leer = oberste Ebene">
          <UInput v-model="form.folder" class="w-full" list="dbm-folders" autocomplete="off" autocorrect="off" autocapitalize="off" :spellcheck="false" />
          <datalist id="dbm-folders">
            <option v-for="f in folders" :key="f" :value="f" />
          </datalist>
        </UFormField>
        <UFormField label="Datenbanksystem" class="col-span-2">
          <USelect v-model="form.dialect" :items="dialectItems" class="w-full" />
        </UFormField>

        <template v-if="driver?.capabilities.supportsNetwork">
          <UFormField label="Host">
            <UInput v-model="form.host" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" />
          </UFormField>
          <UFormField label="Port">
            <UInput v-model.number="form.port" type="number" :placeholder="String(driver.defaultPort ?? '')" class="w-full" />
          </UFormField>
          <UFormField label="Datenbank" class="col-span-2">
            <UInput v-model="form.database" class="w-full" autocorrect="off" autocapitalize="off" :spellcheck="false" />
          </UFormField>
          <UFormField label="Benutzer">
            <UInput v-model="form.user" class="w-full" autocomplete="off" autocorrect="off" autocapitalize="off" :spellcheck="false" />
          </UFormField>
          <UFormField label="Passwort">
            <UInput
              v-model="form.password"
              type="password"
              class="w-full"
              autocomplete="new-password"
              :disabled="clearPassword"
              :placeholder="clearPassword ? 'wird entfernt' : connection?.hasPassword ? 'unverändert' : ''"
            />
          </UFormField>
          <UFormField v-if="connection?.hasPassword" class="col-span-2">
            <USwitch v-model="clearPassword" label="Gespeichertes Passwort entfernen" />
          </UFormField>
          <UFormField class="col-span-2">
            <USwitch v-model="form.ssl" label="TLS verwenden" />
          </UFormField>
          <template v-if="form.ssl">
            <UFormField label="CA-Zertifikat" help="Pfad zu einer PEM-Datei, z. B. für selbstsignierte Server. Leer = System-CAs." class="col-span-2">
              <UInput v-model="form.sslCa" class="w-full" placeholder="/pfad/zu/ca.pem" autocorrect="off" autocapitalize="off" :spellcheck="false" :disabled="form.sslInsecure" />
            </UFormField>
            <UFormField class="col-span-2" :help="form.sslInsecure ? 'Verschlüsselt, aber ohne Schutz vor Man-in-the-Middle-Angriffen.' : undefined">
              <USwitch v-model="form.sslInsecure" color="warning" label="Zertifikat nicht prüfen" />
            </UFormField>
          </template>
        </template>

        <template v-else>
          <UFormField label="Datenbankdatei" class="col-span-2" help="Absoluter Pfad oder :memory:">
            <div class="flex gap-2">
              <UInput v-model="form.file" class="flex-1" placeholder=":memory:" autocorrect="off" autocapitalize="off" :spellcheck="false" />
              <UButton color="neutral" variant="outline" icon="i-lucide-folder-open" label="Durchsuchen …" :loading="picking" @click="pickFile" />
            </div>
          </UFormField>
          <UFormField class="col-span-2">
            <USwitch v-model="form.readOnly" label="Schreibgeschützt öffnen" />
          </UFormField>
        </template>

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
          label="Löschen"
          :loading="busy === 'delete'"
          @click="act('delete', () => removeConnection(connection!.id), 'Gelöscht')"
        />
        <!-- DuckDB's native addon is downloaded on first use; testing and saving need it. -->
        <template v-if="driver && !driver.installed">
          <UProgress
            v-if="busy === 'install'"
            :model-value="driver.installProgress === undefined ? null : Math.round(driver.installProgress * 100)"
            class="ml-auto w-40 self-center"
          />
          <UButton
            :class="busy === 'install' ? undefined : 'ml-auto'"
            icon="i-lucide-download"
            label="Datenbanktreiber laden"
            :loading="busy === 'install'"
            @click="act('install', () => installDriver(driver!.dialect), 'Datenbanktreiber installiert')"
          />
        </template>
        <template v-else>
          <UButton
            class="ml-auto"
            color="neutral"
            variant="outline"
            icon="i-lucide-plug-zap"
            label="Testen"
            :loading="busy === 'test'"
            @click="act('test', () => testConnection(payload()), 'Verbindung erfolgreich')"
          />
          <UButton
            icon="i-lucide-save"
            label="Speichern"
            :loading="busy === 'save'"
            @click="act('save', () => saveConnection(payload()), 'Gespeichert')"
          />
        </template>
      </div>
    </template>
  </UModal>
</template>
