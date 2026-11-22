<script setup lang="ts">
// A password field that keeps the stored password when left empty, with a switch to remove it
defineProps<{ label: string; help?: string; wide?: boolean; stored: boolean; clearLabel: string }>()
const value = defineModel<string>('value')
const clear = defineModel<boolean>('clear', { default: false })
const { t } = useI18n()
</script>

<template>
  <UFormField :label="label" :help="help" :class="wide ? 'col-span-2' : undefined">
    <UInput
      v-model="value"
      type="password"
      class="w-full"
      autocomplete="new-password"
      :disabled="clear"
      :placeholder="clear ? t('connection.passwordRemoved') : stored ? t('connection.passwordUnchanged') : ''"
    />
  </UFormField>
  <UFormField v-if="stored" class="col-span-2">
    <USwitch v-model="clear" :label="clearLabel" />
  </UFormField>
</template>
