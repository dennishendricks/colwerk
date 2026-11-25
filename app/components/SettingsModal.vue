<script setup lang="ts">
// Settings chosen once and kept in the data directory; each change is saved at once
import type { CsvOptions } from '#core'
import { isValidPattern, type MaskMethod, maskMethods, type MaskRule } from '~~/core/masking.ts'
import { type Settings, sqlExpressionWidths, type SqlFormatOptions } from '~~/core/settings.ts'

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const toast = useToast()
const { settings, save } = useSettings()

// Sections of the sidebar; only the chosen one is shown, so the dialog stays short as settings grow
type Section = 'csv' | 'sqlFormat' | 'masking'
const section = ref<Section>('csv')
const sections = computed(() =>
  (
    [
      { id: 'csv', label: t('settings.csv'), icon: 'i-lucide-file-spreadsheet' },
      { id: 'sqlFormat', label: t('settings.sqlFormat'), icon: 'i-lucide-wand-sparkles' },
      { id: 'masking', label: t('settings.masking'), icon: 'i-lucide-shield' },
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

const methodItems = computed(() => maskMethods.map((m) => ({ label: t(`settings.maskMethods.${m}`), value: m })))

const setRules = (rules: MaskRule[]) => update({ ...settings.value, masking: { rules } })
const setRule = (id: string, change: Partial<MaskRule>) =>
  setRules(settings.value.masking.rules.map((r) => (r.id === id ? { ...r, ...change } : r)))
const removeRule = (id: string) => setRules(settings.value.masking.rules.filter((r) => r.id !== id))

const newPattern = ref('')
const newMethod = ref<MaskMethod>('redact')
const newPatternInvalid = computed(() => !!newPattern.value.trim() && !isValidPattern(newPattern.value.trim()))
async function addRule() {
  const pattern = newPattern.value.trim()
  if (!isValidPattern(pattern)) return
  await setRules([
    ...settings.value.masking.rules,
    { id: crypto.randomUUID(), pattern, method: newMethod.value, enabled: true },
  ])
  newPattern.value = ''
}

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
          <section v-else-if="section === 'masking'" class="space-y-3">
            <h3 class="font-semibold">{{ t('settings.masking') }}</h3>
            <p class="text-sm text-muted">{{ t('settings.maskingHint') }}</p>
            <ul class="divide-y divide-default">
              <li v-for="rule in settings.masking.rules" :key="rule.id" class="flex items-center gap-3 py-1.5">
                <USwitch
                  :model-value="rule.enabled"
                  :aria-label="t('settings.maskEnabled')"
                  @update:model-value="(v) => setRule(rule.id, { enabled: v })"
                />
                <div class="min-w-0 flex-1">
                  <div v-if="rule.builtin" class="text-sm">{{ t(`settings.maskRules.${rule.id}`) }}</div>
                  <code class="block truncate text-xs text-muted" :title="rule.pattern">{{ rule.pattern }}</code>
                </div>
                <USelect
                  :model-value="rule.method"
                  :items="methodItems"
                  :aria-label="t('settings.maskMethod')"
                  size="sm"
                  class="w-40"
                  @update:model-value="(v) => setRule(rule.id, { method: v as MaskMethod })"
                />
                <UButton
                  v-if="!rule.builtin"
                  icon="i-lucide-trash-2"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :aria-label="t('settings.maskRemove')"
                  @click="removeRule(rule.id)"
                />
                <span v-else class="w-8" />
              </li>
            </ul>
            <form class="flex items-start gap-2" @submit.prevent="addRule">
              <UFormField :error="newPatternInvalid ? t('settings.maskPatternInvalid') : undefined" class="flex-1">
                <UInput
                  v-model="newPattern"
                  :placeholder="t('settings.maskPatternPlaceholder')"
                  :aria-label="t('settings.maskPattern')"
                  class="w-full font-mono"
                />
              </UFormField>
              <USelect v-model="newMethod" :items="methodItems" :aria-label="t('settings.maskMethod')" class="w-40" />
              <UButton
                type="submit"
                icon="i-lucide-plus"
                :label="t('settings.maskAdd')"
                :disabled="!newPattern.trim() || newPatternInvalid"
              />
            </form>
          </section>
        </div>
      </div>
    </template>
  </UModal>
</template>
