<script setup lang="ts">
// Settings chosen once and kept in the data directory; each change is saved at once
import type { CsvOptions } from '#core'
import { type Settings, sqlExpressionWidths, type SqlFormatOptions } from '~~/core/settings.ts'

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const toast = useToast()
const { settings, save } = useSettings()

// Sections of the sidebar; only the chosen one is shown, so the dialog stays short as settings grow
type Section = 'csv' | 'sqlFormat'
const section = ref<Section>('csv')
const sections = computed(() =>
  (
    [
      { id: 'csv', label: t('settings.csv'), icon: 'i-lucide-file-spreadsheet' },
      { id: 'sqlFormat', label: t('settings.sqlFormat'), icon: 'i-lucide-wand-sparkles' },
    ] as const
  ).map((s) => ({
    label: s.label,
    icon: s.icon,
    active: section.value === s.id,
    onSelect: () => (section.value = s.id),
  })),
)

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

const cases = computed(() => [
  { label: t('settings.casePreserve'), value: 'preserve' },
  { label: t('settings.caseUpper'), value: 'upper' },
  { label: t('settings.caseLower'), value: 'lower' },
])
const caseFields = computed(
  () =>
    [
      { key: 'keywordCase', label: t('settings.keywordCase') },
      { key: 'functionCase', label: t('settings.functionCase') },
      { key: 'dataTypeCase', label: t('settings.dataTypeCase') },
      { key: 'identifierCase', label: t('settings.identifierCase') },
    ] as const,
)
const indents = computed(() => [
  { label: t('settings.indentSpaces', { n: 4 }), value: 'spaces4' },
  { label: t('settings.indentSpaces', { n: 2 }), value: 'spaces2' },
  { label: t('settings.indentTab'), value: 'tab' },
])
const logicalNewlines = computed(() => [
  { label: t('settings.logicalBefore'), value: 'before' },
  { label: t('settings.logicalAfter'), value: 'after' },
])
const commaStyles = computed(() => [
  { label: t('settings.commasLeading'), value: 'leading' },
  { label: t('settings.commasTrailing'), value: 'trailing' },
])

const setCsv = <K extends keyof CsvOptions>(key: K, value: CsvOptions[K]) =>
  update({ ...settings.value, csv: { ...settings.value.csv, [key]: value } })

const setSqlFormat = <K extends keyof SqlFormatOptions>(key: K, value: SqlFormatOptions[K]) =>
  update({ ...settings.value, sqlFormat: { ...settings.value.sqlFormat, [key]: value } })

async function update(next: Settings) {
  try {
    await save(next)
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
  <UModal v-model:open="open" :title="t('settings.title')" :ui="{ content: 'max-w-3xl' }">
    <template #body>
      <div class="flex min-h-[28rem] gap-6">
        <UNavigationMenu :items="sections" orientation="vertical" class="w-44 shrink-0" />
        <div class="min-w-0 flex-1">
          <section v-if="section === 'csv'" class="space-y-3">
            <h3 class="font-semibold">{{ t('settings.csv') }}</h3>
            <p class="text-sm text-muted">{{ t('settings.csvHint') }}</p>
            <div class="grid gap-3">
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
          <section v-else-if="section === 'sqlFormat'" class="space-y-3">
            <h3 class="font-semibold">{{ t('settings.sqlFormat') }}</h3>
            <p class="text-sm text-muted">{{ t('settings.sqlFormatHint') }}</p>
            <div class="grid gap-3">
              <UFormField v-for="f in caseFields" :key="f.key" :label="f.label">
                <USelect
                  :model-value="settings.sqlFormat[f.key]"
                  :items="cases"
                  class="w-full"
                  @update:model-value="(v) => setSqlFormat(f.key, v as SqlFormatOptions[typeof f.key])"
                />
              </UFormField>
              <UFormField :label="t('settings.indent')">
                <USelect
                  :model-value="settings.sqlFormat.indent"
                  :items="indents"
                  class="w-full"
                  @update:model-value="(v) => setSqlFormat('indent', v as SqlFormatOptions['indent'])"
                />
              </UFormField>
              <UFormField :label="t('settings.commas')">
                <USelect
                  :model-value="settings.sqlFormat.commas"
                  :items="commaStyles"
                  class="w-full"
                  @update:model-value="(v) => setSqlFormat('commas', v as SqlFormatOptions['commas'])"
                />
              </UFormField>
              <UFormField :label="t('settings.logicalOperatorNewline')">
                <USelect
                  :model-value="settings.sqlFormat.logicalOperatorNewline"
                  :items="logicalNewlines"
                  class="w-full"
                  @update:model-value="
                    (v) => setSqlFormat('logicalOperatorNewline', v as SqlFormatOptions['logicalOperatorNewline'])
                  "
                />
              </UFormField>
              <UFormField :label="t('settings.expressionWidth')" :hint="t('settings.expressionWidthHint')">
                <UInputNumber
                  :model-value="settings.sqlFormat.expressionWidth"
                  :min="sqlExpressionWidths.min"
                  :max="sqlExpressionWidths.max"
                  class="w-full"
                  @update:model-value="(v) => v != null && setSqlFormat('expressionWidth', v)"
                />
              </UFormField>
            </div>
            <UCheckbox
              :model-value="settings.sqlFormat.bangNotEqual"
              :label="t('settings.bangNotEqual')"
              @update:model-value="(v) => setSqlFormat('bangNotEqual', v === true)"
            />
          </section>
        </div>
      </div>
    </template>
  </UModal>
</template>
