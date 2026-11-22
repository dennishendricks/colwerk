<script setup lang="ts">
import type { SecretProvider, SecretRef } from '#core'

// A secret field of the connection dialog: a value stored by Colwerk, or a reference to a password manager that is
// read on every connect (core/secrets.ts).
defineProps<{ label: string; stored: boolean; clearLabel: string }>()
const value = defineModel<string>('value', { default: '' })
const reference = defineModel<SecretRef | undefined>('reference')
const clear = defineModel<boolean>('clear', { default: false })
const { t } = useI18n()

const EMPTY: Record<SecretProvider, SecretRef> = {
  '1password': { provider: '1password', reference: '' },
  bitwarden: { provider: 'bitwarden', item: '' },
  'bitwarden-sm': { provider: 'bitwarden-sm', secretId: '' },
  keepassxc: { provider: 'keepassxc', database: '', entry: '' },
}

const source = computed<'stored' | SecretProvider>({
  get: () => reference.value?.provider ?? 'stored',
  set: (s) => (reference.value = s === 'stored' ? undefined : { ...EMPTY[s] }),
})
const items = computed(() => [
  { label: t('connection.secretSources.stored'), value: 'stored' as const },
  ...secretProviders.map((p) => ({ label: t(`connection.secretSources.${p}`), value: p })),
])

// The fields of the reference as plain strings; the server drops empty optional fields.
const field = (key: string) =>
  computed({
    get: () => (reference.value as Record<string, string> | undefined)?.[key] ?? '',
    set: (v: string) => (reference.value = { ...reference.value, [key]: v } as SecretRef),
  })
const opReference = field('reference')
const bwItem = field('item')
const bwField = field('field')
const bwsSecretId = field('secretId')
const kpDatabase = field('database')
const kpEntry = field('entry')
const kpAttribute = field('attribute')
const kpKeyFile = field('keyFile')

const plain = { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: false }
</script>

<template>
  <div class="col-span-2 grid grid-cols-2 gap-3">
    <UFormField :label="label" class="col-span-2">
      <div class="flex gap-2">
        <USelect v-model="source" :items="items" class="w-44 shrink-0" :aria-label="t('connection.secretSource')" />
        <UInput
          v-if="source === 'stored'"
          v-model="value"
          type="password"
          class="flex-1"
          autocomplete="new-password"
          :disabled="clear"
          :placeholder="clear ? t('connection.passwordRemoved') : stored ? t('connection.passwordUnchanged') : ''"
        />
        <UInput
          v-else-if="source === '1password'"
          v-model="opReference"
          v-bind="plain"
          class="flex-1"
          placeholder="op://vault/item/password"
        />
        <template v-else-if="source === 'bitwarden'">
          <UInput v-model="bwItem" v-bind="plain" class="flex-1" :placeholder="t('connection.bwItem')" />
          <UInput
            v-model="bwField"
            v-bind="plain"
            class="w-32"
            placeholder="password"
            :aria-label="t('connection.bwField')"
          />
        </template>
        <UInput
          v-else-if="source === 'bitwarden-sm'"
          v-model="bwsSecretId"
          v-bind="plain"
          class="flex-1"
          :placeholder="t('connection.bwsSecretId')"
        />
        <UInput
          v-else
          v-model="kpDatabase"
          v-bind="plain"
          class="flex-1"
          placeholder="~/Passwords.kdbx"
          :aria-label="t('connection.keepassDatabase')"
        />
      </div>
    </UFormField>
    <template v-if="source === 'keepassxc'">
      <UFormField :label="t('connection.keepassEntry')" :help="t('connection.keepassEntryHelp')">
        <UInput v-model="kpEntry" v-bind="plain" class="w-full" />
      </UFormField>
      <UFormField :label="t('connection.keepassAttribute')">
        <UInput v-model="kpAttribute" v-bind="plain" class="w-full" placeholder="Password" />
      </UFormField>
      <UFormField :label="t('connection.keepassKeyFile')" class="col-span-2">
        <UInput v-model="kpKeyFile" v-bind="plain" class="w-full" />
      </UFormField>
    </template>
    <p v-if="source !== 'stored'" class="col-span-2 text-sm text-(--ui-text-muted)">
      {{ t(`connection.secretRefHelp.${source}`) }}
    </p>
    <UFormField v-else-if="stored" class="col-span-2">
      <USwitch v-model="clear" :label="clearLabel" />
    </UFormField>
  </div>
</template>
