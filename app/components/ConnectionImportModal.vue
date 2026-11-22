<script setup lang="ts">
import type { ImportPreview, ImportPreviewItem, ImportSource } from '#core'

const open = defineModel<boolean>('open', { default: false })

const { drivers, load } = useConnections()
const { t } = useI18n()
const toast = useToast()

const sources = ref<{ source: ImportSource; path: string | null }[]>([])
const preview = ref<ImportPreview & { source: ImportSource }>()
const scanning = ref<ImportSource>()
const importing = ref(false)
const error = ref<string>()
const failed = ref<{ name: string; message: string }[]>([])
const selected = reactive(new Set<string>())
const passwords = ref<Record<string, string>>({})

watch(
  open,
  async (v) => {
    if (!v) return
    preview.value = undefined
    error.value = undefined
    failed.value = []
    try {
      sources.value = await api('/api/connections/import')
    } catch (e) {
      error.value = errorMessage(e)
    }
  },
  { immediate: true },
)

// Without `path` the source's default file is read.
async function scan(source: ImportSource, path?: string) {
  scanning.value = source
  error.value = undefined
  try {
    const result = await api<ImportPreview>('/api/connections/import/scan', { method: 'POST', body: { source, path } })
    preview.value = { ...result, source }
    selected.clear()
    passwords.value = {}
    for (const item of result.items) if (!item.duplicate) selected.add(item.key)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    scanning.value = undefined
  }
}

async function choose(source: ImportSource) {
  try {
    const path = await fileDialog('open', t('connectionImport.chooseFile'))
    if (path) await scan(source, path)
  } catch (e) {
    error.value = errorMessage(e)
  }
}

const selectable = computed(() => preview.value?.items.filter((i) => !i.duplicate) ?? [])
const allSelected = computed(() => selectable.value.length > 0 && selectable.value.every((i) => selected.has(i.key)))

function setAll(on: boolean | 'indeterminate') {
  selected.clear()
  if (on === true) for (const item of selectable.value) selected.add(item.key)
}

function toggle(key: string, on: boolean | 'indeterminate') {
  if (on === true) selected.add(key)
  else selected.delete(key)
}

// Passwords of network connections that the source did not give; leaving the field empty stores none.
const needsPassword = (i: ImportPreviewItem) =>
  !!drivers.value.find((d) => d.dialect === i.connection.dialect)?.capabilities.supportsNetwork &&
  !i.connection.hasPassword &&
  ['password', 'windows', 'entra-service-principal'].includes(i.connection.auth ?? 'password')

const dialectLabel = (dialect: string) => drivers.value.find((d) => d.dialect === dialect)?.label ?? dialect

function target(i: ImportPreviewItem) {
  const c = i.connection
  if (c.file) return c.file
  if (!c.host) return c.socket ?? ''
  return `${c.host}${c.port ? `:${c.port}` : ''}${c.instanceName ? `\\${c.instanceName}` : ''}${c.database ? ` / ${c.database}` : ''}`
}

const noteText = (n: { key: string; params?: Record<string, string | number> }) =>
  t(`connectionImport.notes.${n.key}`, n.params ?? {})

