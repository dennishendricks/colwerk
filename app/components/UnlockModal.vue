<script setup lang="ts">
// Asks for the master password (or access token) of a locked password manager; the server keeps it in memory.
const { t } = useI18n()
const toast = useToast()

const open = computed({
  get: () => !!vaultToUnlock.value,
  set: (v) => {
    if (!v) vaultToUnlock.value = undefined
  },
})
const vault = computed(() => vaultToUnlock.value)
const secret = ref('')
const busy = ref(false)
const error = ref<string>()

watch(vaultToUnlock, () => {
  secret.value = ''
  error.value = undefined
})

async function submit() {
  const v = vault.value
  if (!v) return
  busy.value = true
  error.value = undefined
  try {
    await api('/api/vaults/unlock', {
      method: 'POST',
      body: { provider: v.provider, database: v.database, keyFile: v.keyFile, secret: secret.value },
    })
    toast.add({ title: t('unlock.unlocked', { name: v.name }), color: 'success', icon: 'i-lucide-lock-open' })
    open.value = false
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('unlock.title', { name: vault?.name ?? '' })"
    :description="vault ? t(`unlock.description.${vault.provider}`, { database: vault.database }) : ''"
  >
    <template #body>
      <form class="space-y-3" @submit.prevent="submit">
        <UFormField
          :label="vault?.provider === 'bitwarden-sm' ? t('unlock.accessToken') : t('unlock.masterPassword')"
          :help="vault?.keyFile ? t('unlock.keyFileHelp') : undefined"
        >
          <UInput v-model="secret" type="password" autocomplete="off" autofocus class="w-full" />
        </UFormField>
        <button type="submit" hidden />
        <UAlert v-if="error" color="error" variant="subtle" :description="error" />
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end">
        <UButton
          :label="t('unlock.unlock')"
          icon="i-lucide-lock-open"
          :loading="busy"
          :disabled="!secret && !vault?.keyFile"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
