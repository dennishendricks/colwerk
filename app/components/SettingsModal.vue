<script setup lang="ts">
// Settings chosen once and kept in the data directory; each change is saved at once
import type { CsvOptions } from '#core'

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const toast = useToast()
const { settings, save } = useSettings()

const delimiters = computed(() => [
  { label: t('settings.delimiterSemicolon'), value: ';' },
  { label: t('settings.delimiterComma'), value: ',' },
  { label: t('settings.delimiterTab'), value: '\t' },
  { label: t('settings.delimiterPipe'), value: '|' },
])
const quotes = computed(() => [
  { label: t('settings.quoteDouble'), value: '"' },
  { label: t('settings.quoteSingle'), value: "'" },
])
const escapes = computed(() => [
  { label: t('settings.escapeDouble'), value: 'double' },
  { label: t('settings.escapeBackslash'), value: 'backslash' },
])
const encodings = computed(() => [
  { label: t('settings.encodingUtf8Bom'), value: 'utf-8-bom' },
  { label: 'UTF-8', value: 'utf-8' },
  { label: 'UTF-16 LE', value: 'utf-16le' },
  { label: 'Windows-1252', value: 'windows-1252' },
])

async function setCsv<K extends keyof CsvOptions>(key: K, value: CsvOptions[K]) {
  try {
    await save({ ...settings.value, csv: { ...settings.value.csv, [key]: value } })
  } catch (e) {
    toast.add({
      title: t('settings.saveFailed'),
      description: errorMessage(e),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="t('settings.title')">
    <template #body>
      <section class="space-y-3">
        <h3 class="font-semibold">{{ t('settings.csv') }}</h3>
        <p class="text-sm text-muted">{{ t('settings.csvHint') }}</p>
        <div class="grid grid-cols-2 gap-3">
          <UFormField :label="t('settings.delimiter')">
            <USelect
              :model-value="settings.csv.delimiter"
              :items="delimiters"
              class="w-full"
              @update:model-value="(v) => setCsv('delimiter', v as CsvOptions['delimiter'])"
            />
          </UFormField>
          <UFormField :label="t('settings.encoding')">
            <USelect
              :model-value="settings.csv.encoding"
              :items="encodings"
              class="w-full"
              @update:model-value="(v) => setCsv('encoding', v as CsvOptions['encoding'])"
            />
          </UFormField>
          <UFormField :label="t('settings.quote')">
            <USelect
              :model-value="settings.csv.quote"
              :items="quotes"
              class="w-full"
              @update:model-value="(v) => setCsv('quote', v as CsvOptions['quote'])"
            />
          </UFormField>
          <UFormField :label="t('settings.escape')">
            <USelect
              :model-value="settings.csv.escape"
              :items="escapes"
              class="w-full"
              @update:model-value="(v) => setCsv('escape', v as CsvOptions['escape'])"
            />
          </UFormField>
        </div>
      </section>
    </template>
  </UModal>
</template>