async function runImport() {
  const p = preview.value
  if (!p) return
  importing.value = true
  error.value = undefined
  failed.value = []
  try {
    const keys = [...selected]
    const result = await api<{ imported: number; failed: { name: string; message: string }[] }>(
      '/api/connections/import',
      {
        method: 'POST',
        body: {
          source: p.source,
          path: p.path,
          keys,
          passwords: Object.fromEntries(keys.filter((k) => passwords.value[k]).map((k) => [k, passwords.value[k]])),
        },
      },
    )
    await load()
    if (result.imported) {
      toast.add({ title: t('connectionImport.imported', { n: result.imported }, result.imported), color: 'success' })
    }
    if (result.failed.length) {
      // Shows what was imported as existing, so that only the failed ones are left to select.
      failed.value = result.failed
      await scan(p.source, p.path)
    } else open.value = false
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('connectionImport.title')"
    :description="t('connectionImport.description')"
    :ui="{ content: 'max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-3">
        <UAlert v-if="error" color="error" variant="subtle" :description="error" />

        <template v-if="!preview">
          <ul class="divide-y divide-default">
            <li v-for="s in sources" :key="s.source" class="flex items-center gap-3 py-2">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">{{ t(`connectionImport.sources.${s.source}`) }}</p>
                <p class="truncate text-xs text-muted" :title="s.path ?? undefined">
                  {{ s.path ?? t('connectionImport.notFound') }}
                </p>
              </div>
              <UButton
                :label="t('connectionImport.scan')"
                color="neutral"
                variant="soft"
                :disabled="!s.path || !!scanning"
                :loading="scanning === s.source && !!s.path"
                @click="scan(s.source)"
              />
              <UButton
                :label="t('connectionImport.chooseFile')"
                icon="i-lucide-folder-open"
                color="neutral"
                variant="ghost"
                :disabled="!!scanning"
                @click="choose(s.source)"
              />
            </li>
          </ul>
        </template>

        <template v-else>
          <p class="truncate text-xs text-muted" :title="preview.path">{{ preview.path }}</p>
          <div v-if="failed.length" class="space-y-1">
            <UAlert color="error" variant="subtle" :description="t('connectionImport.failed')" />
            <ul class="text-xs text-error">
              <li v-for="f in failed" :key="f.name">{{ f.name }}: {{ f.message }}</li>
            </ul>
          </div>
          <p v-if="!preview.items.length && !preview.skipped.length" class="py-6 text-center text-sm text-muted">
            {{ t('connectionImport.nothingFound') }}
          </p>
          <UCheckbox
            v-if="selectable.length"
            :model-value="allSelected"
            :label="t('connectionImport.selectAll')"
            @update:model-value="setAll"
          />
          <ul class="space-y-1">
            <li v-for="i in preview.items" :key="i.key" class="rounded p-2 hover:bg-elevated/60">
              <div class="flex items-start gap-2">
                <UCheckbox
                  :model-value="selected.has(i.key)"
                  :disabled="!!i.duplicate"
                  :aria-label="i.connection.name"
                  class="mt-0.5"
                  @update:model-value="toggle(i.key, $event)"
                />
                <div class="min-w-0 flex-1 text-sm">
                  <div class="flex items-center gap-2">
                    <span class="truncate font-medium">
                      <span v-if="i.connection.folder" class="font-normal text-muted">{{ i.connection.folder }} / </span
                      >{{ i.connection.name }}
                    </span>
                    <UBadge :label="dialectLabel(i.connection.dialect)" color="neutral" variant="subtle" size="sm" />
                    <UBadge
                      v-if="i.duplicate"
                      :label="t('connectionImport.duplicate', { name: i.duplicate })"
                      color="warning"
                      variant="subtle"
                      size="sm"
                    />
                  </div>
                  <p class="truncate text-xs text-muted" :title="target(i)">{{ target(i) }}</p>
                  <p
                    v-for="n in i.notes"
                    :key="n.key + JSON.stringify(n.params)"
                    class="flex items-start gap-1 text-xs text-warning"
                  >
                    <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
                    <span>{{ noteText(n) }}</span>
                  </p>
                  <UInput
                    v-if="selected.has(i.key) && !i.duplicate && needsPassword(i)"
                    v-model="passwords[i.key]"
                    type="password"
                    size="xs"
                    class="mt-1 w-56"
                    autocomplete="off"
                    :placeholder="t('connectionImport.password')"
                    :aria-label="`${t('connectionImport.password')}: ${i.connection.name}`"
                  />
                </div>
              </div>
            </li>
          </ul>
          <div v-if="preview.skipped.length" class="space-y-1">
            <p class="text-xs font-medium uppercase text-muted">
              {{ t('connectionImport.skipped', { n: preview.skipped.length }, preview.skipped.length) }}
            </p>
            <ul class="text-xs text-muted">
              <li v-for="(s, index) in preview.skipped" :key="index" class="flex items-start gap-1">
                <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span class="font-medium text-default">{{ s.name }}</span
                  >: {{ noteText(s.note) }}
                </span>
              </li>
            </ul>
          </div>
        </template>
      </div>
    </template>
    <template v-if="preview" #footer>
      <div class="flex w-full justify-between">
        <UButton
          :label="t('connectionImport.back')"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          :disabled="importing"
          @click="preview = undefined"
        />
        <UButton
          :label="t('connectionImport.importN', { n: selected.size }, selected.size)"
          :disabled="!selected.size"
          :loading="importing"
          @click="runImport"
        />
      </div>
    </template>
  </UModal>
</template>
